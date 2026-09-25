import { STRENGTHS, type Direction, type HourForecast, type MarineHour, type Report, type Strength } from "./types";

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

export type ForecastInput = {
  hours: MarineHour[];
  inwardBearingDeg: number;
  reports?: readonly Report[];
  allowHighConfidence?: boolean;
};

type DayTide = { range: number | null; maxAbs: number | null };

type ClassifiedBase = {
  report: Report;
  seriesIndex: number;
  storedHourSlope: number | null;
  pullSlope: number | null;
  failed: boolean;
};

type ClassifiedReport =
  | (ClassifiedBase & { kind: "in-series"; index: number })
  | (ClassifiedBase & { kind: "single-slope"; slope: number })
  | (ClassifiedBase & { kind: "slope-window"; slopes: readonly (number | null)[] })
  | (ClassifiedBase & { kind: "unusable" });

export function forecastHours(input: ForecastInput): HourForecast[] {
  const hours = input.hours;
  const residual = residualSeries(hours);
  const classified = (input.reports ?? []).map((report) => classifyReport(report, hours, residual));
  const days = dayTides(hours, residual);
  const offset = fitPhaseOffset(classified, hours, residual);
  const speedFactor = fitSpeedFactor(classified, hours, residual, days, offset);
  const allowHighConfidence = input.allowHighConfidence ?? true;
  return finishRuns(
    hours,
    residual,
    input.inwardBearingDeg,
    offset,
    speedFactor,
    days,
    classified,
    allowHighConfidence,
  );
}

