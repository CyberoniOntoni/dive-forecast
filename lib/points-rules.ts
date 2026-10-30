/** The points table, with no imports, so the report form can show it without loading the forecast code. */

export const POINTS = {
  /** Any counted report. */
  report: 10,
  /** Filed within FRESH_HOURS of the dive. */
  fresh: 5,
  /** Nobody had reported the site in the PATHFINDER_DAYS before this dive. */
  pathfinder: 10,
} as const;

export const FRESH_HOURS = 3;
export const PATHFINDER_DAYS = 30;
/** Counted reports per diver per dive day; more than a day's dives is not more help. */
export const REPORTS_PER_DAY = 4;
/** A second report at the same site within this many hours of a counted one is the same dive. */
export const SAME_DIVE_HOURS = 2;

export type AwardReason = "report" | "fresh" | "pathfinder";

export type ReportAward = {
  reportId: string;
  points: number;
  reasons: AwardReason[];
  /** Why a report earned nothing. */
  uncounted?: "daily-limit" | "same-dive";
};

export type BadgeId =
  | "first-report"
  | "reports-10"
  | "reports-50"
  | "sites-5"
  | "sites-15"
  | "atolls-3"
  | "pathfinder"
  | "fresh-10"
  | "streak-3"
  | "streak-7"
  | "site-scout";

export const BADGES: readonly { id: BadgeId; label: string; detail: string }[] = [
  { id: "first-report", label: "First report", detail: "Filed a first current report" },
  { id: "reports-10", label: "Regular", detail: "10 counted reports" },
  { id: "reports-50", label: "Current keeper", detail: "50 counted reports" },
  { id: "sites-5", label: "Explorer", detail: "Reported at 5 different sites" },
  { id: "sites-15", label: "Wanderer", detail: "Reported at 15 different sites" },
  { id: "atolls-3", label: "Atoll hopper", detail: "Reported in 3 atolls" },
  { id: "pathfinder", label: "Pathfinder", detail: `First report at a site in ${PATHFINDER_DAYS} days` },
  { id: "fresh-10", label: "On the spot", detail: `10 reports filed within ${FRESH_HOURS} hours of the dive` },
  { id: "streak-3", label: "Three-day run", detail: "Reported on 3 dive days in a row" },
  { id: "streak-7", label: "Week aboard", detail: "Reported on 7 dive days in a row" },
  { id: "site-scout", label: "Site scout", detail: "Added a site that another diver then reported at" },
];
