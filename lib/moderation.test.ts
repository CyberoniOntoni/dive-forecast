import { describe, expect, it } from "vitest";
import { countedReports, finishLogin, TERMS_NEEDED } from "./accounts";
import { addFlag, BANNED, banDiver, banRefusal, hideReportsBy, moderate, setReportHidden, FLAGS_PER_DAY, isModeratorEmail, readFlagInput, removeFlagged, resolveFlags, setBlocked } from "./moderation";
import type { StoreData } from "./types";

const NOW = Date.parse("2026-11-18T10:00:00Z");
const photo = (id: string, addedBy: string) => ({ id, addedBy, addedAt: "2026-11-01T00:00:00Z" });

function store(): StoreData {
  return {
    reports: [],
    ratings: [
      { siteId: "s1", score: 1, updatedAt: "2026-11-01T00:00:00Z", userId: "bad", review: "Rude words", photos: [photo("r1", "bad")] },
      { siteId: "s1", score: 5, updatedAt: "2026-11-01T00:00:00Z", userId: "ann" },
    ],
    sites: [{ id: "pin", name: "Pin", atollId: "x", lat: 4, lon: 73, sourceUrl: "user", addedBy: "bad", howToDive: "Spam", photos: [photo("p1", "bad")] }],
    users: [
      { id: "ann", email: "ann@example.com", nickname: "Ann", createdAt: "", acceptedTermsAt: "2026-11-01T00:00:00Z" },
      { id: "bad", email: "bad@example.com", nickname: "Rude", createdAt: "", about: "Offensive" },
    ],
    logins: [],
    plans: [],
    flags: [],
  };
}

describe("reports of content", () => {
  it("reads a report and refuses an unknown kind or reason, or a long note", () => {
    expect(readFlagInput({ kind: "review", siteId: "s1", userId: "bad", reason: "sexual", note: "  look " })).toEqual({
      kind: "review",
      siteId: "s1",
      userId: "bad",
      reason: "sexual",
      note: "look",
    });
    expect(() => readFlagInput({ kind: "post", reason: "spam" })).toThrow();
    expect(() => readFlagInput({ kind: "diver", userId: "bad", reason: "rude" })).toThrow();
    expect(() => readFlagInput({ kind: "diver", userId: "bad", reason: "spam", note: "x".repeat(501) })).toThrow();
    expect(() => readFlagInput({ kind: "review", userId: "bad", reason: "spam" })).toThrow("site");
  });

  it("files one open report per diver and content, never on one's own, and caps a day's reports", () => {
    const data = store();
    const review = { kind: "review" as const, siteId: "s1", userId: "bad", reason: "hate" as const };
    expect(addFlag(data, "ann", review, NOW)).toMatchObject({ result: "saved", flag: { reporterId: "ann", userId: "bad" } });
    expect(addFlag(data, "ann", review, NOW)).toEqual({ result: "duplicate" });
    expect(addFlag(data, "bad", review, NOW)).toEqual({ result: "own" });
    // A rating with no words or photos is not content to report.
    expect(addFlag(data, "bad", { ...review, userId: "ann" }, NOW)).toEqual({ result: "missing" });
    // The site's adder comes from the store, whatever the report said.
    expect(addFlag(data, "ann", { kind: "site", siteId: "pin", reason: "spam" }, NOW)).toMatchObject({ flag: { userId: "bad" } });
    for (let index = data.flags.length; index < FLAGS_PER_DAY; index += 1) {
      data.flags.push({ id: `f${index}`, reporterId: "ann", kind: "diver", userId: `x${index}`, reason: "spam", createdAt: new Date(NOW).toISOString() });
    }
    expect(addFlag(data, "ann", { kind: "diver", userId: "bad", reason: "spam" }, NOW)).toEqual({ result: "limit" });
  });
});

describe("blocking", () => {
  it("blocks and unblocks another known diver, never oneself", () => {
    const data = store();
    expect(setBlocked(data, "ann", "bad", true)).toBe(true);
    expect(setBlocked(data, "ann", "bad", true)).toBe(true);
    expect(data.users[0].blocked).toEqual(["bad"]);
    expect(setBlocked(data, "ann", "ann", true)).toBe(false);
    expect(setBlocked(data, "ann", "nobody", true)).toBe(false);
    expect(setBlocked(data, "ann", "bad", false)).toBe(true);
    expect(data.users[0].blocked).toBeUndefined();
  });
});

