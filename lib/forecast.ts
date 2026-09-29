import {
  STRENGTHS,
  type Direction,
  type ForecastInput,
  type HourForecast,
  type MarineHour,
  type Report,
  type Strength,
} from "./types";

import { getMaldivesMonsoonDrift, type OceanDrift } from "./seasonal";

export type { ForecastInput, OceanDrift };
export { getMaldivesMonsoonDrift };

export const FORECAST_NOTICE =
  "The 8 km grid is weak in passes. Direction comes from the tide slope plus reports, not from the current at the dive pin.";

const HOUR_MS = 60 * 60 * 1000;
const TIE_M = 0.005;
const SLACK_SLOPE_M = 0.02;
const FADE_HOURS = 6;
const MEAN_HALF_HOURS = 12;
const MIN_MEAN_SAMPLES = 18;
const WINDOW_HALF_HOURS = 6;
const WINDOW_HOURS = WINDOW_HALF_HOURS * 2 + 1;
const HOUR_MATCH_MS = 45 * 60 * 1000;
const NUDGE_BAND = 0.5;
const NUDGE_SATURATION_MS = 0.4;
const DRIFT_HALF_HOURS = 12;

/**
 * Identifies the forecast logic. Saved with every report's prediction so results can be grouped by model.
 * Change it whenever a change alters what the forecast says for the same inputs.
 */
export const FORECAST_MODEL_VERSION = "tide-slope+drift-nudge/3";

/**
 * What feeds the strength nudge. The API current is a total current (ocean model, Stokes drift, and FES2014 tide),
 * so its hourly value is mostly tide at strongly tidal cells. "drift" uses the 25-hour mean, which removes the tide.
 * "off" disables the nudge.
 */
export const NUDGE_SOURCE: "drift" | "off" = "drift";

/**
 * Cross-section that counts as a typical pass: the median of the measured dive-site channels (about 32,000 m2).
 * It used to be Vaadhoo Kandu (5 km x 400 m), an inter-atoll channel, which made every real pass look narrow and
 * pinned each site with published dimensions at the maximum factor, so it was "too strong" nearly all the time.
 */
export const REF_CHANNEL_AREA_M2 = 31_500;
export const CONSTRICTION_EXPONENT = 0.35;
export const CONSTRICTION_MIN = 1.0;
export const CONSTRICTION_MAX = 2.5;

export const REPORT_HALF_LIFE_DAYS = 90;
export const REPORT_HALF_LIFE_MS = REPORT_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000;
export const LAG_PENALTY_LAMBDA = 0.05;
export const CONSENSUS_RATIO_THRESHOLD = 0.6;
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
/** Inside this distance any opposite report blocks high, whatever its tide phase: it may be the same water on a skewed clock. */
export const CONTRADICTION_NEAR_MS = 3 * HOUR_MS;

/** Exponential temporal decay weight: 2^(-delta_days / 90) */
export function reportTemporalWeight(reportTime: string, referenceTimeMs: number): number {
  const reportMs = parseWall(reportTime);
  if (!Number.isFinite(reportMs)) return 0;
  if (!Number.isFinite(referenceTimeMs)) return 1.0;
  const deltaMs = Math.max(0, referenceTimeMs - reportMs);
  return Math.pow(2, -deltaMs / REPORT_HALF_LIFE_MS);
}

export function constrictionFactor(channelWidthM?: number, channelDepthM?: number): number {
  if (
    channelWidthM == null ||
    channelDepthM == null ||
    !Number.isFinite(channelWidthM) ||
    !Number.isFinite(channelDepthM) ||
    channelWidthM <= 0 ||
    channelDepthM <= 0
  ) {
    return 1.0;
  }
  const area = channelWidthM * channelDepthM;
  if (area <= 0) return 1.0;
  const raw = Math.pow(REF_CHANNEL_AREA_M2 / area, CONSTRICTION_EXPONENT);
  return Math.min(CONSTRICTION_MAX, Math.max(CONSTRICTION_MIN, raw));
}

type TideStats = { range: number | null; maxAbs: number | null };

type ClassifiedBase = {
  report: Report;
  seriesIndex: number;
  storedHourSlope: number | null;
  pullSlope: number | null;
  failed: boolean;
  temporalWeight: number;
};

type ClassifiedReport =
  | (ClassifiedBase & { kind: "in-series"; index: number })
  | (ClassifiedBase & { kind: "single-slope"; slope: number })
  | (ClassifiedBase & { kind: "slope-window"; slopes: readonly (number | null)[] })
  | (ClassifiedBase & { kind: "unusable" });

export function forecastHours(input: ForecastInput): HourForecast[] {
  const hours = currentForNudge(input.hours);
  const constriction = constrictionFactor(input.channelWidthM, input.channelDepthM);
  const residual = residualSeries(hours);
  const classified = (input.reports ?? []).map((report) => classifyReport(report, hours));
  const offset = fitPhaseOffset(classified, hours, residual);
  applyPullSlopes(classified, hours, residual, offset);
  const tides = centeredTides(hours, residual);
  const speedFactor = fitSpeedFactor(
    classified,
    hours,
    residual,
    tides,
    offset,
    input.inwardBearingDeg,
    constriction,
  );
  const allowHighConfidence = input.allowHighConfidence ?? true;
  return finishRuns(
    hours,
    residual,
    input.inwardBearingDeg,
    offset,
    speedFactor,
    tides,
    classified,
    allowHighConfidence,
    constriction,
  );
}

