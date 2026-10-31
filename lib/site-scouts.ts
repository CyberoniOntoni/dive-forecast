import type { Report, Site, User } from "./types";

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
 * The scoreboard's New sites board, kept apart from the points in points.ts: adding a site earns no points, so adding
 * pins is never a way up the points board.
 *
 * Divers who added dive sites, most first; ties go to the one whose sites other divers have reported at more, then by
 * name.
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
