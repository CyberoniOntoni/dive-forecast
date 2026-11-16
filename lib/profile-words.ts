import { FRESH_HOURS, PATHFINDER_DAYS, POINTS, RATINGS_PER_DAY, REPORTS_PER_DAY } from "./points-rules";

/**
 * The scoreboard's and diver pages' words, shared by the web pages (app/scoreboard, app/divers, app/account) and the
 * app's API (lib/api-v1.ts), so the phone shows what the web says.
 */

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "12 reports · 5 sites · 3 ratings · 2 ★" under a reporter's nickname. */
export function reporterDetail(row: { reports: number; sites: number; ratings: number; badges: number }): string {
  return [
    row.reports ? count(row.reports, "report", "reports") : null,
    row.reports ? count(row.sites, "site", "sites") : null,
    row.ratings ? count(row.ratings, "rating", "ratings") : null,
    row.badges ? `${row.badges} ★` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "3 reported by other divers" under a site scout's nickname. */
export function scoutDetail(row: { reportedByOthers: number }): string {
  return `${row.reportedByOthers} reported by other divers`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 2026" from "2026-10". */
export function monthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  return MONTHS[month - 1] ? `${MONTHS[month - 1]} ${year}` : yearMonth;
}

/** The account page's "How points work", one line each. */
export function pointsRuleLines(): string[] {
  return [
    `${POINTS.report} points for each current report.`,
    `+${POINTS.fresh} when you file it within ${FRESH_HOURS} hours of the dive, while it is fresh.`,
    `+${POINTS.pathfinder} when nobody had reported that site in the ${PATHFINDER_DAYS} days before your dive.`,
    `${POINTS.rating} points for rating a site, once per site, up to ${RATINGS_PER_DAY} ratings a day.`,
    `Up to ${REPORTS_PER_DAY} reports a day count, and one per dive. Agreeing with the forecast earns nothing: report what you felt.`,
  ];
}

export type BoardId = "month" | "all" | "sites";

/** A board's heading, the line under it, and what it says with no rows yet. */
export function boardWords(board: BoardId): { title: string; note: string; empty: string } {
  if (board === "sites") {
    return {
      title: "Site scouts",
      note: "Divers who added dive sites to the map, and how many of those other divers have since reported at.",
      // Said so it fits both the web map's Add site panel and the app's long-press.
      empty: "No sites added yet. Know a site that is missing? Add it on the map.",
    };
  }
  return {
    title: "Current reporters",
    note: "Points for each report, more for reporting soon after the dive and at sites nobody has reported lately, and for rating the sites you dived.",
    empty: `No reports ${board === "month" ? "this month " : ""}yet. Be the first: open a site after your dive and report the current.`,
  };
}

/** "site" or "sites" after a scout's count. */
export function sitesUnit(sites: number): string {
  return sites === 1 ? "site" : "sites";
}

/** "Diving with us since Oct 2026 · #3 all time" under a diver's nickname. */
export function sinceLine(since: string, allRank: number | null): string {
  return `Diving with us since ${monthLabel(since)}${allRank ? ` · #${allRank} all time` : ""}`;
}