/** One pass: in-series, one stored slope, a real slope window, or unusable. */
export function classifyReport(report: Report, hours: readonly MarineHour[]): ClassifiedReport {
  const slopes = storedWindow(report);
  const finite = slopes
    ? slopes.filter((slope): slope is number => typeof slope === "number" && Number.isFinite(slope))
    : [];
  const seriesIndex = nearestIndex(hours, parseWall(report.time));
  const storedHourSlope = hourSlope(slopes, report);
  // In-series pull is filled after the offset fit. Stored slope is only outside this series.
  const pullSlope = seriesIndex < 0 ? storedHourSlope : null;
  const failed = report.slopeM === null && finite.length === 0;
  const referenceTimeMs = hours.length > 0 ? parseWall(hours[0].time) : Number.NaN;
  const temporalWeight = reportTemporalWeight(report.time, referenceTimeMs);
  const base = { report, seriesIndex, storedHourSlope, pullSlope, failed, temporalWeight };
  if (slopes && finite.length > 1) return { ...base, kind: "slope-window", slopes };
  const centerSlope = slopes ? slopes[WINDOW_HALF_HOURS] : null;
  if (typeof centerSlope === "number" && Number.isFinite(centerSlope)) {
    return { ...base, kind: "single-slope", slope: centerSlope };
  }
  // A failed fetch stores no window and a null slope. It must not train, even inside this series.
  if (report.slopeM === null) return { ...base, kind: "unusable" };
  if (seriesIndex >= 0) return { ...base, kind: "in-series", index: seriesIndex };
  if (typeof report.slopeM === "number" && Number.isFinite(report.slopeM)) {
    return { ...base, kind: "single-slope", slope: report.slopeM };
  }
  return { ...base, kind: "unusable" };
}

function hourSlope(slopes: readonly (number | null)[] | null, report: Report): number | null {
  if (slopes && typeof slopes[WINDOW_HALF_HOURS] === "number") return slopes[WINDOW_HALF_HOURS];
  return typeof report.slopeM === "number" && Number.isFinite(report.slopeM) ? report.slopeM : null;
}

/** Lagged residual slope at an in-series report. Outside reports keep the stored slope. */
function applyPullSlopes(
  classified: readonly ClassifiedReport[],
  hours: readonly MarineHour[],
  residual: readonly (number | null)[],
  offset: number,
): void {
  for (const item of classified) {
    if (item.seriesIndex < 0) {
      item.pullSlope = item.storedHourSlope;
      continue;
    }
    const shifted = shiftIndex(hours, item.seriesIndex, offset);
    item.pullSlope = shifted < 0 ? null : slopeFromResidual(residual, shifted);
  }
}

/** Residual range and steepest slope over the 25 hours centered on each displayed hour. */
function centeredTides(hours: readonly MarineHour[], residual: readonly (number | null)[]): TideStats[] {
  return hours.map((_, index) => tideWindow(hours, residual, index));
}

export function tideWindow(
  hours: readonly MarineHour[],
  residual: readonly (number | null)[],
  index: number,
): TideStats {
  const center = parseWall(hours[index].time);
  if (Number.isNaN(center)) return { range: null, maxAbs: null };
  const levels: number[] = [];
  let maxAbs = -1;
  let slots = 0;
  for (let other = 0; other < hours.length; other += 1) {
    const at = parseWall(hours[other].time);
    if (Number.isNaN(at) || Math.abs(at - center) > MEAN_HALF_HOURS * HOUR_MS) continue;
    slots += 1;
    const level = residual[other];
    if (level != null) levels.push(level);
    const slope = slopeFromResidual(residual, other);
    if (slope != null) maxAbs = Math.max(maxAbs, Math.abs(slope));
  }
  // W12: a 25-hour window needs 12 finite residuals. A short series keeps the 2-sample floor.
  return {
    range: levels.length < (slots >= 12 ? 12 : 2) ? null : Math.max(...levels) - Math.min(...levels),
    maxAbs: maxAbs < 0 ? null : maxAbs,
  };
}

type OpenHour = {
  time: string;
  direction: Direction;
  strength: Strength;
  slope: number;
  nudge: number;
  index: number;
  levelM: number;
};

// Each hour keeps its own band, so a run eases in from slack, peaks, and eases out.
// Hours at or above the slack slope vote. Past half saturation, the whole run steps one band, never down to slack.
// A slack hour stays put.
function meanNudge(open: OpenHour[]) {
  let nudge = 0;
  let count = 0;
  for (const hour of open) {
    if (Math.abs(hour.slope) < SLACK_SLOPE_M) continue;
    nudge += hour.nudge;
    count += 1;
  }
  if (count === 0) return;
  nudge /= count;
  if (Math.abs(nudge) >= NUDGE_BAND) {
    const favored: Direction = nudge > 0 ? "incoming" : "outgoing";
    const withTide = open[0].direction === favored;
    for (const hour of open) {
      if (hour.strength === "slack") continue;
      // Drift against the tide slows a flowing hour. It does not stop it, so the floor is mild.
      hour.strength = withTide ? shiftStrength(hour.strength, 1) : STRENGTHS[Math.max(1, bandIndex(hour.strength) - 1)];
    }
  }
}

