import { describe, expect, it } from "vitest";
import { banDiver } from "./moderation";
import { deleteAccountRecords } from "./accounts";
import { diverStats } from "./points";
import {
  approveRefusal,
  countedEdits,
  liveTexts,
  proposeEdit,
  readEditInput,
  reviewEdit,
  revertEdit,
  siteContributors,
  staleFields,
  withdrawEdit,
  withWikiTexts,
} from "./site-wiki";
import { EDITS_PER_DAY, PENDING_EDITS_MAX } from "./site-wiki-limits";
import type { Site, StoreData, User } from "./types";

const T0 = Date.parse("2026-11-25T04:00:00Z");
const ORIGINAL = { description: "", howToDive: "Catalog notes." };
const site: Site = { id: "kandu", name: "Kandu", atollId: "x", lat: 4, lon: 73, sourceUrl: "", howToDive: "Catalog notes." };

function user(id: string, extra: Partial<User> = {}): User {
  return { id, email: `${id}@example.com`, nickname: id.toUpperCase(), createdAt: "", acceptedTermsAt: "2026-11-01T00:00:00Z", ...extra };
}

function store(): StoreData {
  return {
    reports: [],
    ratings: [],
    sites: [],
    users: [user("ann"), user("bob"), user("mod"), user("new", { acceptedTermsAt: undefined }), user("rev", { storeReview: true })],
    logins: [],
    plans: [],
    flags: [],
    siteEdits: [],
  };
}

const input = (texts: Record<string, string>, based: Record<string, string> = {}, note?: string) =>
  readEditInput({ siteId: "kandu", texts, based, note });

describe("proposing an edit", () => {
  it("keeps only the fields that differ from the live text, with what the diver started from", () => {
    const data = store();
    const { edit, created } = proposeEdit(data, "ann", input({ description: " A thila.\r\n\n\n\nSharks. ", howToDive: "Catalog notes." }), ORIGINAL, T0);
    expect(created).toBe(true);
    expect(edit).toMatchObject({ status: "pending", changes: { description: "A thila.\n\nSharks." }, based: { description: "" } });
    expect(edit.changes.howToDive).toBeUndefined();
    // Waiting edits do not show.
    expect(liveTexts(ORIGINAL, data.siteEdits, "kandu").texts).toEqual(ORIGINAL);
  });

  it("refuses an edit that changes nothing, a diver without the content rules, and a banned one", () => {
    const data = store();
    expect(() => proposeEdit(data, "ann", input({ howToDive: "Catalog notes." }), ORIGINAL, T0)).toThrow(/already says/);
    expect(() => proposeEdit(data, "new", input({ description: "Hi" }), ORIGINAL, T0)).toThrow(/content rules/);
    data.users[0].bannedAt = "2026-11-02T00:00:00Z";
    expect(() => proposeEdit(data, "ann", input({ description: "Hi" }), ORIGINAL, T0)).toThrow(/cannot edit/);
  });

  it("reads input strictly: text only, within the lengths", () => {
    expect(() => readEditInput({ siteId: "kandu", texts: { description: 5 } })).toThrow(/must be text/);
    expect(() => readEditInput({ siteId: "kandu", texts: { description: "x".repeat(2001) } })).toThrow(/at most 2000/);
    expect(() => readEditInput({ siteId: "kandu", texts: {} })).toThrow(/Write something/);
    expect(() => readEditInput({ texts: { description: "x" } })).toThrow(/which site/);
  });

  it("changes the diver's own waiting edit in place, and holds the queue and daily limits", () => {
    const data = store();
    const first = proposeEdit(data, "ann", input({ description: "One" }), ORIGINAL, T0).edit;
    const again = proposeEdit(data, "ann", input({ description: "Two" }, {}, "fixed a typo"), ORIGINAL, T0 + 1000);
    expect(again.created).toBe(false);
    expect(data.siteEdits).toHaveLength(1);
    expect(data.siteEdits[0]).toMatchObject({ id: first.id, changes: { description: "Two" }, note: "fixed a typo" });
    // Changing a waiting edit takes no new slot for the day.
    expect(data.users[0].siteEditProposals).toHaveLength(1);

    const busy = store();
    for (let index = 0; index < PENDING_EDITS_MAX; index += 1) {
      proposeEdit(busy, "bob", readEditInput({ siteId: `s${index}`, texts: { description: "x" } }), { description: "", howToDive: "" }, T0);
    }
    expect(() => proposeEdit(busy, "bob", readEditInput({ siteId: "more", texts: { description: "x" } }), { description: "", howToDive: "" }, T0)).toThrow(
      /waiting for review/,
    );
    // Withdrawn edits leave the queue (their rows are deleted) but still count for the day.
    for (const edit of [...busy.siteEdits]) withdrawEdit(busy, "bob", edit.id);
    expect(busy.siteEdits).toEqual([]);
    expect(EDITS_PER_DAY).toBe(PENDING_EDITS_MAX);
    expect(() => proposeEdit(busy, "bob", readEditInput({ siteId: "more", texts: { description: "x" } }), { description: "", howToDive: "" }, T0)).toThrow(
      /a day/,
    );
    expect(() =>
      proposeEdit(busy, "bob", readEditInput({ siteId: "more", texts: { description: "x" } }), { description: "", howToDive: "" }, T0 + 25 * 3600_000),
    ).not.toThrow();
  });

  it("puts a moderator's edit live at once", () => {
    const data = store();
    const { edit } = proposeEdit(data, "mod", input({ howToDive: "Mod notes." }), ORIGINAL, T0, { moderator: true });
    expect(edit).toMatchObject({ status: "approved", reviewerId: "mod", replaced: { howToDive: "Catalog notes." } });
    expect(liveTexts(ORIGINAL, data.siteEdits, "kandu").texts.howToDive).toBe("Mod notes.");
  });
});

