import { parseWall, toMaldivesWall } from "./forecast";
import {
  BADGES,
  FRESH_HOURS,
  PATHFINDER_DAYS,
  POINTS,
  RATINGS_PER_DAY,
  REPORTS_PER_DAY,
  SAME_DIVE_HOURS,
  type AwardReason,
  type BadgeId,
  type ReportAward,
} from "./points-rules";
import type { Rating, Report, Site, User } from "./types";

/**
 * Points and badges for signed-in divers' reports, worked out from the reports each time, never stored, so a rule can
 * change without a migration. They reward what makes the forecast better: reporting at all, reporting soon after the
 * dive, reporting where nobody has lately, and rating the sites. Agreement with the forecast earns nothing, so nobody is nudged to
 * report what the app expects.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type DiverStats = {
  userId: string;
  nickname: string;
  points: number;
  /** Points from dives in the current Maldives month. */
  monthPoints: number;
  /** Reports that earned points. */
  reports: number;
  /** Sites rated (each site once). */
  ratings: number;
  sites: number;
  atolls: number;
  /** Longest run of consecutive dive days with a counted report. */
  bestStreak: number;
  badges: BadgeId[];
};

function filedMs(report: Report): number {
  if (report.filedAt) {
    const wall = toMaldivesWall(report.filedAt);
    return parseWall(wall);
  }
  return parseWall(report.time);
}

/** Every report's award, in the order they were filed. Reports without a diver earn nothing and are left out. */
export function reportAwards(reports: readonly Report[]): Map<string, ReportAward> {
  const ordered = [...reports]
    .filter((report) => !Number.isNaN(parseWall(report.time)))
    .sort((a, b) => filedMs(a) - filedMs(b) || a.id.localeCompare(b.id));
  const awards = new Map<string, ReportAward>();
  const seenAtSite = new Map<string, number[]>();
  const countedByDay = new Map<string, number>();
  const countedAtSite = new Map<string, number[]>();

  for (const report of ordered) {
    const diveMs = parseWall(report.time);
    const earlier = seenAtSite.get(report.siteId) ?? [];
    const pathfinder = !earlier.some((ms) => ms <= diveMs && diveMs - ms <= PATHFINDER_DAYS * DAY_MS);
    seenAtSite.set(report.siteId, [...earlier, diveMs]);
    if (!report.userId) continue;

    const siteKey = `${report.userId}|${report.siteId}`;
    const sameDive = (countedAtSite.get(siteKey) ?? []).some((ms) => Math.abs(ms - diveMs) < SAME_DIVE_HOURS * HOUR_MS);
    if (sameDive) {
      awards.set(report.id, { reportId: report.id, points: 0, reasons: [], uncounted: "same-dive" });
      continue;
    }
    const dayKey = `${report.userId}|${report.time.slice(0, 10)}`;
    const today = countedByDay.get(dayKey) ?? 0;
    if (today >= REPORTS_PER_DAY) {
      awards.set(report.id, { reportId: report.id, points: 0, reasons: [], uncounted: "daily-limit" });
      continue;
    }
    countedByDay.set(dayKey, today + 1);
    countedAtSite.set(siteKey, [...(countedAtSite.get(siteKey) ?? []), diveMs]);

    const reasons: AwardReason[] = ["report"];
    const lagMs = filedMs(report) - diveMs;
    if (report.filedAt && lagMs >= -HOUR_MS && lagMs <= FRESH_HOURS * HOUR_MS) reasons.push("fresh");
    if (pathfinder) reasons.push("pathfinder");
    awards.set(report.id, {
      reportId: report.id,
      points: reasons.reduce((sum, reason) => sum + POINTS[reason], 0),
      reasons,
    });
  }
  return awards;
}

/**
 * The Maldives day and month of each signed-in diver's site ratings that earn points: one per site (the store keeps one
 * per diver and site), at most RATINGS_PER_DAY a day by when each was last saved.
 */
export function countedRatings(ratings: readonly Rating[]): Map<string, { day: string }[]> {
  const byUser = new Map<string, { day: string }[]>();
  const perDay = new Map<string, number>();
  const ordered = [...ratings]
    .filter((rating) => rating.userId && !Number.isNaN(Date.parse(rating.updatedAt)))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.siteId.localeCompare(b.siteId));
  for (const rating of ordered) {
    const day = toMaldivesWall(rating.updatedAt).slice(0, 10);
    const dayKey = `${rating.userId}|${day}`;
    const today = perDay.get(dayKey) ?? 0;
    if (today >= RATINGS_PER_DAY) continue;
    perDay.set(dayKey, today + 1);
    byUser.set(rating.userId!, [...(byUser.get(rating.userId!) ?? []), { day }]);
  }
  return byUser;
}