/** One walk over the series. Each hour gets its own band, each closed run is nudged, then reports pull. */
function finishRuns(
  hours: readonly MarineHour[],
  residual: readonly (number | null)[],
  inwardBearingDeg: number,
  offset: number,
  speedFactor: number,
  tides: readonly TideStats[],
  classified: readonly ClassifiedReport[],
  allowHighConfidence: boolean,
  constriction: number = 1.0,
): HourForecast[] {
  // A report fades for six hours and must not cut the run.
  // It moves later hours by how far it differed from the model at its own hour, so a report that agrees changes nothing.
  const settled = settledHours(hours, residual, inwardBearingDeg, offset, speedFactor, tides, constriction);
  const modelBands = new Map(settled.map((open) => [open.index, open.strength]));
  const reportPull = (hour: OpenHour): HourForecast => {
    const pull = aggregateReportPull(hour, hours, classified, modelBands);
    return {
      time: hour.time,
      direction: pull.direction,
      strength: pull.strength,
      confidence: confidenceFor({
        classified,
        hours,
        residual,
        offset,
        direction: pull.direction,
        strength: pull.strength,
        tideDirection: hour.direction,
        contradicted: pull.contradicted,
        allowHighConfidence,
        hourTime: hour.time,
      }),
      levelM: hour.levelM,
    };
  };

  return settled.map(reportPull);
}

/** Open hours after their own band and the mean nudge, before the report pull. */
function settledHours(
  hours: readonly MarineHour[],
  residual: readonly (number | null)[],
  inwardBearingDeg: number,
  offset: number,
  speedFactor: number,
  tides: readonly TideStats[],
  constriction: number = 1.0,
): OpenHour[] {
  const settled: OpenHour[] = [];
  let run: OpenHour[] = [];
  const closeRun = () => {
    if (run.length === 0) return;
    meanNudge(run);
    for (const hour of run) settled.push(hour);
    run = [];
  };

  for (let index = 0; index < hours.length; index += 1) {
    const hour = hours[index];
    // Displayed residual stays on this clock hour. Direction and strength use the lagged slope.
    const levelM = residual[index];
    if (levelM == null) continue;
    const shifted = shiftIndex(hours, index, offset);
    if (shifted < 0) continue;
    const slope = slopeFromResidual(residual, shifted);
    if (slope == null || !Number.isFinite(slope)) continue;
    const tideDirection = directionFromSlope(slope);
    // C8: exact-zero slope is slack. Direction is the next signed lagged slope, never the previous hour or the ocean current.
    let effectiveDirection = tideDirection;
    if (effectiveDirection == null) {
      effectiveDirection = nextSignedDirection(hours, residual, offset, index);
      if (effectiveDirection == null) continue;
    }
    const stats = tides[index];
    if (stats.range == null || stats.maxAbs == null) continue;
    const tideStrength = hourlyStrength(
      Math.abs(slope),
      stats.maxAbs,
      strengthFromRange(stats.range, constriction),
      constriction,
    );
    const opened: OpenHour = {
      time: hour.time,
      direction: effectiveDirection,
      strength: applySpeed(tideStrength, speedFactor),
      slope,
      nudge: monsoonNudge(hour, inwardBearingDeg),
      index,
      levelM,
    };
    if (run.length > 0 && !sameRun(run[run.length - 1], opened)) closeRun();
    run.push(opened);
  }
  closeRun();
  return settled;
}

function sameRun(left: { direction: Direction; time: string }, right: { direction: Direction; time: string }): boolean {
  return left.direction === right.direction && Math.abs(parseWall(right.time) - parseWall(left.time)) <= 2 * HOUR_MS;
}

