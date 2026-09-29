import { forecastHours, parseWall } from "./forecast";
import type { HourForecast, MarineHour, Report } from "./types";

/** Matches forecast nearestIndex: a report further than 90 minutes is not in the series. */
const HOUR_MATCH_MS = 90 * 60 * 1000;

export type BenchmarkMetrics = {
  totalReports: number;
  directionalAccuracyPct: number;
  slackTimingDeviationMins: number;
  /** Slack reports behind slackTimingDeviationMins. One with no predicted slack or turn in the series is left out. */
  slackReports: number;
  falseHighConfidenceRatePct: number;
  confidenceBreakdown: {
    high: { count: number; accuracyPct: number };
    medium: { count: number; accuracyPct: number };
    low: { count: number; accuracyPct: number };
  };
};

export type ReplayResult = {
  ok: boolean;
  failures: number;
  strengthMismatches: number;
  metrics: BenchmarkMetrics;
};

export type ReplayInput = {
  hours: readonly MarineHour[];
  inwardBearingDeg: number;
  reports: readonly Report[];
  channelWidthM?: number;
  channelDepthM?: number;
  allowHighConfidence?: boolean;
};

/** Score each report with forecastHours using only earlier reports. No network and no invented tide. */
export function replayReports(input: ReplayInput): ReplayResult {
  const reports = [...input.reports].sort(byTime);
  let failures = 0;
  let strengthMismatches = 0;

  let totalReports = 0;
  let directionalMatches = 0;
  const slackDeviationsMins: number[] = [];

  const tierCounts = { high: 0, medium: 0, low: 0 };
  const tierMatches = { high: 0, medium: 0, low: 0 };

  for (const report of reports) {
    if (!inSeries(input.hours, report.time)) continue;
    const earlier = reports.filter((item) => isEarlier(item.time, report.time));
    const forecast = forecastHours({
      hours: [...input.hours],
      inwardBearingDeg: input.inwardBearingDeg,
      reports: earlier,
      channelWidthM: input.channelWidthM,
      channelDepthM: input.channelDepthM,
      allowHighConfidence: input.allowHighConfidence,
    });
    const hour = nearestForecast(forecast, report.time);
    if (!hour) continue;

    totalReports += 1;

    // Strength mismatch check (preserved from baseline)
    if (hour.strength !== report.strength) strengthMismatches += 1;

    // Directional agreement check (accounting for slack conditions)
    const directionAgreed = isDirectionMatch(hour, report);
    if (directionAgreed) {
      directionalMatches += 1;
    }

    // High confidence failure check
    if (hour.confidence === "high" && !directionAgreed) {
      failures += 1;
    }

    // Confidence breakdown tracking
    const tier = hour.confidence;
    if (tier === "high" || tier === "medium" || tier === "low") {
      tierCounts[tier] += 1;
      if (directionAgreed) {
        tierMatches[tier] += 1;
      }
    }

    // Slack timing deviation check
    if (report.strength === "slack") {
      const dev = nearestSlackDeviationMins(forecast, report.time);
      if (dev != null) {
        slackDeviationsMins.push(dev);
      }
    }
  }

  const directionalAccuracyPct =
    totalReports > 0 ? round2((directionalMatches / totalReports) * 100) : 0;

  const falseHighConfidenceRatePct =
    totalReports > 0 ? round2((failures / totalReports) * 100) : 0;

  const slackTimingDeviationMins =
    slackDeviationsMins.length > 0
      ? round2(
          slackDeviationsMins.reduce((sum, d) => sum + d, 0) / slackDeviationsMins.length,
        )
      : 0;

  const metrics: BenchmarkMetrics = {
    totalReports,
    directionalAccuracyPct,
    slackTimingDeviationMins,
    slackReports: slackDeviationsMins.length,
    falseHighConfidenceRatePct,
    confidenceBreakdown: {
      high: {
        count: tierCounts.high,
        accuracyPct:
          tierCounts.high > 0 ? round2((tierMatches.high / tierCounts.high) * 100) : 0,
      },
      medium: {
        count: tierCounts.medium,
        accuracyPct:
          tierCounts.medium > 0
            ? round2((tierMatches.medium / tierCounts.medium) * 100)
            : 0,
      },
      low: {
        count: tierCounts.low,
        accuracyPct:
          tierCounts.low > 0 ? round2((tierMatches.low / tierCounts.low) * 100) : 0,
      },
    },
  };

  return {
    ok: failures === 0,
    failures,
    strengthMismatches,
    metrics,
  };
}

/** Check if predicted direction matches report, accounting for slack conditions without penalty */
function isDirectionMatch(hour: HourForecast, report: Report): boolean {
  if (report.strength === "slack" || hour.strength === "slack") {
    return true;
  }
  return hour.direction === report.direction;
}

/** Minutes to the nearest predicted slack hour or turn. Null when the forecast has neither, so there is nothing to time. */
function nearestSlackDeviationMins(
  forecast: readonly HourForecast[],
  reportTime: string,
): number | null {
  const repMs = parseWall(reportTime);
  if (!Number.isFinite(repMs)) return null;

  const slackTimesMs: number[] = [];

  for (let i = 0; i < forecast.length; i += 1) {
    const hour = forecast[i];
    const hourMs = parseWall(hour.time);
    if (!Number.isFinite(hourMs)) continue;

    if (hour.strength === "slack") {
      slackTimesMs.push(hourMs);
    } else if (i < forecast.length - 1) {
      const next = forecast[i + 1];
      const nextMs = parseWall(next.time);
      if (
        Number.isFinite(nextMs) &&
        hour.direction !== next.direction &&
        next.strength !== "slack"
      ) {
        // Zero-crossing turn between opposite flows
        slackTimesMs.push((hourMs + nextMs) / 2);
      }
    }
  }

  if (slackTimesMs.length === 0) return null;

  let minDiffMs = Number.POSITIVE_INFINITY;
  for (const sMs of slackTimesMs) {
    const diff = Math.abs(repMs - sMs);
    if (diff < minDiffMs) {
      minDiffMs = diff;
    }
  }

  return Number.isFinite(minDiffMs) ? minDiffMs / (60 * 1000) : null;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
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

function nearestForecast(
  hours: readonly HourForecast[],
  time: string,
): HourForecast | null {
  return nearestTime(hours, time);
}

function nearestTime<T extends { time: string }>(
  hours: readonly T[],
  time: string,
): T | null {
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