describe("moderation", () => {
  it("removes a review with its photos, a site with its notes and photos, and a profile's words", () => {
    const data = store();
    const now = new Date(NOW).toISOString();
    expect(removeFlagged(data, { kind: "review", siteId: "s1", userId: "bad" }, now).map((item) => item.photo.id)).toEqual(["r1"]);
    expect(data.ratings[0]).toMatchObject({ removedAt: now });
    expect(data.ratings[0].review).toBeUndefined();
    expect(removeFlagged(data, { kind: "site", siteId: "pin", userId: "bad" }, now).map((item) => item.photo.id)).toEqual(["p1"]);
    expect(data.sites[0]).toMatchObject({ hidden: true });
    expect(data.sites[0].howToDive).toBeUndefined();
    removeFlagged(data, { kind: "diver", userId: "bad" }, now);
    expect(data.users[1].about).toBeUndefined();
    expect(data.users[1].nickname).toMatch(/^Diver /);
  });

  it("removes a site whose adder has since deleted their account", () => {
    const data = store();
    delete data.sites[0].addedBy;
    expect(removeFlagged(data, { kind: "site", siteId: "pin" }, new Date(NOW).toISOString())).toEqual([{ siteId: "pin", photo: photo("p1", "bad") }]);
    expect(data.sites[0]).toMatchObject({ hidden: true });
    expect(data.sites[0].howToDive).toBeUndefined();
  });

  it("bans a diver: signed out, posts removed, reports on them closed, and their sign-in refused", () => {
    const data = store();
    addFlag(data, "ann", { kind: "diver", userId: "bad", reason: "hate" }, NOW);
    addFlag(data, "ann", { kind: "review", siteId: "s1", userId: "bad", reason: "hate" }, NOW);
    const photos = banDiver(data, "bad", NOW);
    expect(photos?.map((item) => item.photo.id).sort()).toEqual(["p1", "r1"]);
    resolveFlags(data, data.flags[0], "banned", new Date(NOW).toISOString());
    expect(data.flags.every((flag) => flag.resolution === "banned")).toBe(true);
    expect(data.users[1]).toMatchObject({ bannedAt: new Date(NOW).toISOString(), sessionsValidFrom: NOW });

    data.logins.push({ email: "bad@example.com", codeHash: "h", sentAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 60_000).toISOString(), attempts: 0 });
    expect(finishLogin(data, "bad@example.com", "h", NOW + 1000, undefined, (a, b) => a === b, true)).toEqual({ ok: false, error: BANNED });
  });

  it("asks a diver from before the content rules to agree once at sign-in", () => {
    const data = store();
    const login = () => data.logins.push({ email: "bad@example.com", codeHash: "h", sentAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 60_000).toISOString(), attempts: 0 });
    login();
    expect(finishLogin(data, "bad@example.com", "h", NOW, undefined, (a, b) => a === b)).toEqual({ ok: false, error: TERMS_NEEDED, needsTerms: true });
    // The code still works for the second try, with the box ticked.
    expect(finishLogin(data, "bad@example.com", "h", NOW, undefined, (a, b) => a === b, true)).toMatchObject({ ok: true });
    expect(data.users[1].acceptedTermsAt).toBe(new Date(NOW).toISOString());
  });

  it("knows moderators by email in any case", () => {
    expect(isModeratorEmail("Owner@Example.com", " owner@example.com , other@example.com")).toBe(true);
    expect(isModeratorEmail("diver@example.com", "owner@example.com")).toBe(false);
    expect(isModeratorEmail("diver@example.com", null)).toBe(false);
  });

  it("refuses to ban oneself, the store-review account, a banned or unknown diver", () => {
    const data = store();
    data.users.push({ id: "review", email: "review@example.com", nickname: "Reviewer", createdAt: "", storeReview: true });
    expect(banRefusal(data, "bad", "ann")).toBeNull();
    expect(banRefusal(data, "ann", "ann")).toMatch("yourself");
    expect(banRefusal(data, "review", "ann")).toMatch("store-review");
    expect(banRefusal(data, "nobody", "ann")).toMatch("gone");
    expect(banRefusal(data, undefined, "ann")).toMatch("No diver");
    banDiver(data, "bad", NOW);
    expect(banRefusal(data, "bad", "ann")).toMatch("already");
  });

  it("removes or bans with or without a report, closing open reports on it, and refuses a ban banRefusal refuses", () => {
    const data = store();
    data.flags.push({ id: "f", reporterId: "ann", kind: "review", siteId: "s1", userId: "bad", reason: "hate", createdAt: "2026-11-01T00:00:00Z" });
    expect(moderate(data, { kind: "review", siteId: "s1", userId: "bad" }, "remove", "ann", NOW).map((item) => item.photo.id)).toEqual(["r1"]);
    expect(data.flags[0]).toMatchObject({ resolution: "removed" });
    expect(() => moderate(data, { kind: "diver", userId: "ann" }, "ban", "ann", NOW)).toThrow("yourself");
    expect(moderate(data, { kind: "site", siteId: "pin", userId: "bad" }, "ban", "ann", NOW).map((item) => item.photo.id)).toEqual(["p1"]);
    expect(data.users.find((user) => user.id === "bad")?.bannedAt).toBeTruthy();
  });

  it("hides a dive report from the forecast and shows it again, or hides all of one diver's", () => {
    const data = store();
    const report = (id: string, userId: string) => ({ id, siteId: "s1", time: "2026-11-17T09:00", direction: "incoming" as const, strength: "mild" as const, userId });
    data.reports.push(report("a", "bad"), report("b", "bad"), report("c", "ann"));
    expect(setReportHidden(data, "a", true, "2026-11-18T00:00:00Z")).toBe(true);
    expect(countedReports(data).map((item) => item.id)).toEqual(["b", "c"]);
    expect(setReportHidden(data, "a", false, "2026-11-18T00:00:00Z")).toBe(true);
    expect(countedReports(data).map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(setReportHidden(data, "nope", true, "2026-11-18T00:00:00Z")).toBe(false);
    expect(hideReportsBy(data, "bad", "2026-11-18T00:00:00Z")).toBe(2);
    expect(hideReportsBy(data, "bad", "2026-11-18T00:00:00Z")).toBe(0);
    expect(countedReports(data).map((item) => item.id)).toEqual(["c"]);
  });
});