/** One pass: in-series, one stored slope, a real slope window, or unusable. */
function classifyReport(
  report: Report,
  hours: readonly MarineHour[],
  residual: readonly (number | null)[],
): ClassifiedReport {
  const slopes = storedWindow(report);
  const finite = slopes
    ? slopes.filter((slope): slope is number => typeof slope === "number" && Number.isFinite(slope))
    : [];
  const seriesIndex = nearestIndex(hours, parseWall(report.time));
  const storedHourSlope = hourSlope(slopes, report);
  const seriesSlope = seriesIndex >= 0 ? slopeFromResidual(residual, seriesIndex) : null;
  const pullSlope = seriesSlope != null ? seriesSlope : storedHourSlope;
  const failed = report.slopeM === null && finite.length === 0;
  const base = { report, seriesIndex, storedHourSlope, pullSlope, failed };
  if (slopes && finite.length > 1) return { ...base, kind: "slope-window", slopes };
  if (slopes && finite.length === 1) return { ...base, kind: "single-slope", slope: finite[0] };
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

/** Each calendar day keeps one range and one steepest residual slope. */
function dayTides(hours: readonly MarineHour[], residual: readonly (number | null)[]): Map<string, DayTide> {
  const buckets = new Map<string, { levels: number[]; maxAbs: number }>();
  for (let index = 0; index < hours.length; index += 1) {
    const level = residual[index];
    const slope = slopeFromResidual(residual, index);
    if (level == null && slope == null) continue;
    const day = hours[index].time.slice(0, 10);
    let bucket = buckets.get(day);
    if (!bucket) {
      bucket = { levels: [] as number[], maxAbs: -1 };
      buckets.set(day, bucket);
    }
    if (level != null) bucket.levels.push(level);
    if (slope != null) bucket.maxAbs = Math.max(bucket.maxAbs, Math.abs(slope));
  }
  const table = new Map<string, DayTide>();
  for (const [day, bucket] of buckets) {
    table.set(day, {
      range: bucket.levels.length < 2 ? null : Math.max(...bucket.levels) - Math.min(...bucket.levels),
      maxAbs: bucket.maxAbs < 0 ? null : bucket.maxAbs,
    });
  }
  return table;
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

// One incoming or outgoing run keeps the peak band. Only the turn is slack.
function peakBand(open: OpenHour[]) {
  const slackTurn = (slope: number) => Math.abs(slope) < SLACK_SLOPE_M;
  let peak = 0;
  for (const hour of open) {
    if (slackTurn(hour.slope)) continue;
    peak = Math.max(peak, bandIndex(hour.strength));
  }
  if (peak > 0) {
    const band = STRENGTHS[peak];
    for (const hour of open) {
      hour.strength = slackTurn(hour.slope) ? "slack" : band;
    }
  }
}

// Monsoon past half saturation steps the run one band toward that flow. Slack stays slack.
function meanNudge(open: OpenHour[]) {
  let nudge = 0;
  for (const hour of open) nudge += hour.nudge;
  nudge /= open.length;
  if (Math.abs(nudge) >= NUDGE_BAND) {
    const favored: Direction = nudge > 0 ? "incoming" : "outgoing";
    const withTide = open[0].direction === favored;
    for (const hour of open) {
      if (hour.strength === "slack") continue;
      hour.strength = shiftStrength(hour.strength, withTide ? 1 : -1);
    }
  }
}

/** One walk over the series. Each closed run is peak band, then mean nudge, then report pull. */
function finishRuns(
  hours: readonly MarineHour[],
  residual: readonly (number | null)[],
  inwardBearingDeg: number,
  offset: number,
  speedFactor: number,
  days: ReadonlyMap<string, DayTide>,
  classified: readonly ClassifiedReport[],
  allowHighConfidence: boolean,
): HourForecast[] {
  const finished: HourForecast[] = [];
  let run: OpenHour[] = [];

  // A report fades for six hours and must not cut the run.
  const reportPull = (hour: OpenHour): HourForecast => {
    const pull = recentPull(hours[hour.index], classified);
    // hour.slope is the lagged slope. The unshifted slope can still share the report's sign.
    const turned = Boolean(pull && slopesOpposite(pull.item.pullSlope, hour.slope));
    const contradicted = Boolean(pull && pull.item.report.direction !== hour.direction);
    let direction = hour.direction;
    let strength = hour.strength;
    if (pull) {
      if (!turned) direction = pull.item.report.direction;
      const gap = bandIndex(pull.item.report.strength) - bandIndex(strength);
      strength = shiftStrength(strength, Math.round(pull.weight * gap));
    }
    return {
      time: hour.time,
      direction,
      strength,
      confidence: confidenceFor({
        classified,
        hours,
        residual,
        offset,
        direction,
        strength,
        tideDirection: hour.direction,
        contradicted,
        allowHighConfidence,
      }),
      levelM: hour.levelM,
    };
  };

  const closeRun = () => {
    if (run.length === 0) return;
    peakBand(run);
    meanNudge(run);
    for (const hour of run) finished.push(reportPull(hour));
    run = [];
  };

  for (let index = 0; index < hours.length; index += 1) {
    const hour = hours[index];
    // Displayed residual stays on this clock hour. Direction and strength use the lagged slope.
    const levelM = residual[index];
    if (levelM == null) continue;
    const shifted = shiftIndex(hours, index, offset);
    const slope = slopeFromResidual(residual, shifted);
    if (slope == null) continue;
    const tideDirection = directionFromSlope(slope);
    // A zero residual has no sign. Do not copy the previous hour or the ocean current.
    if (tideDirection == null) continue;
    const stats = days.get(hours[shifted].time.slice(0, 10));
    if (!stats || stats.range == null || stats.maxAbs == null) continue;
    const tideStrength = hourlyStrength(Math.abs(slope), stats.maxAbs, strengthFromRange(stats.range));
    const opened: OpenHour = {
      time: hour.time,
      direction: tideDirection,
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
  return finished;
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
  if (!/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.test(value)) {
    throw new Error("Bad time");
  }
  return value.slice(0, 16);
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

function fitPhaseOffset(
  classified: readonly ClassifiedReport[],
  hours: readonly MarineHour[],
  residual: readonly (number | null)[],
): number {
  const voters = classified.filter((item) => item.kind !== "unusable");
  if (voters.length < 2) return 0;

  let bestK = 0;
  let bestScore = -1;
  const scores = new Map<number, number>();
  for (let k = -WINDOW_HALF_HOURS; k <= WINDOW_HALF_HOURS; k += 1) {
    let score = 0;
    for (const voter of voters) score += phaseScore(voter, hours, residual, k);
    scores.set(k, score);
    if (score > bestScore || (score === bestScore && Math.abs(k) < Math.abs(bestK))) {
      bestScore = score;
      bestK = k;
    }
  }
  if (bestK !== 0 && bestScore >= 2 && bestScore > (scores.get(0) ?? 0)) return bestK;
  return 0;
}

function phaseScore(
  item: ClassifiedReport,
  hours: readonly MarineHour[],
  residual: readonly (number | null)[],
  lag: number,
): number {
  // A missing in-series lag does not vote. Confidence still falls back to that hour.
  if (item.kind === "in-series" && lag !== 0) {
    const shifted = nearestIndex(hours, parseWall(hours[item.index].time) + lag * HOUR_MS);
    if (shifted < 0) return 0;
  }
  const tide = tideDirectionAtLag(item, hours, residual, lag);
  return tide != null && tide === item.report.direction ? 1 : 0;
}

function fitSpeedFactor(
  classified: readonly ClassifiedReport[],
  hours: readonly MarineHour[],
  residual: readonly (number | null)[],
  days: ReadonlyMap<string, DayTide>,
  offset: number,
): number {
  const ratios: number[] = [];
  for (const item of classified) {
    const prior = speedPrior(item, hours, residual, days, offset);
    if (!prior) continue;
    ratios.push((bandIndex(item.report.strength) + 0.5) / (bandIndex(prior) + 0.5));
  }
  if (ratios.length < 2) return 1;
  const mean = ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
  return Math.min(2, Math.max(0.5, mean));
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
}): "low" | "medium" | "high" {
  if (input.classified.length === 0 || input.contradicted || input.tideDirection == null) return "low";
  const similar = input.classified.filter((item) => {
    const reportPhase = tideDirectionAtLag(item, input.hours, input.residual, input.offset);
    return reportPhase != null && reportPhase === input.tideDirection;
  });
  if (similar.length < 2) return "low";
  const directionAgree = similar.filter((item) => item.report.direction === input.direction).length / similar.length;
  const strengthAgree = similar.filter((item) => item.report.strength === input.strength).length / similar.length;
  if (directionAgree === 1 && strengthAgree >= 0.6 && similar.length >= 4) {
    return input.allowHighConfidence ? "high" : "medium";
  }
  if (directionAgree >= 0.8) return "medium";
  return "low";
}

function recentPull(
  hour: MarineHour,
  classified: readonly ClassifiedReport[],
): { item: ClassifiedReport; weight: number } | null {
  const hourMs = parseWall(hour.time);
  let best: { item: ClassifiedReport; weight: number } | null = null;
  for (const item of classified) {
    const reportMs = parseWall(item.report.time);
    if (Number.isNaN(reportMs)) continue;
    const since = (hourMs - reportMs) / HOUR_MS;
    if (since < 0 || since >= FADE_HOURS) continue;
    if (!best || reportMs >= parseWall(best.item.report.time)) {
      best = { item, weight: 1 - since / FADE_HOURS };
    }
  }
  return best;
}

/** Tide direction at a lag. An in-series miss uses the unshifted hour, as shiftIndex does. */
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
  const slope = slopeFromResidual(residual, index);
  return slope == null ? null : directionFromSlope(slope);
}

function speedPrior(
  item: ClassifiedReport,
  hours: readonly MarineHour[],
  residual: readonly (number | null)[],
  days: ReadonlyMap<string, DayTide>,
  offset: number,
): Strength | null {
  if (item.failed) return null;
  if (item.seriesIndex >= 0) {
    const index = shiftIndex(hours, item.seriesIndex, offset);
    const slope = slopeFromResidual(residual, index);
    if (slope == null) return null;
    const stats = days.get(hours[index].time.slice(0, 10));
    if (!stats || stats.range == null || stats.maxAbs == null) return null;
    return hourlyStrength(Math.abs(slope), stats.maxAbs, strengthFromRange(stats.range));
  }
  if (item.storedHourSlope == null) return null;
  if (Math.abs(item.storedHourSlope) < SLACK_SLOPE_M) return "slack";
  return "mild";
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

function opposite(direction: Direction): Direction {
  return direction === "incoming" ? "outgoing" : "incoming";
}

function monsoonNudge(hour: MarineHour, inwardBearingDeg: number): number {
  if (hour.currentVelocityMs == null || hour.currentDirectionDeg == null) return 0;
  const radians = ((hour.currentDirectionDeg - inwardBearingDeg) * Math.PI) / 180;
  const inward = hour.currentVelocityMs * Math.cos(radians);
  return Math.max(-1, Math.min(1, inward / NUDGE_SATURATION_MS));
}

function residualSeries(hours: readonly MarineHour[]): (number | null)[] {
  const times = hours.map((hour) => parseWall(hour.time));
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
      if (Math.abs(delta) > MEAN_HALF_HOURS * HOUR_MS) continue;
      if (delta <= -MEAN_HALF_HOURS * HOUR_MS) spansBefore = true;
      if (delta >= MEAN_HALF_HOURS * HOUR_MS) spansAfter = true;
      const sample = hours[other].seaLevelM;
      if (sample == null || !Number.isFinite(sample)) continue;
      sum += sample;
      count += 1;
    }
    // A full 25-hour window with fewer than 18 finite samples is skipped. Interior hours stay.
    if (spansBefore && spansAfter && count < MIN_MEAN_SAMPLES) return null;
    if (count === 0) return null;
    return level - sum / count;
  });
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

/** Positive lag reads a later residual: that stored slope matched the logged direction. */
function shiftIndex(hours: readonly MarineHour[], index: number, offsetHours: number): number {
  if (offsetHours === 0) return index;
  const target = parseWall(hours[index].time) + offsetHours * HOUR_MS;
  const shifted = nearestIndex(hours, target);
  return shifted < 0 ? index : shifted;
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

function strengthFromRange(range: number): Strength {
  if (range < 0.35) return "slack";
  if (range < 0.6) return "mild";
  if (range < 0.85) return "strong";
  return "too_strong";
}

/** Slack inside 5 mm, and below 0.02 m. The steepest hour takes the envelope. */
function hourlyStrength(absSlope: number, maxAbsSlope: number, envelope: Strength): Strength {
  const top = bandIndex(envelope);
  if (absSlope <= TIE_M || absSlope < SLACK_SLOPE_M || top <= 0) return "slack";
  const span = maxAbsSlope - SLACK_SLOPE_M;
  if (!(span > 0)) return envelope;
  const t = Math.min(1, Math.max(0, (absSlope - SLACK_SLOPE_M) / span));
  const index = Math.min(top, Math.max(1, Math.ceil(t * top - 1e-9)));
  return STRENGTHS[index];
}

function applySpeed(strength: Strength, factor: number): Strength {
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