/** Each signed-in diver's points, counts and badges. Divers with no reports, ratings or badges are left out. */
export function diverStats(
  reports: readonly Report[],
  users: readonly User[],
  sites: readonly Pick<Site, "id" | "atollId" | "addedBy">[],
  nowMs: number = Date.now(),
  ratings: readonly Rating[] = [],
): DiverStats[] {
  const awards = reportAwards(reports);
  const rated = countedRatings(ratings);
  const atollOf = new Map(sites.map((site) => [site.id, site.atollId]));
  const month = toMaldivesWall(new Date(nowMs).toISOString()).slice(0, 7);
  const reportersBySite = new Map<string, Set<string>>();
  for (const report of reports) {
    if (!report.userId) continue;
    const set = reportersBySite.get(report.siteId) ?? new Set<string>();
    set.add(report.userId);
    reportersBySite.set(report.siteId, set);
  }

  return users
    .map((user) => {
      const counted = reports.filter((report) => report.userId === user.id && (awards.get(report.id)?.points ?? 0) > 0);
      const mine = counted.map((report) => ({ report, award: awards.get(report.id)! }));
      const myRatings = rated.get(user.id) ?? [];
      const points = mine.reduce((sum, item) => sum + item.award.points, 0) + myRatings.length * POINTS.rating;
      const monthPoints =
        mine.filter((item) => item.report.time.slice(0, 7) === month).reduce((sum, item) => sum + item.award.points, 0) +
        myRatings.filter((item) => item.day.slice(0, 7) === month).length * POINTS.rating;
      const siteIds = new Set(counted.map((report) => report.siteId));
      const atollIds = new Set([...siteIds].map((id) => atollOf.get(id)).filter((id): id is string => id != null));
      const bestStreak = longestDayRun(counted.map((report) => report.time.slice(0, 10)));
      const fresh = mine.filter((item) => item.award.reasons.includes("fresh")).length;
      const scout = sites.some(
        (site) =>
          site.addedBy === user.id && [...(reportersBySite.get(site.id) ?? [])].some((id) => id !== user.id),
      );
      const earned: Record<BadgeId, boolean> = {
        "first-report": counted.length >= 1,
        "reports-10": counted.length >= 10,
        "reports-50": counted.length >= 50,
        "sites-5": siteIds.size >= 5,
        "sites-15": siteIds.size >= 15,
        "atolls-3": atollIds.size >= 3,
        pathfinder: mine.some((item) => item.award.reasons.includes("pathfinder")),
        "fresh-10": fresh >= 10,
        "streak-3": bestStreak >= 3,
        "streak-7": bestStreak >= 7,
        "site-scout": scout,
        "ratings-10": myRatings.length >= 10,
      };
      return {
        userId: user.id,
        nickname: user.nickname,
        points,
        monthPoints,
        reports: counted.length,
        ratings: myRatings.length,
        sites: siteIds.size,
        atolls: atollIds.size,
        bestStreak,
        badges: BADGES.map((badge) => badge.id).filter((id) => earned[id]),
      };
    })
    .filter((stats) => stats.reports > 0 || stats.ratings > 0 || stats.badges.length > 0);
}

export type LeaderboardPeriod = "month" | "all";

/** Divers ranked by points for the period, ties sharing a rank. Divers with no points in the period are left out. */
export function leaderboard(
  stats: readonly DiverStats[],
  period: LeaderboardPeriod,
): (DiverStats & { rank: number; periodPoints: number })[] {
  const scored = stats
    .map((item) => ({ ...item, periodPoints: period === "month" ? item.monthPoints : item.points }))
    .filter((item) => item.periodPoints > 0)
    .sort(
      (a, b) =>
        b.periodPoints - a.periodPoints || b.reports - a.reports || a.nickname.localeCompare(b.nickname),
    );
  let rank = 0;
  return scored.map((item, index) => {
    if (index === 0 || item.periodPoints !== scored[index - 1].periodPoints) rank = index + 1;
    return { ...item, rank };
  });
}

/** The longest run of consecutive calendar days among "YYYY-MM-DD" dates. */
export function longestDayRun(dates: readonly string[]): number {
  const days = [...new Set(dates)].map((date) => Date.parse(`${date}T00:00:00Z`)).filter(Number.isFinite).sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let index = 0; index < days.length; index += 1) {
    run = index > 0 && days[index] - days[index - 1] === DAY_MS ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

export type SiteScout = {
  userId: string;
  nickname: string;
  rank: number;
  /** Sites this diver added in the app. */
  sites: number;
  /** Of those, how many another diver has since reported at. */
  reportedByOthers: number;
};

/**
 * Divers who added dive sites, most first; ties go to the one whose sites other divers have reported at more, then by
 * name. No points: a pin earns its place on this board, not on the reports board, so adding pins is never a way to climb it.
 */
export function siteScouts(
  sites: readonly Pick<Site, "id" | "addedBy">[],
  users: readonly User[],
  reports: readonly Pick<Report, "siteId" | "userId">[],
): SiteScout[] {
  const nickname = new Map(users.map((user) => [user.id, user.nickname]));
  const byUser = new Map<string, { sites: number; reportedByOthers: number }>();
  for (const site of sites) {
    if (!site.addedBy || !nickname.has(site.addedBy)) continue;
    const row = byUser.get(site.addedBy) ?? { sites: 0, reportedByOthers: 0 };
    row.sites += 1;
    if (reports.some((report) => report.siteId === site.id && report.userId && report.userId !== site.addedBy)) {
      row.reportedByOthers += 1;
    }
    byUser.set(site.addedBy, row);
  }
  const sorted = [...byUser.entries()]
    .map(([userId, row]) => ({ userId, nickname: nickname.get(userId)!, ...row }))
    .sort((a, b) => b.sites - a.sites || b.reportedByOthers - a.reportedByOthers || a.nickname.localeCompare(b.nickname));
  let rank = 0;
  return sorted.map((row, index) => {
    const prev = sorted[index - 1];
    if (!prev || prev.sites !== row.sites || prev.reportedByOthers !== row.reportedByOthers) rank = index + 1;
    return { ...row, rank };
  });
}