describe("reviewing edits", () => {
  it("approves an edit over the live text, keeps what it replaced, and credits its diver", () => {
    const data = store();
    const a = proposeEdit(data, "ann", input({ howToDive: "Ann notes." }), ORIGINAL, T0).edit;
    const b = proposeEdit(data, "bob", input({ howToDive: "Bob notes.", description: "Bob about." }), ORIGINAL, T0).edit;
    reviewEdit(data, a.id, "approve", "mod", ORIGINAL, T0 + 1000);
    // Bob started from the catalog text, which Ann's edit changed since.
    expect(staleFields(b, liveTexts(ORIGINAL, data.siteEdits, "kandu").texts)).toEqual(["howToDive"]);
    reviewEdit(data, b.id, "approve", "mod", ORIGINAL, T0 + 2000);
    expect(b.replaced).toEqual({ howToDive: "Ann notes.", description: "" });
    expect(withWikiTexts(site, data.siteEdits)).toMatchObject({ description: "Bob about.", howToDive: "Bob notes." });
    expect(site.description).toBeUndefined();
    expect(siteContributors(data, "kandu").map((diver) => diver.nickname)).toEqual(["ANN", "BOB"]);
    expect(() => reviewEdit(data, b.id, "reject", "mod", ORIGINAL, T0)).toThrow(/already/);
  });

  it("rejects with a reason, and never approves the store-review account's edit", () => {
    const data = store();
    const a = proposeEdit(data, "ann", input({ description: "Spam" }), ORIGINAL, T0).edit;
    reviewEdit(data, a.id, "reject", "mod", ORIGINAL, T0, "  Advertising ");
    expect(a).toMatchObject({ status: "rejected", rejectReason: "Advertising" });
    const r = proposeEdit(data, "rev", input({ description: "Testing" }), ORIGINAL, T0).edit;
    expect(approveRefusal(data, r)).toMatch(/store-review/);
    expect(() => reviewEdit(data, r.id, "approve", "mod", ORIGINAL, T0)).toThrow(/store-review/);
  });

  it("takes back only the live revision, falling back to the one before", () => {
    const data = store();
    const a = proposeEdit(data, "ann", input({ howToDive: "Ann notes." }), ORIGINAL, T0).edit;
    reviewEdit(data, a.id, "approve", "mod", ORIGINAL, T0 + 1000);
    const b = proposeEdit(data, "bob", input({ howToDive: "Vandal." }), ORIGINAL, T0 + 2000).edit;
    reviewEdit(data, b.id, "approve", "mod", ORIGINAL, T0 + 3000);
    expect(() => revertEdit(data, a.id, ORIGINAL, "2026-11-26T00:00:00Z")).toThrow(/later edit/);
    revertEdit(data, b.id, ORIGINAL, "2026-11-26T00:00:00Z");
    expect(liveTexts(ORIGINAL, data.siteEdits, "kandu").texts.howToDive).toBe("Ann notes.");
    expect(siteContributors(data, "kandu").map((diver) => diver.nickname)).toEqual(["ANN"]);
    revertEdit(data, a.id, ORIGINAL, "2026-11-26T00:00:00Z");
    expect(withWikiTexts(site, data.siteEdits)).toBe(site);
  });

  it("lets a diver withdraw only their own waiting edit", () => {
    const data = store();
    const a = proposeEdit(data, "ann", input({ description: "Mine" }), ORIGINAL, T0).edit;
    expect(withdrawEdit(data, "bob", a.id)).toBe(false);
    expect(withdrawEdit(data, "ann", a.id)).toBe(true);
    expect(data.siteEdits).toEqual([]);
  });
});

