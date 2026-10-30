import { describe, expect, it } from "vitest";
import { diverStats, leaderboard, longestDayRun, reportAwards } from "./points";
import type { Report, User } from "./types";

function report(id: string, userId: string | undefined, siteId: string, time: string, filedAt?: string): Report {
  return { id, siteId, time, direction: "incoming", strength: "mild", userId, filedAt };
}

const users: User[] = [
  { id: "a", email: "a@x.co", nickname: "Ann", createdAt: "" },
  { id: "b", email: "b@x.co", nickname: "Bob", createdAt: "" },
];

describe("reportAwards", () => {
  it("gives the base, a fresh bonus within 3 hours, and a pathfinder bonus at a quiet site", () => {
    // 09:00 Maldives is 04:00Z.
    const awards = reportAwards([
      report("1", "a", "s1", "2026-10-01T09:00", "2026-10-01T05:30:00Z"),
      report("2", "b", "s1", "2026-10-01T11:00", "2026-10-02T05:00:00Z"),
    ]);
    expect(awards.get("1")).toMatchObject({ points: 25, reasons: ["report", "fresh", "pathfinder"] });
    expect(awards.get("2")).toMatchObject({ points: 10, reasons: ["report"] });
  });

  it("counts one report per dive and four per day", () => {
    const reports = [
      report("1", "a", "s1", "2026-10-01T09:00"),
      report("2", "a", "s1", "2026-10-01T10:00"),
      report("3", "a", "s2", "2026-10-01T11:00"),
      report("4", "a", "s3", "2026-10-01T14:00"),
      report("5", "a", "s4", "2026-10-01T16:00"),
      report("6", "a", "s5", "2026-10-01T18:00"),
    ];
    const awards = reportAwards(reports);
    expect(awards.get("2")).toMatchObject({ points: 0, uncounted: "same-dive" });
    expect(awards.get("6")).toMatchObject({ points: 0, uncounted: "daily-limit" });
    expect([...awards.values()].filter((award) => award.points > 0)).toHaveLength(4);
  });

  it("lets an anonymous report block a pathfinder bonus but earn nothing itself", () => {
    const awards = reportAwards([
      report("old", undefined, "s1", "2026-10-01T09:00"),
      report("1", "a", "s1", "2026-10-10T09:00"),
    ]);
    expect(awards.has("old")).toBe(false);
    expect(awards.get("1")?.reasons).toEqual(["report"]);
  });
});

describe("diverStats and leaderboard", () => {
  it("adds up points, sites, atolls, streaks and badges, and ranks by the period", () => {
    const reports = [
      report("1", "a", "s1", "2026-10-01T09:00"),
      report("2", "a", "s2", "2026-10-02T09:00"),
      report("3", "a", "s3", "2026-10-03T09:00"),
      report("4", "b", "s4", "2026-09-10T09:00"),
      report("5", "b", "s5", "2026-09-11T09:00"),
      report("6", "b", "s6", "2026-09-12T09:00"),
      report("7", "b", "s7", "2026-09-20T09:00"),
    ];
    const sites = [
      { id: "s1", atollId: "x" },
      { id: "s2", atollId: "y" },
      { id: "s3", atollId: "z" },
      { id: "s4", atollId: "x", addedBy: "a" },
    ];
    const stats = diverStats(reports, users, sites, Date.parse("2026-10-15T00:00:00Z"));
    const ann = stats.find((item) => item.userId === "a")!;
    expect(ann).toMatchObject({ points: 60, monthPoints: 60, reports: 3, sites: 3, atolls: 3, bestStreak: 3 });
    expect(ann.badges).toEqual(["first-report", "atolls-3", "pathfinder", "streak-3", "site-scout"]);
    expect(leaderboard(stats, "month").map((row) => [row.nickname, row.rank])).toEqual([["Ann", 1]]);
    expect(leaderboard(stats, "all").map((row) => [row.nickname, row.rank, row.periodPoints])).toEqual([
      ["Bob", 1, 80],
      ["Ann", 2, 60],
    ]);
  });
});

describe("longestDayRun", () => {
  it("finds the longest run of consecutive days", () => {
    expect(longestDayRun([])).toBe(0);
    expect(longestDayRun(["2026-10-01", "2026-10-01", "2026-10-02", "2026-10-04", "2026-10-05", "2026-10-06"])).toBe(3);
    expect(longestDayRun(["2026-02-28", "2026-03-01"])).toBe(2);
  });
});