/** Naive clock strings are Maldives wall time. Offset strings are converted to that wall clock. */
export function toMaldivesWall(value: string): string {
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(value)) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error("Bad time");
    return new Date(date.getTime() + 5 * HOUR_MS).toISOString().slice(0, 16);
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value);
  if (!match) throw new Error("Bad time");
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`;
}

/** Residual sea-level change over the hour nearest `time`, or null when that hour is missing. */
export function seaLevelSlopeAt(hours: readonly MarineHour[], time: string): number | null {
  const index = nearestIndex(hours, parseWall(time));
  if (index < 0) return null;
  return slopeFromResidual(residualSeries(hours), index);
}

/**
 * Residual slopes from 6 hours before `time` through 6 hours after.
 * Index 6 is the report hour. Null is a missing hour.
 */
export function residualSlopeWindow(hours: readonly MarineHour[], time: string): (number | null)[] | null {
  const reportMs = parseWall(time);
  if (Number.isNaN(reportMs) || hours.length === 0) return null;
  const residual = residualSeries(hours);
  const window: (number | null)[] = [];
  for (let lag = -WINDOW_HALF_HOURS; lag <= WINDOW_HALF_HOURS; lag += 1) {
    const index = nearestIndex(hours, reportMs + lag * HOUR_MS, HOUR_MATCH_MS);
    window.push(index < 0 ? null : slopeFromResidual(residual, index));
  }
  return window;
}

/** Residual range over the 25 hours around `time`, or null when that hour is missing or has no full window. */
export function residualRangeAt(hours: readonly MarineHour[], time: string): number | null {
  const index = nearestIndex(hours, parseWall(time), HOUR_MATCH_MS);
  if (index < 0) return null;
  return tideWindow(hours, residualSeries(hours), index).range;
}

function fitPhaseOffset(
  classified: readonly ClassifiedReport[],
  hours: readonly MarineHour[],
  residual: readonly (number | null)[],
): number {
  // A slack report still names a direction (the form requires one), but it saw no flow, so it has no phase to vote.
  const voters = classified.filter((item) => item.kind !== "unusable" && !isSlackReport(item));
  if (voters.length < 2) return 0;

  let bestK = 0;
  let bestRegularizedScore = Number.NEGATIVE_INFINITY;
  const rawScores = new Map<number, number>();
  const matchCounts = new Map<number, number>();

  for (let k = -WINDOW_HALF_HOURS; k <= WINDOW_HALF_HOURS; k += 1) {
    let weightedScore = 0;
    let count = 0;
    for (const voter of voters) {
      if (phaseScore(voter, hours, residual, k) > 0) {
        weightedScore += voter.temporalWeight;
        count += 1;
      }
    }
    rawScores.set(k, weightedScore);
    matchCounts.set(k, count);

    const regularized = weightedScore - LAG_PENALTY_LAMBDA * Math.abs(k);
    if (
      regularized > bestRegularizedScore ||
      (regularized === bestRegularizedScore && Math.abs(k) < Math.abs(bestK)) ||
      (regularized === bestRegularizedScore && Math.abs(k) === Math.abs(bestK) && k > bestK)
    ) {
      bestRegularizedScore = regularized;
      bestK = k;
    }
  }

  const zeroRaw = rawScores.get(0) ?? 0;
  const zeroRegularized = zeroRaw - LAG_PENALTY_LAMBDA * 0;
  const bestCount = matchCounts.get(bestK) ?? 0;
  const bestRaw = rawScores.get(bestK) ?? 0;

  if (bestK !== 0 && bestCount >= 2 && bestRaw >= 0.5 && bestRegularizedScore > zeroRegularized) {
    return bestK;
  }
  return 0;
}

function phaseScore(
  item: ClassifiedReport,
  hours: readonly MarineHour[],
  residual: readonly (number | null)[],
  lag: number,
): number {
  // A missing in-series lag does not vote and does not use the unshifted hour.
  if (item.kind === "in-series" && lag !== 0 && shiftIndex(hours, item.index, lag) < 0) return 0;
  const tide = tideDirectionAtLag(item, hours, residual, lag);
  return tide != null && tide === item.report.direction ? 1 : 0;
}

function fitSpeedFactor(
  classified: readonly ClassifiedReport[],
  hours: readonly MarineHour[],
  residual: readonly (number | null)[],
  tides: readonly TideStats[],
  offset: number,
  inwardBearingDeg: number,
  constriction: number = 1.0,
): number {
  let weightedRatioSum = 0;
  let totalWeight = 0;
  let count = 0;

  for (const item of classified) {
    const prior = speedPrior(item, hours, residual, tides, offset, inwardBearingDeg, constriction);
    if (!prior) continue;
    const reportPhase = tideDirectionAtLag(item, hours, residual, offset);
    if (!isSlackReport(item) && reportPhase != null && reportPhase !== item.report.direction) continue;
    const ratio = (bandIndex(item.report.strength) + 0.5) / (bandIndex(prior) + 0.5);
    const w = item.temporalWeight;
    weightedRatioSum += ratio * w;
    totalWeight += w;
    count += 1;
  }

  if (count < 2 || totalWeight <= 0) return 1;
  const weightedMean = weightedRatioSum / totalWeight;
  return Math.min(2, Math.max(0.5, weightedMean));
}

function confidenceFor(input: {
  classified: readonly ClassifiedReport[];
  hours: readonly MarineHour[];
  residual: readonly (number | null)[];
  offset: number;
  direction: Direction;
  strength: Strength;
  tideDirection: Direction | null;
  contradicted: boolean;
  allowHighConfidence: boolean;
  hourTime?: string;
}): "low" | "medium" | "high" {
  if (input.classified.length === 0 || input.contradicted || input.tideDirection == null) return "low";

  const targetHourMs = input.hourTime ? parseWall(input.hourTime) : Number.NaN;

  const samePhase = (item: ClassifiedReport) => {
    const reportPhase = tideDirectionAtLag(item, input.hours, input.residual, input.offset);
    return reportPhase != null && reportPhase === input.tideDirection;
  };

  // Hard safety invariant: an opposite report within 7 days on the same tide blocks high confidence.
  // Within 3 hours any opposite report blocks it, whatever its phase, since it may be the same water on a skewed clock.
  // A report on the other tide is expected to be opposite and does not count. Nor does slack, which saw no flow.
  const hasRecentContradiction =
    Number.isFinite(targetHourMs) &&
    input.classified.some((item) => {
      if (item.kind === "unusable" || isSlackReport(item)) return false;
      if (item.report.direction === input.direction) return false;
      const repMs = parseWall(item.report.time);
      if (!Number.isFinite(repMs)) return false;
      const apart = Math.abs(targetHourMs - repMs);
      return apart <= CONTRADICTION_NEAR_MS || (apart <= SEVEN_DAYS_MS && samePhase(item));
    });

  const similar = input.classified.filter(samePhase);
  if (similar.length < 2) return "low";

  const weightOf = (items: readonly ClassifiedReport[]) => items.reduce((sum, item) => sum + item.temporalWeight, 0);
  // Slack reports count toward strength agreement but not direction.
  const directional = similar.filter((item) => !isSlackReport(item));
  const totalWeight = weightOf(similar);
  const directionalWeight = weightOf(directional);
  const dirAgreeWeight = weightOf(directional.filter((item) => item.report.direction === input.direction));
  const strAgreeWeight = weightOf(similar.filter((item) => item.report.strength === input.strength));

  const directionAgree = directionalWeight > 0 ? dirAgreeWeight / directionalWeight : 0;
  const strengthAgree = totalWeight > 0 ? strAgreeWeight / totalWeight : 0;
  const directionUnanimous =
    directional.length > 0 && directional.every((item) => item.report.direction === input.direction);

  if (
    directionUnanimous &&
    strengthAgree >= 0.6 &&
    similar.length >= 4 &&
    !hasRecentContradiction
  ) {
    return input.allowHighConfidence ? "high" : "medium";
  }
  if (directionAgree >= 0.8) return "medium";
  return "low";
}

type AggregatedPull = {
  direction: Direction;
  strength: Strength;
  contradicted: boolean;
};

export function aggregateReportPull(
  hour: OpenHour,
  hours: readonly MarineHour[],
  classified: readonly ClassifiedReport[],
  modelBands?: ReadonlyMap<number, Strength>,
): AggregatedPull {
  const hourMs = parseWall(hour.time);
  if (!Number.isFinite(hourMs)) {
    return { direction: hour.direction, strength: hour.strength, contradicted: false };
  }

  let incomingWeight = 0;
  let outgoingWeight = 0;
  let slackWeight = 0;
  const activeReports: { item: ClassifiedReport; weight: number }[] = [];

  for (const item of classified) {
    if (item.kind === "unusable") continue;
    const reportMs = parseWall(item.report.time);
    if (Number.isNaN(reportMs)) continue;
    const sinceHours = (hourMs - reportMs) / HOUR_MS;
    if (!Number.isFinite(sinceHours) || sinceHours < 0 || sinceHours >= FADE_HOURS) continue;

    const fadeWeight = 1 - sinceHours / FADE_HOURS;
    const decayWeight = item.temporalWeight;
    const weight = fadeWeight * decayWeight;
    if (weight <= 0) continue;

    const turned = slopesOpposite(item.pullSlope, hour.slope);
    if (turned) {
      continue;
    }

    // A slack report pulls strength but casts no direction vote: the form makes the diver pick one anyway.
    if (isSlackReport(item)) {
      slackWeight += weight;
    } else if (item.report.direction === "incoming") {
      incomingWeight += weight;
    } else if (item.report.direction === "outgoing") {
      outgoingWeight += weight;
    }
    activeReports.push({ item, weight });
  }

  const directionalWeight = incomingWeight + outgoingWeight;
  if (directionalWeight + slackWeight === 0) {
    return { direction: hour.direction, strength: hour.strength, contradicted: false };
  }

  const hasConflict = incomingWeight > 0 && outgoingWeight > 0;
  let direction: Direction | null = null;
  if (directionalWeight === 0) {
    direction = hour.direction;
  } else if (incomingWeight > outgoingWeight && incomingWeight / directionalWeight >= CONSENSUS_RATIO_THRESHOLD) {
    direction = "incoming";
  } else if (outgoingWeight > incomingWeight && outgoingWeight / directionalWeight >= CONSENSUS_RATIO_THRESHOLD) {
    direction = "outgoing";
  }
  if (direction == null) {
    return { direction: hour.direction, strength: hour.strength, contradicted: hasConflict };
  }

  const chosen = direction;
  const concordant = activeReports.filter((r) => isSlackReport(r.item) || r.item.report.direction === chosen);
  const concordantWeight = concordant.reduce((sum, r) => sum + r.weight, 0);
  const gap = averageGap(concordant, concordantWeight, hour, modelBands);
  const strength = shiftStrength(hour.strength, Math.round(Math.min(1, concordantWeight) * gap));
  const contradicted = hasConflict || direction !== hour.direction;
  return { direction, strength, contradicted };
}

/**
 * Weighted average number of bands by which the reports differ from the model at their own hour.
 * With no model band there (a report outside the series), it falls back to the gap from the hour being pulled.
 */
function averageGap(
  reports: readonly { item: ClassifiedReport; weight: number }[],
  totalWeight: number,
  hour: OpenHour,
  modelBands?: ReadonlyMap<number, Strength>,
): number {
  const sum = reports.reduce((acc, r) => {
    const prior = modelBands?.get(r.item.seriesIndex);
    const base = prior != null ? bandIndex(prior) : bandIndex(hour.strength);
    return acc + r.weight * (bandIndex(r.item.report.strength) - base);
  }, 0);
  return sum / totalWeight;
}

/** Tide direction at a lag. An in-series miss is outside the series, not the unshifted hour. */
function tideDirectionAtLag(
  item: ClassifiedReport,
  hours: readonly MarineHour[],
  residual: readonly (number | null)[],
  lag: number,
): Direction | null {
  if (item.kind === "unusable") return null;
  if (item.kind === "single-slope") {
    // One stored slope can support lag 0 or a 6-hour flip, not a measured intermediate lag.
    const sign = directionFromSlope(item.slope);
    if (!sign) return null;
    if (lag === 0) return sign;
    if (lag === WINDOW_HALF_HOURS || lag === -WINDOW_HALF_HOURS) return opposite(sign);
    return null;
  }
  if (item.kind === "slope-window") {
    const slope = item.slopes[WINDOW_HALF_HOURS + lag];
    if (typeof slope !== "number" || !Number.isFinite(slope)) return null;
    return directionFromSlope(slope);
  }
  const index = shiftIndex(hours, item.index, lag);
  if (index < 0) return null;
  const slope = slopeFromResidual(residual, index);
  return slope == null ? null : directionFromSlope(slope);
}

function speedPrior(
  item: ClassifiedReport,
  hours: readonly MarineHour[],
  residual: readonly (number | null)[],
  tides: readonly TideStats[],
  offset: number,
  inwardBearingDeg: number,
  constriction: number = 1.0,
): Strength | null {
  if (item.failed) return null;
  if (item.seriesIndex >= 0) {
    // A fitted lag is the lagged slope's own band. Peak band would treat a matching report as a miss.
    if (offset !== 0) return laggedSlopeBand(item, hours, residual, tides, offset, constriction);
    return shownStrength(hours, residual, inwardBearingDeg, offset, tides, item.seriesIndex, constriction);
  }
  return storedPrior(item, offset, constriction);
}

/**
 * Band the model would have given a report outside this series, from what was saved with it.
 * A report with its day's range and a slope window is graded like an in-series hour, at the fitted lag.
 * An older report has no range, so all it can say is slack or flowing, and flowing counts as mild.
 */
function storedPrior(item: ClassifiedReport, offset: number, constriction: number): Strength | null {
  if (item.storedHourSlope == null) return null;
  const range = item.report.rangeM;
  if (item.kind !== "slope-window" || typeof range !== "number" || !Number.isFinite(range)) {
    return Math.abs(item.storedHourSlope) < SLACK_SLOPE_M ? "slack" : "mild";
  }
  const slope = item.slopes[WINDOW_HALF_HOURS + offset];
  if (typeof slope !== "number") return null;
  // Thirteen hours span more than a half cycle, so the window holds this run's steepest hour.
  const maxAbs = Math.max(...item.slopes.map((value) => (typeof value === "number" ? Math.abs(value) : 0)));
  return hourlyStrength(Math.abs(slope), maxAbs, strengthFromRange(range, constriction), constriction);
}

function laggedSlopeBand(
  item: ClassifiedReport,
  hours: readonly MarineHour[],
  residual: readonly (number | null)[],
  tides: readonly TideStats[],
  offset: number,
  constriction: number = 1.0,
): Strength | null {
  const index = shiftIndex(hours, item.seriesIndex, offset);
  if (index < 0) return null;
  const slope = slopeFromResidual(residual, index);
  if (slope == null) return null;
  const stats = tides[item.seriesIndex];
  if (stats.range == null || stats.maxAbs == null) return null;
  return hourlyStrength(
    Math.abs(slope),
    stats.maxAbs,
    strengthFromRange(stats.range, constriction),
    constriction,
  );
}

/** Clock-hour strength after peak band and mean nudge, before the report pull. Factor 1, so the fit is not circular. */
function shownStrength(
  hours: readonly MarineHour[],
  residual: readonly (number | null)[],
  inwardBearingDeg: number,
  offset: number,
  tides: readonly TideStats[],
  index: number,
  constriction: number = 1.0,
): Strength | null {
  for (const hour of settledHours(hours, residual, inwardBearingDeg, offset, 1, tides, constriction)) {
    if (hour.index === index) return hour.strength;
  }
  return null;
}

function storedWindow(report: Report): (number | null)[] | null {
  if (!Array.isArray(report.slopeWindowM)) return null;
  return Array.from({ length: WINDOW_HOURS }, (_, index) => {
    const value = report.slopeWindowM?.[index];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  });
}

function slopesOpposite(left: number | null, right: number | null): boolean {
  if (left == null || right == null) return false;
  const a = directionFromSlope(left);
  const b = directionFromSlope(right);
  return a != null && b != null && a !== b;
}

function isSlackReport(item: ClassifiedReport): boolean {
  return item.report.strength === "slack";
}

function opposite(direction: Direction): Direction {
  return direction === "incoming" ? "outgoing" : "incoming";
}

/**
 * Hours with the current replaced by what the nudge should see. Times and sea level are untouched.
 * The drift is the vector mean over the 25 hours around each hour, with the window slid inward at the ends of the
 * series so it stays a full tidal cycle. A short series (under 24 hours) cannot remove the tide and averages what it has.
 * An hour with too few current samples keeps a null current, which falls back to the seasonal curve.
 */
function currentForNudge(hours: readonly MarineHour[]): MarineHour[] {
  if (NUDGE_SOURCE === "off") return hours.map((hour) => ({ ...hour, currentVelocityMs: 0 }));
  const times = hours.map((hour) => parseWall(hour.time));
  const finiteTimes = times.filter((time) => !Number.isNaN(time));
  if (finiteTimes.length === 0) return [...hours];
  const first = Math.min(...finiteTimes);
  const last = Math.max(...finiteTimes);
  const full = last - first >= 2 * DRIFT_HALF_HOURS * HOUR_MS;
  const east = hours.map((hour) => currentComponent(hour, Math.sin));
  const north = hours.map((hour) => currentComponent(hour, Math.cos));
  return hours.map((hour, index) => {
    if (Number.isNaN(times[index])) return hour;
    const center = full
      ? Math.min(last - DRIFT_HALF_HOURS * HOUR_MS, Math.max(first + DRIFT_HALF_HOURS * HOUR_MS, times[index]))
      : times[index];
    let sumEast = 0;
    let sumNorth = 0;
    let count = 0;
    for (let other = 0; other < hours.length; other += 1) {
      if (Number.isNaN(times[other]) || Math.abs(times[other] - center) > DRIFT_HALF_HOURS * HOUR_MS) continue;
      if (Number.isNaN(east[other])) continue;
      sumEast += east[other];
      sumNorth += north[other];
      count += 1;
    }
    if (count === 0 || (full && count < MIN_MEAN_SAMPLES)) {
      return { ...hour, currentVelocityMs: null, currentDirectionDeg: null };
    }
    const meanEast = sumEast / count;
    const meanNorth = sumNorth / count;
    return {
      ...hour,
      currentVelocityMs: Math.hypot(meanEast, meanNorth),
      currentDirectionDeg: ((Math.atan2(meanEast, meanNorth) * 180) / Math.PI + 360) % 360,
    };
  });
}

/** East or north component of the hour's current, or NaN when it has no usable current. An exact-zero speed is calm at any heading. */
function currentComponent(hour: MarineHour, trig: (radians: number) => number): number {
  const speed = hour.currentVelocityMs;
  const heading = hour.currentDirectionDeg;
  if (speed === 0) return 0;
  if (speed == null || heading == null || !Number.isFinite(speed) || !Number.isFinite(heading)) return Number.NaN;
  return speed * trig((heading * Math.PI) / 180);
}

export function resolveHourDrift(hour: MarineHour): OceanDrift {
  if (
    hour.currentVelocityMs != null &&
    hour.currentDirectionDeg != null &&
    Number.isFinite(hour.currentVelocityMs) &&
    Number.isFinite(hour.currentDirectionDeg)
  ) {
    return {
      velocityMs: hour.currentVelocityMs,
      directionDeg: hour.currentDirectionDeg,
    };
  }
  const timeMs = parseWall(hour.time);
  const date = Number.isFinite(timeMs) ? new Date(timeMs) : new Date(hour.time);
  return getMaldivesMonsoonDrift(date);
}

export function monsoonInwardFlux(drift: OceanDrift, inwardBearingDeg: number): number {
  const radians = ((drift.directionDeg - inwardBearingDeg) * Math.PI) / 180;
  return drift.velocityMs * Math.cos(radians);
}

function monsoonNudge(hour: MarineHour, inwardBearingDeg: number): number {
  if (hour.currentVelocityMs === 0) return 0;
  const drift = resolveHourDrift(hour);
  const inward = monsoonInwardFlux(drift, inwardBearingDeg);
  return Math.max(-1, Math.min(1, inward / NUDGE_SATURATION_MS));
}

function residualSeries(hours: readonly MarineHour[]): (number | null)[] {
  const times = hours.map((hour) => parseWall(hour.time));
  // A series spanning 24 hours drops an hour unless both sides reach 12 hours and 18 samples exist.
  const strict = reachesMeanSpan(times);
  return hours.map((hour, index) => {
    const level = hour.seaLevelM;
    if (level == null || !Number.isFinite(level) || Number.isNaN(times[index])) return null;
    let sum = 0;
    let count = 0;
    let spansBefore = false;
    let spansAfter = false;
    for (let other = 0; other < hours.length; other += 1) {
      if (Number.isNaN(times[other])) continue;
      const delta = times[other] - times[index];
      const sample = hours[other].seaLevelM;
      const finite = sample != null && Number.isFinite(sample);
      if (finite && delta <= -MEAN_HALF_HOURS * HOUR_MS) spansBefore = true;
      if (finite && delta >= MEAN_HALF_HOURS * HOUR_MS) spansAfter = true;
      if (Math.abs(delta) > MEAN_HALF_HOURS * HOUR_MS) continue;
      if (sample == null || !Number.isFinite(sample)) continue;
      sum += sample;
      count += 1;
    }
    if (strict) {
      if (!spansBefore || !spansAfter || count < MIN_MEAN_SAMPLES) return null;
    } else if ((spansBefore && spansAfter && count < MIN_MEAN_SAMPLES) || count === 0) {
      return null;
    }
    return level - sum / count;
  });
}

function reachesMeanSpan(times: readonly number[]): boolean {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const time of times) {
    if (Number.isNaN(time)) continue;
    if (time < min) min = time;
    if (time > max) max = time;
  }
  return max - min >= 2 * MEAN_HALF_HOURS * HOUR_MS;
}

function slopeFromResidual(residual: readonly (number | null)[], index: number): number | null {
  const level = residual[index];
  if (level == null) return null;
  if (index + 1 < residual.length && residual[index + 1] != null) {
    return (residual[index + 1] as number) - level;
  }
  if (index - 1 >= 0 && residual[index - 1] != null) return level - (residual[index - 1] as number);
  return null;
}

/** Positive lag reads a later residual. Outside the series returns -1, not this hour. */
function shiftIndex(hours: readonly MarineHour[], index: number, offsetHours: number): number {
  if (offsetHours === 0) return index;
  return nearestIndex(hours, parseWall(hours[index].time) + offsetHours * HOUR_MS);
}

function nearestIndex(hours: readonly MarineHour[], ms: number, maxDelta = 90 * 60 * 1000): number {
  if (Number.isNaN(ms)) return -1;
  let best = -1;
  let bestAbs = Number.POSITIVE_INFINITY;
  for (let index = 0; index < hours.length; index += 1) {
    const delta = Math.abs(parseWall(hours[index].time) - ms);
    if (delta < bestAbs) {
      best = index;
      bestAbs = delta;
    }
  }
  return bestAbs <= maxDelta ? best : -1;
}

function directionFromSlope(slope: number): Direction | null {
  if (!Number.isFinite(slope) || slope === 0) return null;
  return slope > 0 ? "incoming" : "outgoing";
}

/** Later clock hours only. Same lag and residual slope as this hour. Never the previous hour or the ocean current. */
function nextSignedDirection(
  hours: readonly MarineHour[],
  residual: readonly (number | null)[],
  offset: number,
  index: number,
): Direction | null {
  for (let later = index + 1; later < hours.length; later += 1) {
    const shifted = shiftIndex(hours, later, offset);
    if (shifted < 0) continue;
    const slope = slopeFromResidual(residual, shifted);
    if (slope == null) continue;
    const direction = directionFromSlope(slope);
    if (direction != null) return direction;
  }
  return null;
}

export function strengthFromRange(range: number, constriction: number = 1.0): Strength {
  const effectiveRange = range * constriction;
  if (effectiveRange < 0.35) return "slack";
  if (range < 0.35) return "mild";
  if (effectiveRange < 0.6) return "mild";
  if (effectiveRange < 0.85) return "strong";
  return "too_strong";
}

/** Slack inside 5 mm, and below 0.02 m. The steepest hour takes the envelope. */
export function hourlyStrength(
  absSlope: number,
  maxAbsSlope: number,
  envelope: Strength,
  constriction: number = 1.0,
): Strength {
  const top = bandIndex(envelope);
  if (absSlope <= TIE_M || absSlope < SLACK_SLOPE_M || top <= 0) return "slack";
  const effSlope = absSlope * constriction;
  const effMaxSlope = maxAbsSlope * constriction;
  const span = effMaxSlope - SLACK_SLOPE_M;
  if (!(span > 0)) return envelope;
  const t = Math.min(1, Math.max(0, (effSlope - SLACK_SLOPE_M) / span));
  const index = Math.min(top, Math.max(1, Math.ceil(t * top - 1e-9)));
  return STRENGTHS[index];
}

export function applySpeed(strength: Strength, factor: number): Strength {
  if (strength === "slack") return "slack";
  const next = Math.round((bandIndex(strength) + 0.5) * factor - 0.5);
  return STRENGTHS[Math.max(0, Math.min(STRENGTHS.length - 1, next))];
}

function shiftStrength(strength: Strength, steps: number): Strength {
  return STRENGTHS[Math.max(0, Math.min(STRENGTHS.length - 1, bandIndex(strength) + steps))];
}

function bandIndex(strength: Strength): number {
  return STRENGTHS.indexOf(strength);
}

export function parseWall(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value);
  if (!match) return Number.NaN;
  return Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]);
}