describe("edits and accounts", () => {
  it("a ban rejects the diver's waiting edits and keeps their approved ones", () => {
    const data = store();
    const live = proposeEdit(data, "bob", input({ description: "Good" }), ORIGINAL, T0).edit;
    reviewEdit(data, live.id, "approve", "mod", ORIGINAL, T0);
    const waiting = proposeEdit(data, "bob", input({ description: "Bad" }), ORIGINAL, T0 + 1000).edit;
    banDiver(data, "bob", T0 + 2000);
    expect(waiting).toMatchObject({ status: "rejected", rejectReason: "Account suspended." });
    expect(live.status).toBe("approved");
  });

  it("deleting an account keeps approved text uncredited and drops the rest", () => {
    const data = store();
    const live = proposeEdit(data, "bob", input({ description: "Good" }, {}, "I guide here"), ORIGINAL, T0).edit;
    reviewEdit(data, live.id, "approve", "mod", ORIGINAL, T0);
    proposeEdit(data, "bob", readEditInput({ siteId: "other", texts: { description: "Waiting" } }), { description: "", howToDive: "" }, T0);
    deleteAccountRecords(data, "bob");
    expect(data.siteEdits).toHaveLength(1);
    expect(data.siteEdits[0].userId).toMatch(/^deleted-/);
    expect(data.siteEdits[0].note).toBeUndefined();
    expect(liveTexts(ORIGINAL, data.siteEdits, "kandu").texts.description).toBe("Good");
    expect(siteContributors(data, "kandu")).toEqual([]);
  });
});

describe("points for edits", () => {
  it("counts approved edits by approval day, not a moderator's own or one taken back, up to the daily cap", () => {
    const data = store();
    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const edit = proposeEdit(data, "ann", readEditInput({ siteId: `s${index}`, texts: { description: `t${index}` } }), { description: "", howToDive: "" }, T0).edit;
      reviewEdit(data, edit.id, "approve", "mod", { description: "", howToDive: "" }, T0 + index);
      ids.push(edit.id);
    }
    data.siteEdits.find((edit) => edit.id === ids[4])!.revertedAt = "2026-11-25T05:00:00Z";
    proposeEdit(data, "mod", input({ description: "Mine" }), ORIGINAL, T0, { moderator: true });
    expect(countedEdits(data.siteEdits, 3).get("ann")).toHaveLength(3);
    expect(countedEdits(data.siteEdits, 3).get("mod")).toBeUndefined();
    const stats = diverStats([], data.users, [], T0, [], data.siteEdits);
    expect(stats.find((row) => row.userId === "ann")).toMatchObject({ points: 15, monthPoints: 15, edits: 3 });
  });
});

describe("the credit line", () => {
  it("names the divers the way the web card and the app say it", async () => {
    const { writtenByLine } = await import("./site-wiki-limits");
    expect(writtenByLine([])).toBeNull();
    expect(writtenByLine(["Ann"])).toBe("Written by Ann.");
    expect(writtenByLine(["Ann", "Bob"])).toBe("Written by Ann and Bob.");
    expect(writtenByLine(["Ann", "Bob", "Cy"])).toBe("Written by Ann, Bob and Cy.");
  });
});
