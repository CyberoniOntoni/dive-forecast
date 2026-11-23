import { describe, expect, it } from "vitest";
import { activityCounts, readActivityFilter, recentActivity } from "./activity";
import type { StoreData } from "./types";

const NOW = Date.parse("2026-11-23T06:00:00Z");
const photo = (id: string, addedBy: string) => ({ id, addedBy, addedAt: "2026-11-20T00:00:00Z" });

function store(): StoreData {
  return {
    reports: [
      {
        id: "r1",
        siteId: "cat",
        time: "2026-11-22T09:00",
        direction: "incoming",
        strength: "too_strong",
        filedAt: "2026-11-22T05:00:00Z",
        userId: "ann",
        predicted: {
          modelVersion: "26",
          nudge: "drift",
          issuedAt: null,
          stale: false,
          bearingDeg: 90,
          bearingSource: null,
          shown: { direction: "outgoing", strength: "mild", confidence: "low" },
          modelOnly: null,
        },
      },
      { id: "old", siteId: "cat", time: "2026-09-01T09:00", direction: "incoming", strength: "mild", filedAt: "2026-09-01T04:00:00Z", userId: "ann" },
      { id: "gone", siteId: "cat", time: "2026-11-21T10:00", direction: "outgoing", strength: "slack", userId: "deleted-x" },
      { id: "rev", siteId: "cat", time: "2026-11-22T11:00", direction: "outgoing", strength: "mild", filedAt: "2026-11-22T06:30:00Z", userId: "store" },
    ],
    ratings: [
      { siteId: "cat", score: 2, updatedAt: "2026-11-21T00:00:00Z", userId: "bad", review: "Rude words", photos: [photo("p1", "bad")] },
      { siteId: "cat", score: 5, updatedAt: "2026-11-20T00:00:00Z", userId: "ann" },
      { siteId: "pin", score: 4, updatedAt: "2026-11-22T00:00:00Z", userId: "ann", removedAt: "2026-11-22T00:00:00Z" },
    ],
    sites: [
      { id: "pin", name: "New Pin", atollId: "x", lat: 4, lon: 73, sourceUrl: "user", addedBy: "bad", addedAt: "2026-11-19T00:00:00Z", howToDive: "Spam", diverSiteType: "channel-thila", diveTopM: 5, diveMaxM: 30 },
    ],
    users: [
      { id: "ann", email: "ann@example.com", nickname: "Ann", createdAt: "2026-10-01T00:00:00Z", acceptedTermsAt: "2026-10-01T00:00:00Z" },
      { id: "bad", email: "bad@example.com", nickname: "Rude", createdAt: "2026-11-18T00:00:00Z", about: "Offensive" },
      { id: "store", email: "reviewer@example.com", nickname: "Reviewer", createdAt: "2026-11-18T12:00:00Z", storeReview: true, acceptedTermsAt: "2026-11-18T12:00:00Z" },
    ],
    logins: [],
    plans: [
      {
        id: "plan1",
        ownerId: "ann",
        title: "Safari week",
        boatSpeedKn: 9,
        days: [{ date: "2026-11-24", stops: [{ siteId: "cat", time: "09:00" }, { siteId: "pin", time: "14:00" }] }],
        createdAt: "2026-11-21T00:00:00Z",
        updatedAt: "2026-11-22T00:00:00Z",
      },
    ],
    flags: [{ id: "f1", reporterId: "ann", kind: "review", siteId: "cat", userId: "bad", reason: "hate", note: "Nasty", createdAt: "2026-11-21T01:00:00Z" }],
  };
}

const lookup = (id: string) => (id === "cat" ? { name: "Catalog Kandu" } : null);

describe("recent activity for moderators", () => {
  it("lists every kind from the last 30 days, newest first, and never an email", () => {
    const items = recentActivity(store(), lookup, NOW);
    expect(items.map((item) => item.key)).toEqual([
      "report:rev",
      "report:r1",
      "plan:plan1",
      "report:gone",
      "flag:f1",
      "rating:cat:bad",
      "rating:cat:ann",
      "site:pin",
      "signup:store",
      "signup:bad",
    ]);
    expect(JSON.stringify(items)).not.toContain("@example.com");
    expect(activityCounts(items)).toEqual({ report: 3, review: 1, rating: 1, site: 1, plan: 1, signup: 2, flag: 1 });
  });

  it("describes each item and what a moderator can take down", () => {
    const byKey = new Map(recentActivity(store(), lookup, NOW).map((item) => [item.key, item]));
    expect(byKey.get("report:r1")).toMatchObject({
      diver: { nickname: "Ann", storeReview: false },
      site: { id: "cat", name: "Catalog Kandu" },
      summary: "Dive report: incoming, very strong at 2026-11-22 09:00 (Maldives); forecast said outgoing, mild",
      removable: null,
    });
    expect(byKey.get("report:gone")).toMatchObject({ diver: null, at: "2026-11-21T05:00:00.000Z" });
    expect(byKey.get("report:rev")?.diver).toMatchObject({ nickname: "Reviewer", storeReview: true });
    expect(byKey.get("rating:cat:bad")).toMatchObject({
      kind: "review",
      summary: "Review, 2/5, 1 photo",
      text: "Rude words",
      photos: ["/site-photos/cat/p1.jpg"],
      removable: { kind: "review", siteId: "cat", userId: "bad" },
      openFlags: 1,
    });
    expect(byKey.get("rating:cat:ann")).toMatchObject({ kind: "rating", removable: null });
    expect(byKey.get("site:pin")).toMatchObject({
      summary: "New site (channel thila), 5–30 m",
      text: "Spam",
      removable: { kind: "site", siteId: "pin", userId: "bad" },
    });
    expect(byKey.get("plan:plan1")).toMatchObject({ summary: "Dive plan edited: “Safari week”, 1 day, 2 dives", href: "/plans/plan1" });
    expect(byKey.get("signup:bad")).toMatchObject({ text: "About me: Offensive", summary: expect.stringContaining("not agreed"), removable: { kind: "diver", userId: "bad" } });
    expect(byKey.get("flag:f1")).toMatchObject({ diver: { nickname: "Ann" }, summary: "Reported a review by Rude: Hate, harassment or bullying (open)", text: "Nasty" });
  });

  it("filters by kind and caps the list", () => {
    expect(recentActivity(store(), lookup, NOW, { kinds: ["review", "rating"] }).map((item) => item.kind)).toEqual(["review", "rating"]);
    expect(recentActivity(store(), lookup, NOW, { max: 2 })).toHaveLength(2);
    expect(recentActivity(store(), lookup, NOW, { days: 2 }).map((item) => item.key)).toEqual(["report:rev", "report:r1", "plan:plan1"]);
    expect(readActivityFilter("reviews")).toBe("reviews");
    expect(readActivityFilter("constructor")).toBe("all");
    expect(readActivityFilter(["reviews"])).toBe("all");
  });
});
