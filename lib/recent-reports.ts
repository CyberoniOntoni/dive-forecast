import { parseWall } from "./forecast";
import { compassWord, strengthLabel } from "./nowcast-glance";
import type { Direction, Report, Strength } from "./types";

export const RECENT_REPORTS = 10;

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HOUR_MS = 60 * 60 * 1000;
const BANDS: readonly Strength[] = ["slack", "mild", "strong", "too_strong"];

/** How the forecast at a report's hour compared with it. */
export type ReportMatch = "match" | "close" | "miss";

/** One recent report as the site page lists it. No ids or tide data. */
export type RecentReportRow = {
  /** Maldives wall time, as stored. */
  time: string;
  /** "Tue 30 Sep 09:00". */
  when: string;
  /** "2 days ago". */
  ago: string;
  /** "Incoming", "Outgoing", or "Running NE". */
  way: string;
  strength: string;
  /** What the forecast said at that hour, or null when the report saved none. */
  forecast: { way: string; strength: string; match: ReportMatch } | null;
  /** A wall or lagoon report filed before the site was read along a compass axis: its in/out cannot be turned. */
  beforeAxis: boolean;
};

/**
 * The newest reports first, at most `limit`, as rows for the site page. `siteOnAxis` is true for a wall or lagoon
 * site, whose reports read as compass directions from the heading each one saved.
 */
export function recentReportRows(
  reports: readonly Report[],
  options: { nowWall: string; siteOnAxis: boolean; limit?: number },
): RecentReportRow[] {
  const nowMs = parseWall(options.nowWall);
  return [...reports]
    .filter((report) => !Number.isNaN(parseWall(report.time)))
    .sort((a, b) => parseWall(b.time) - parseWall(a.time))
    .slice(0, options.limit ?? RECENT_REPORTS)
    .map((report) => {
      const heading = typeof report.alongHeadingDeg === "number" ? report.alongHeadingDeg : null;
      const wayOf = (direction: Direction) => wayWord(direction, heading);
      const shown = report.predicted?.shown;
      return {
        time: report.time,
        when: wallLabel(report.time),
        ago: agoLabel(parseWall(report.time), nowMs),
        way: wayOf(report.direction),
        strength: strengthLabel(report.strength),
        forecast: shown
          ? { way: wayOf(shown.direction), strength: strengthLabel(shown.strength), match: matchOf(report, shown) }
          : null,
        beforeAxis: options.siteOnAxis && heading == null,
      };
    });
}

function wayWord(direction: Direction, heading: number | null): string {
  if (heading == null) return direction === "incoming" ? "Incoming" : "Outgoing";
  return `Running ${compassWord(direction === "incoming" ? heading : heading + 180)}`;
}

/**
 * Right direction and strength within one band is a match; right direction further off is close; the wrong way is
 * a miss. A slack report or slack forecast has no direction to compare, so only strength counts.
 */
function matchOf(report: Report, shown: { direction: Direction; strength: Strength }): ReportMatch {
  const gap = Math.abs(BANDS.indexOf(report.strength) - BANDS.indexOf(shown.strength));
  const slack = report.strength === "slack" || shown.strength === "slack";
  if (!slack && report.direction !== shown.direction) return "miss";
  return gap <= 1 ? "match" : "close";
}

function wallLabel(time: string): string {
  const ms = parseWall(time);
  const date = new Date(ms);
  const clock = time.slice(11, 16);
  return `${DAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${clock}`;
}

function agoLabel(thenMs: number, nowMs: number): string {
  if (!Number.isFinite(nowMs)) return "";
  const hours = Math.round((nowMs - thenMs) / HOUR_MS);
  if (hours < 0) return "ahead";
  if (hours < 1) return "just now";
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days < 60) return days === 1 ? "1 day ago" : `${days} days ago`;
  const months = Math.round(days / 30);
  return `${months} months ago`;
}
