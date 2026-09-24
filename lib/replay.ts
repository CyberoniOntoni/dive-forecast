import { forecastHours, parseWall } from "./forecast";
import type { HourForecast, MarineHour, Report } from "./types";

/** Matches forecast nearestIndex: a report further than 90 minutes is not in the series. */
const HOUR_MATCH_MS = 90 * 60 * 1000;

export type ReplayResult = {
  ok: boolean;
  failures: number;
  strengthMismatches: number;
};

/** Score each report with forecastHours using only earlier reports. No network and no invented tide. */
export function replayReports(input: {
  hours: readonly MarineHour[];
  inwardBearingDeg: number;
  reports: readonly Report[];
}): ReplayResult {
  const reports = [...input.reports].sort(byTime);
  let failures = 0;
  let strengthMismatches = 0;

  for (const report of reports) {
    if (!inSeries(input.hours, report.time)) continue;
    const earlier = reports.filter((item) => isEarlier(item.time, report.time));
    const forecast = forecastHours({
      hours: [...input.hours],
      inwardBearingDeg: input.inwardBearingDeg,
      reports: earlier,
    });
    const hour = nearestForecast(forecast, report.time);
    if (!hour) continue;
    if (hour.strength !== report.strength) strengthMismatches += 1;
    if (hour.confidence === "high" && hour.direction !== report.direction) failures += 1;
  }

  return { ok: failures === 0, failures, strengthMismatches };
}

function byTime(left: Report, right: Report): number {
  const a = parseWall(left.time);
  const b = parseWall(right.time);
  const aOk = Number.isFinite(a);
  const bOk = Number.isFinite(b);
  if (!aOk && !bOk) return 0;
  if (!aOk) return 1;
  if (!bOk) return -1;
  return a - b;
}

function isEarlier(left: string, right: string): boolean {
  const a = parseWall(left);
  const b = parseWall(right);
  return Number.isFinite(a) && Number.isFinite(b) && a < b;
}

function inSeries(hours: readonly MarineHour[], time: string): boolean {
  return nearestTime(hours, time) != null;
}

function nearestForecast(hours: readonly HourForecast[], time: string): HourForecast | null {
  return nearestTime(hours, time);
}

function nearestTime<T extends { time: string }>(hours: readonly T[], time: string): T | null {
  const target = parseWall(time);
  if (!Number.isFinite(target)) return null;
  let best: T | null = null;
  let bestAbs = Number.POSITIVE_INFINITY;
  for (const hour of hours) {
    const delta = Math.abs(parseWall(hour.time) - target);
    if (!Number.isFinite(delta) || delta >= bestAbs) continue;
    best = hour;
    bestAbs = delta;
  }
  return best != null && bestAbs <= HOUR_MATCH_MS ? best : null;
}
