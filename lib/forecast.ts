import {
  STRENGTHS,
  type Direction,
  type ForecastInput,
  type HourForecast,
  type MarineHour,
  type Report,
  type RingLevel,
  type Strength,
} from "./types";

import { getMaldivesMonsoonDrift, type OceanDrift } from "./seasonal";

export type { ForecastInput, OceanDrift };
export { getMaldivesMonsoonDrift };

export const FORECAST_NOTICE =
  "The 8 km grid is weak in passes. Direction comes from the tide, the level difference across the atoll and the monsoon current through it, and from reports, not from the current at the dive pin.";

const HOUR_MS = 60 * 60 * 1000;
const SLACK_SLOPE_M = 0.02;
const FADE_HOURS = 6;
const MEAN_HALF_HOURS = 12;
const MIN_MEAN_SAMPLES = 18;
const WINDOW_HALF_HOURS = 6;
const WINDOW_HOURS = WINDOW_HALF_HOURS * 2 + 1;
const HOUR_MATCH_MS = 45 * 60 * 1000;
const DRIFT_HALF_HOURS = 12;

/**
 * Identifies the forecast logic. Saved with every report's prediction so results can be grouped by model.
 * Change it whenever a change alters what the forecast says for the same inputs.
 */
export const FORECAST_MODEL_VERSION = "tide+throughflow+head+alongreef+lagoon+strait/15";

/**
 * What feeds the through-flow. The API current is a total current (ocean model, Stokes drift, and FES2014 tide),
 * so its hourly value is mostly tide at strongly tidal cells. "drift" uses the 25-hour mean, which removes the tide.
 * "off" gives no through-flow: the tide alone decides.
 */
export const NUDGE_SOURCE: "drift" | "off" = "drift";

/**
 * Cross-section that counts as a typical pass: the median of the measured dive-site channels (about 32,000 m2).
 * It used to be Vaadhoo Kandu (5 km x 400 m), an inter-atoll channel, which made every real pass look narrow and
 * pinned each site with published dimensions at the maximum factor, so it was "too strong" nearly all the time.
 */
export const REF_CHANNEL_AREA_M2 = 31_500;

/**
 * Through-flow, in residual metres per hour for each m/s of ocean drift along the channel's inward axis.
 *
 * An atoll is not a bowl that fills and empties through every channel at once. The monsoon current pushes water
 * through it: channels facing the current run in, the far side runs out, and the tide makes that stronger or weaker
 * and can reverse it near the turns. The net flow at a channel is the tide's slope plus this constant times the
 * drift component along its inward axis (monsoonInwardFlux). The constant is calibrated to the owner's experience
 * (scripts/throughflow-calibrate.ts): a channel facing a typical monsoon drift runs in most of the day, slackening or
 * briefly reversing near high and low water, more at spring tides. There are no reports to fit it to yet.
 */
export const THROUGHFLOW_SLOPE_PER_MS = 0.7;
/** Principal lunar semidiurnal period, hours: a tide's steepest hourly slope is about π × range / this. */
const M2_PERIOD_HOURS = 12.42;
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

/** The tide's range, and the steepest net flow (tide plus through-flow) and steepest tide alone, over 25 hours. */
type TideStats = { range: number | null; maxAbs: number | null; maxAbsTide?: number | null };

type ClassifiedBase = {
  report: Report;
  seriesIndex: number;
  storedHourSlope: number | null;
  pullSlope: number | null;
  failed: boolean;
  temporalWeight: number;
  /** Through-flow at the report's hour, in slope units; added to its stored tide slopes. */
  through: number;
  /** Head drive from six hours before the report through six after, slope units; added to the stored tide slopes. */
  head: readonly number[];
};

/** Through-flow plus head drive at a report, `lag` hours from its hour. */
function addedAt(item: ClassifiedBase, lag: number): number {
  return item.through + (item.head[WINDOW_HALF_HOURS + lag] ?? 0);
}

type ClassifiedReport =
  | (ClassifiedBase & { kind: "in-series"; index: number })
  | (ClassifiedBase & { kind: "single-slope"; slope: number })
  | (ClassifiedBase & { kind: "slope-window"; slopes: readonly (number | null)[] })
  | (ClassifiedBase & { kind: "unusable" });

function opposite(direction: Direction): Direction {
  return direction === "incoming" ? "outgoing" : "incoming";
}

export function forecastHours(input: ForecastInput): HourForecast[] {
  const hours = currentForNudge(input.hours);
  const constriction = constrictionFactor(input.channelWidthM, input.channelDepthM);
  // The tide alone: the level shown under the slider and the day's range.
  const residual = residualSeries(hours);
  // Tide plus through-flow: everything that decides direction and strength reads its slope.
  const throughOnly = throughflowSeries(hours, input.inwardBearingDeg);
  const head = headSeries(hours, residual, input.ringLevel, input.headTauHours ?? ATOLL_HEAD_TAU_HOURS);
  const flow = flowSeries(residual, addSeries(throughOnly, head));
  const classified = (input.reports ?? []).map((report) => classifyReport(report, hours));
  for (const item of classified) {
    item.through = reportThroughflow(item, throughOnly);
    item.head = reportHead(item, hours, head);
  }
  const offset = fitPhaseOffset(classified, hours, flow);
  applyPullSlopes(classified, hours, flow, offset);
  const tides = centeredTides(hours, residual, flow);
  const speedFactor = fitSpeedFactor(classified, hours, flow, tides, offset, constriction);
  const allowHighConfidence = input.allowHighConfidence ?? true;
  const reportBands = ownHourBands(classified, hours, flow, tides, offset, speedFactor, constriction);
  return finishRuns(
    hours,
    residual,
    flow,
    offset,
    speedFactor,
    tides,
    classified,
    reportBands,
    allowHighConfidence,
    constriction,
  );
}

/**
 * How quickly the lagoon follows the ocean, hours. A channel runs from the higher water to the lower: the ocean just
 * outside it against the lagoon behind it, which sits near the mean of the ocean all round the atoll (the ring level).
 * That head over this time, in residual metres per hour, adds to the tide's slope and the through-flow. Calibrated
 * against the owner's description (scripts/atoll-head-calibrate.ts, HYDRODYNAMICS_PLAN §4.8).
 */
export const ATOLL_HEAD_TAU_HOURS = 0.25;

/**
 * The head drive for each hour, in slope units: (the hour's residual less the ring level at that hour) / tau.
 * Zero where either is missing, with no ring level, or with an infinite tau.
 */
function headSeries(
  hours: readonly MarineHour[],
  residual: readonly (number | null)[],
  ring: readonly { time: string; levelM: number }[] | undefined,
  tauHours: number,
): number[] {
  if (!ring || ring.length === 0 || !(tauHours > 0) || !Number.isFinite(tauHours)) return hours.map(() => 0);
  const byTime = new Map(ring.map((item) => [item.time, item.levelM]));
  return hours.map((hour, index) => {
    const level = residual[index];
    const lagoon = byTime.get(hour.time);
    if (level == null || lagoon == null || !Number.isFinite(lagoon)) return 0;
    return (level - lagoon) / tauHours;
  });
}

function addSeries(left: readonly number[], right: readonly number[]): number[] {
  return left.map((value, index) => value + (right[index] ?? 0));
}

/**
 * The tidal part of the along-reef current is scaled by this; the drift is added unscaled. The 8 km grid smooths the
 * tidal stream along the walls, so taken as is the drift outweighs it at about half the outer walls, and they would
 * run one way all day. ×3 lets most walls turn with the tide while a strong monsoon still holds some one way.
 * Set with the owner from the along-reef calibration (HYDRODYNAMICS_PLAN §4.6); no observations back it yet.
 */
export const ALONG_REEF_TIDE_GAIN = 3;

/**
 * Along-reef index, m/s after the gain: slack below `slack`, then mild, strong, and very strong from `strong` up.
 * Mutable only so scripts/strength-calibrate.ts can sweep it.
 */
export const ALONG_REEF_BANDS_MS = { slack: 0.15, mild: 0.5, strong: 1.3 };

export type AlongReefInput = {
  hours: MarineHour[];
  /** Compass heading along the reef that counts as "incoming": the inward bearing turned 90° clockwise. */
  alongHeadingDeg: number;
};

/**
 * Outer walls with land or unbroken reef behind them: the water runs along the reef, not into the atoll.
 * The hourly current projected on the reef line, with its tidal part (the hour less the 25-hour drift) scaled by
 * ALONG_REEF_TIDE_GAIN. "incoming" means toward alongHeadingDeg, "outgoing" the opposite way along the reef.
 * Reports do not pull it yet, and its confidence is always low.
 */
export function alongReefHours(input: AlongReefInput): HourForecast[] {
  const hours = input.hours;
  const drift = currentForNudge(hours);
  const residual = residualSeries(hours);
  const forecast: HourForecast[] = [];
  hours.forEach((hour, index) => {
    const level = residual[index];
    if (level == null) return;
    const total = alongComponent(hour, input.alongHeadingDeg);
    const mean = alongComponent(drift[index], input.alongHeadingDeg);
    if (!Number.isFinite(total) || !Number.isFinite(mean)) return;
    const along = ALONG_REEF_TIDE_GAIN * (total - mean) + mean;
    forecast.push({
      time: hour.time,
      direction: along >= 0 ? "incoming" : "outgoing",
      strength: alongReefStrength(Math.abs(along)),
      confidence: "low",
      levelM: level,
    });
  });
  return forecast;
}

/**
 * Walls of an ocean strait between atolls (Vaadhoo Kandu). The owner's account (HYDRODYNAMICS_PLAN §4.11): the
 * monsoon sets the main direction (west in the NE monsoon, east in the SW), the semi-diurnal tide crosses the
 * archipelago eastward so the rising tide pushes east and the falling tide pulls west, and the strait funnels both
 * like a venturi. So the flow through the strait, in m/s toward the east:
 *
 *     v = STRAIT_TIDE_GAIN · tide slope (m/h)  +  STRAIT_DRIFT_GAIN · 25-hour drift along the strait (m/s)
 *
 * A spring flood with the SW drift rips east; on the ebb the east-running drift slackens or briefly turns west.
 * Gains from scripts/strait-calibrate.ts against the owner's speeds (99 days, SW monsoon): east 93 % of hours, west
 * on 23 % of mid-ebb hours, neap-day peak 0.76 m/s, spring-day peak 1.19 m/s, very strong on 16 % of days.
 */
export const STRAIT_TIDE_GAIN = 2.5;
export const STRAIT_DRIFT_GAIN = 3.5;

/**
 * Strait flow bands, m/s, from the owner's dive speeds: mild days run 0.4–0.8 m/s (0.8–1.5 kn), spring tides with
 * the monsoon 1.0–1.8 m/s, very strong from about 2.5 kn. Mutable only so scripts/strait-calibrate.ts can sweep it.
 */
export const STRAIT_BANDS_MS = { slack: 0.2, mild: 0.6, strong: 1.3 };

export type StraitInput = {
  hours: MarineHour[];
  /** The strait's axis at the wall, pointing east (straitHeading). "incoming" means running that way. */
  axisDeg: number;
};

/**
 * The flow through a strait at one of its walls, m/s toward axisDeg (eastward), hour by hour, with the tide slope
 * and residual level of each hour. Gains default to the shipped constants; the calibration sweeps them.
 */
export function straitFlow(
  input: StraitInput,
  gains: { tide: number; drift: number } = { tide: STRAIT_TIDE_GAIN, drift: STRAIT_DRIFT_GAIN },
): { time: string; speedMs: number; slope: number; levelM: number }[] {
  const hours = input.hours;
  const drift = currentForNudge(hours);
  const residual = residualSeries(hours);
  // The tide pushes east: its share along the axis.
  const eastShare = Math.cos(((input.axisDeg - 90) * Math.PI) / 180);
  const flow: { time: string; speedMs: number; slope: number; levelM: number }[] = [];
  hours.forEach((hour, index) => {
    const level = residual[index];
    if (level == null) return;
    const slope = slopeFromResidual(residual, index);
    const driftAlong = alongComponent(drift[index], input.axisDeg);
    if (slope == null || !Number.isFinite(driftAlong)) return;
    flow.push({ time: hour.time, speedMs: gains.tide * slope * eastShare + gains.drift * driftAlong, slope, levelM: level });
  });
  return flow;
}

/** Hour by hour flow through a strait at one of its walls; "incoming" runs toward axisDeg (eastward). Always low. */
export function straitHours(input: StraitInput): HourForecast[] {
  return straitFlow(input).map((hour) => ({
    time: hour.time,
    direction: hour.speedMs >= 0 ? "incoming" : "outgoing",
    strength: straitStrength(Math.abs(hour.speedMs)),
    confidence: "low",
    levelM: hour.levelM,
  }));
}

export function straitStrength(speed: number): Strength {
  if (speed < STRAIT_BANDS_MS.slack) return "slack";
  if (speed < STRAIT_BANDS_MS.mild) return "mild";
  if (speed < STRAIT_BANDS_MS.strong) return "strong";
  return "too_strong";
}

/** The first model version that read wall reports along the reef. Before it, "incoming" meant into the atoll. */
const FIRST_ALONG_REEF_VERSION = 8;

/**
 * A wall report's direction against today's reef heading, or null when it cannot be read along the reef.
 * The heading saved with the report decides; failing that, the bearing in its saved prediction, if that prediction
 * came from a model that already read walls along the reef. A report from before that meant into or out of the
 * atoll and has no along-reef reading. A saved heading more than 90° from today's flips the direction.
 */
export function alongReportDirection(
  report: Report,
  alongHeadingDeg: number,
  kind: "wall" | "lagoon" = "wall",
): Direction | null {
  let saved: number | null = typeof report.alongHeadingDeg === "number" ? report.alongHeadingDeg : null;
  // A lagoon site's axis comes from its flow, not its bearing, so only a saved heading can read its report.
  const fromBearing = kind === "wall";
  if (
    saved == null &&
    fromBearing &&
    report.predicted &&
    modelVersionNumber(report.predicted.modelVersion) >= FIRST_ALONG_REEF_VERSION
  ) {
    saved = (((report.predicted.bearingDeg + 90) % 360) + 360) % 360;
  }
  if (saved == null || !Number.isFinite(saved)) return null;
  const apart = Math.abs(((saved - alongHeadingDeg + 540) % 360) - 180);
  return apart > 90 ? opposite(report.direction) : report.direction;
}

function modelVersionNumber(version: string): number {
  const match = /\/(\d+)$/.exec(version);
  return match ? Number(match[1]) : 0;
}

export function alongReefStrength(speed: number): Strength {
  if (speed < ALONG_REEF_BANDS_MS.slack) return "slack";
  if (speed < ALONG_REEF_BANDS_MS.mild) return "mild";
  if (speed < ALONG_REEF_BANDS_MS.strong) return "strong";
  return "too_strong";
}

/** The hour's current along a compass heading, m/s, or NaN when it has none. */
function alongComponent(hour: MarineHour, headingDeg: number): number {
  const radians = (headingDeg * Math.PI) / 180;
  return currentComponent(hour, Math.sin) * Math.sin(radians) + currentComponent(hour, Math.cos) * Math.cos(radians);
}

/**
 * The model's net flow at each hour, in residual metres per hour, before reports: the tide's slope plus through-flow
 * plus the head across the atoll. Positive runs in along the inward bearing. Null where the hour has no tide level.
 * The lagoon model takes it as the exchange at each opening in the rim.
 */
export function netFlowSeries(input: ForecastInput): (number | null)[] {
  const hours = currentForNudge(input.hours);
  const residual = residualSeries(hours);
  const through = throughflowSeries(hours, input.inwardBearingDeg);
  const head = headSeries(hours, residual, input.ringLevel, input.headTauHours ?? ATOLL_HEAD_TAU_HOURS);
  const flow = flowSeries(residual, addSeries(through, head));
  return flow.map((level, index) => (level == null ? null : slopeFromResidual(flow, index)));
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
  const base = { report, seriesIndex, storedHourSlope, pullSlope, failed, temporalWeight, through: 0, head: NO_HEAD };
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

/** Lagged net slope at an in-series report. Outside reports keep the stored tide slope plus their through-flow. */
function applyPullSlopes(
  classified: readonly ClassifiedReport[],
  hours: readonly MarineHour[],
  flow: readonly (number | null)[],
  offset: number,
): void {
  for (const item of classified) {
    if (item.seriesIndex < 0) {
      item.pullSlope = item.storedHourSlope == null ? null : item.storedHourSlope + addedAt(item, 0);
      continue;
    }
    const shifted = shiftIndex(hours, item.seriesIndex, offset);
    item.pullSlope = shifted < 0 ? null : slopeFromResidual(flow, shifted);
  }
}

/** The tide's range, the steepest net flow and the steepest tide over the 25 hours centered on each hour. */
function centeredTides(
  hours: readonly MarineHour[],
  residual: readonly (number | null)[],
  flow: readonly (number | null)[],
): TideStats[] {
  return hours.map((_, index) => {
    const tide = tideWindow(hours, residual, index);
    return { range: tide.range, maxAbs: tideWindow(hours, flow, index).maxAbs, maxAbsTide: tide.maxAbs };
  });
}

/**
 * The day's top band. The tide's range sets it, and through-flow adds the range a tide would need to run that much
 * faster: a tide's steepest slope is about π × range / 12.42 h, so extra slope × 12.42 / π is extra range. With no
 * through-flow this is the tide's own envelope; with a flat tide the through-flow alone sets it.
 */
function envelopeFor(stats: TideStats, constriction: number): Strength | null {
  if (stats.range == null || stats.maxAbs == null) return null;
  const extraSlope = Math.max(0, stats.maxAbs - (stats.maxAbsTide ?? stats.maxAbs));
  return strengthFromRange(stats.range + (extraSlope * M2_PERIOD_HOURS) / Math.PI, constriction);
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
  /** Net slope: tide plus through-flow. */
  slope: number;
  index: number;
};

/** One walk over the series. Each hour gets its own band from the net flow, then reports pull. */
function finishRuns(
  hours: readonly MarineHour[],
  residual: readonly (number | null)[],
  flow: readonly (number | null)[],
  offset: number,
  speedFactor: number,
  tides: readonly TideStats[],
  classified: readonly ClassifiedReport[],
  reportBands: ReadonlyMap<ClassifiedReport, Strength | null>,
  allowHighConfidence: boolean,
  constriction: number = 1.0,
): HourForecast[] {
  // A report fades for six hours and must not cut the run.
  // It moves later hours by how far it differed from the model at its own hour, so a report that agrees changes nothing.
  const settled = settledHours(hours, flow, offset, speedFactor, tides, constriction);
  const modelBands = new Map(settled.map((open) => [open.index, open.strength]));
  const reportPull = (hour: OpenHour): HourForecast => {
    const pull = aggregateReportPull(hour, hours, classified, modelBands);
    return {
      time: hour.time,
      direction: pull.direction,
      strength: pull.strength,
      confidence: confidenceFor({
        classified,
        reportBands,
        hours,
        flow,
        offset,
        direction: pull.direction,
        strength: pull.strength,
        tideDirection: hour.direction,
        contradicted: pull.contradicted,
        allowHighConfidence,
        hourTime: hour.time,
      }),
      levelM: residual[hour.index] as number,
    };
  };

  return settled.map(reportPull);
}

/** Open hours with their own band from the net flow, before the report pull. */
function settledHours(
  hours: readonly MarineHour[],
  flow: readonly (number | null)[],
  offset: number,
  speedFactor: number,
  tides: readonly TideStats[],
  constriction: number = 1.0,
): OpenHour[] {
  const settled: OpenHour[] = [];
  for (let index = 0; index < hours.length; index += 1) {
    // The flow series has a value exactly where the residual does, so this skips the hours with no tide level.
    if (flow[index] == null) continue;
    const shifted = shiftIndex(hours, index, offset);
    if (shifted < 0) continue;
    const slope = slopeFromResidual(flow, shifted);
    if (slope == null || !Number.isFinite(slope)) continue;
    // C8: exact-zero slope is slack. Direction is the next signed lagged slope, never the previous hour.
    let direction = directionFromSlope(slope);
    if (direction == null) {
      direction = nextSignedDirection(hours, flow, offset, index);
      if (direction == null) continue;
    }
    const stats = tides[index];
    const envelope = envelopeFor(stats, constriction);
    if (envelope == null || stats.maxAbs == null) continue;
    const strength = hourlyStrength(Math.abs(slope), stats.maxAbs, envelope);
    settled.push({ time: hours[index].time, direction, strength: applySpeed(strength, speedFactor), slope, index });
  }
  return settled;
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
  flow: readonly (number | null)[],
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
      if (phaseScore(voter, hours, flow, k) > 0) {
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
  flow: readonly (number | null)[],
  lag: number,
): number {
  // A missing in-series lag does not vote and does not use the unshifted hour.
  if (item.kind === "in-series" && lag !== 0 && shiftIndex(hours, item.index, lag) < 0) return 0;
  const tide = tideDirectionAtLag(item, hours, flow, lag);
  return tide != null && tide === item.report.direction ? 1 : 0;
}

function fitSpeedFactor(
  classified: readonly ClassifiedReport[],
  hours: readonly MarineHour[],
  flow: readonly (number | null)[],
  tides: readonly TideStats[],
  offset: number,
  constriction: number = 1.0,
): number {
  let weightedRatioSum = 0;
  let totalWeight = 0;
  let count = 0;

  for (const item of classified) {
    const prior = speedPrior(item, hours, flow, tides, offset, constriction);
    if (!prior) continue;
    const reportPhase = tideDirectionAtLag(item, hours, flow, offset);
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
  reportBands: ReadonlyMap<ClassifiedReport, Strength | null>;
  hours: readonly MarineHour[];
  flow: readonly (number | null)[];
  offset: number;
  direction: Direction;
  strength: Strength;
  tideDirection: Direction;
  contradicted: boolean;
  allowHighConfidence: boolean;
  hourTime?: string;
}): "low" | "medium" | "high" {
  if (input.classified.length === 0 || input.contradicted) return "low";

  const targetHourMs = input.hourTime ? parseWall(input.hourTime) : Number.NaN;

  const samePhase = (item: ClassifiedReport) => {
    const reportPhase = tideDirectionAtLag(item, input.hours, input.flow, input.offset);
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
  // Strength is a track record too: did the model get each report's band right at that report's own hour?
  // Reports come from all points in a run, so comparing them with this hour's band would miss a right model near a turn.
  const strAgreeWeight = weightOf(
    similar.filter((item) => item.report.strength === (input.reportBands.get(item) ?? input.strength)),
  );

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

/**
 * Net flow direction (tide plus through-flow) at a report, at a lag. An in-series miss is outside the series, not
 * the unshifted hour.
 */
function tideDirectionAtLag(
  item: ClassifiedReport,
  hours: readonly MarineHour[],
  flow: readonly (number | null)[],
  lag: number,
): Direction | null {
  if (item.kind === "unusable") return null;
  if (item.kind === "single-slope") {
    // One stored slope can support lag 0 or a 6-hour flip, not a measured intermediate lag. Six hours on the tide has
    // turned; with no through-flow so has the flow, but with through-flow one slope cannot say.
    const sign = directionFromSlope(item.slope + addedAt(item, 0));
    if (!sign) return null;
    if (lag === 0) return sign;
    const tideOnly = item.through === 0 && item.head.every((value) => value === 0);
    if (tideOnly && Math.abs(lag) === WINDOW_HALF_HOURS) return opposite(sign);
    return null;
  }
  if (item.kind === "slope-window") {
    const slope = item.slopes[WINDOW_HALF_HOURS + lag];
    if (typeof slope !== "number" || !Number.isFinite(slope)) return null;
    return directionFromSlope(slope + addedAt(item, lag));
  }
  const index = shiftIndex(hours, item.index, lag);
  if (index < 0) return null;
  const slope = slopeFromResidual(flow, index);
  return slope == null ? null : directionFromSlope(slope);
}

function speedPrior(
  item: ClassifiedReport,
  hours: readonly MarineHour[],
  flow: readonly (number | null)[],
  tides: readonly TideStats[],
  offset: number,
  constriction: number = 1.0,
): Strength | null {
  if (item.failed) return null;
  if (item.seriesIndex >= 0) {
    // A fitted lag is the lagged slope's own band. Peak band would treat a matching report as a miss.
    if (offset !== 0) return laggedSlopeBand(item, hours, flow, tides, offset, constriction);
    return shownStrength(hours, flow, offset, tides, item.seriesIndex, constriction);
  }
  return storedPrior(item, offset, constriction);
}

/**
 * The band the model gives at each report's own hour, with the fitted speed and before any report pull: what the
 * report can be judged against. Null when the model has no graded band there (an older report saved without its
 * day's range), so confidence falls back to comparing that report with the hour being scored.
 */
function ownHourBands(
  classified: readonly ClassifiedReport[],
  hours: readonly MarineHour[],
  flow: readonly (number | null)[],
  tides: readonly TideStats[],
  offset: number,
  speedFactor: number,
  constriction: number,
): Map<ClassifiedReport, Strength | null> {
  return new Map(
    classified.map((item) => {
      const band =
        item.failed
          ? null
          : item.seriesIndex >= 0
            ? speedPrior(item, hours, flow, tides, offset, constriction)
            : gradedStoredBand(item, offset, constriction);
      return [item, band == null ? null : applySpeed(band, speedFactor)];
    }),
  );
}

/**
 * Band the model would have given a report outside this series, from what was saved with it.
 * A report with its day's range and a slope window is graded like an in-series hour, at the fitted lag.
 * An older report has no range, so all it can say is slack or flowing, and flowing counts as mild.
 */
function storedPrior(item: ClassifiedReport, offset: number, constriction: number): Strength | null {
  if (item.storedHourSlope == null) return null;
  if (!isGradedStored(item)) return Math.abs(item.storedHourSlope + addedAt(item, 0)) < SLACK_SLOPE_M ? "slack" : "mild";
  return gradedStoredBand(item, offset, constriction);
}

function isGradedStored(item: ClassifiedReport): item is ClassifiedReport & { kind: "slope-window" } {
  const range = item.report.rangeM;
  return item.kind === "slope-window" && typeof range === "number" && Number.isFinite(range);
}

/** The graded band from a saved range and slope window, or null for a report saved without them. */
function gradedStoredBand(item: ClassifiedReport, offset: number, constriction: number): Strength | null {
  if (item.storedHourSlope == null || !isGradedStored(item)) return null;
  const range = item.report.rangeM as number;
  const slope = item.slopes[WINDOW_HALF_HOURS + offset];
  if (typeof slope !== "number") return null;
  // Thirteen hours span more than a half cycle, so the window holds this run's steepest hour.
  const tides = item.slopes.map((value) => (typeof value === "number" ? Math.abs(value) : 0));
  const nets = item.slopes.map((value, index) =>
    typeof value === "number" ? Math.abs(value + addedAt(item, index - WINDOW_HALF_HOURS)) : 0,
  );
  const stats: TideStats = { range, maxAbs: Math.max(...nets), maxAbsTide: Math.max(...tides) };
  const envelope = envelopeFor(stats, constriction);
  return envelope == null ? null : hourlyStrength(Math.abs(slope + addedAt(item, offset)), stats.maxAbs as number, envelope);
}

function laggedSlopeBand(
  item: ClassifiedReport,
  hours: readonly MarineHour[],
  flow: readonly (number | null)[],
  tides: readonly TideStats[],
  offset: number,
  constriction: number = 1.0,
): Strength | null {
  const index = shiftIndex(hours, item.seriesIndex, offset);
  if (index < 0) return null;
  const slope = slopeFromResidual(flow, index);
  if (slope == null) return null;
  const stats = tides[item.seriesIndex];
  const envelope = envelopeFor(stats, constriction);
  if (envelope == null || stats.maxAbs == null) return null;
  return hourlyStrength(Math.abs(slope), stats.maxAbs, envelope);
}

/** Clock-hour strength from the net flow, before the report pull. Factor 1, so the fit is not circular. */
function shownStrength(
  hours: readonly MarineHour[],
  flow: readonly (number | null)[],
  offset: number,
  tides: readonly TideStats[],
  index: number,
  constriction: number = 1.0,
): Strength | null {
  for (const hour of settledHours(hours, flow, offset, 1, tides, constriction)) {
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

/**
 * Hours with the current replaced by what the nudge should see. Times and sea level are untouched.
 * The drift is the vector mean over the 25 hours around each hour, with the window slid inward at the ends of the
 * series so it stays a full tidal cycle. A short series (under 24 hours) cannot remove the tide and averages what it has.
 * An hour with too few current samples takes the drift of the nearest hour that has one. Only a series with no usable
 * current at all keeps null currents, which fall back to the scaled seasonal curve (throughflowFor).
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
  const drifted = hours.map((hour, index) => {
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
  return fillDriftGaps(drifted, times);
}

/**
 * A gap in the current takes the drift of the nearest hour that has one, so it does not jump to the seasonal curve,
 * which runs well above the measured drift. Equal distance keeps the earlier hour.
 */
function fillDriftGaps(drifted: MarineHour[], times: readonly number[]): MarineHour[] {
  const measured = drifted
    .map((hour, index) => ({ hour, time: times[index] }))
    .filter(({ hour, time }) => !Number.isNaN(time) && hour.currentVelocityMs != null && hour.currentDirectionDeg != null);
  if (measured.length === 0) return drifted;
  return drifted.map((hour, index) => {
    if (Number.isNaN(times[index]) || (hour.currentVelocityMs != null && hour.currentDirectionDeg != null)) return hour;
    let nearest = measured[0];
    for (const candidate of measured) {
      if (Math.abs(candidate.time - times[index]) < Math.abs(nearest.time - times[index])) nearest = candidate;
    }
    return { ...hour, currentVelocityMs: nearest.hour.currentVelocityMs, currentDirectionDeg: nearest.hour.currentDirectionDeg };
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

/**
 * The seasonal curve's speed against the measured 25-hour drift: 0.16 m/s median in the cached series around
 * 30 Sep 2026, where the curve gives 0.39 m/s. Applied only when a series has no usable current at all.
 */
export const SEASONAL_DRIFT_SCALE = 0.4;

/** Through-flow for one hour, in slope units. A calm hour (exactly zero drift) has none. */
function throughflowFor(hour: MarineHour, inwardBearingDeg: number): number {
  if (hour.currentVelocityMs === 0) return 0;
  const measured = hour.currentVelocityMs != null && Number.isFinite(hour.currentVelocityMs) &&
    hour.currentDirectionDeg != null && Number.isFinite(hour.currentDirectionDeg);
  const scale = measured ? 1 : SEASONAL_DRIFT_SCALE;
  return scale * THROUGHFLOW_SLOPE_PER_MS * monsoonInwardFlux(resolveHourDrift(hour), inwardBearingDeg);
}

/** Through-flow for each hour of a series whose current is already the 25-hour drift (currentForNudge). */
function throughflowSeries(hours: readonly MarineHour[], inwardBearingDeg: number): number[] {
  return hours.map((hour) => throughflowFor(hour, inwardBearingDeg));
}

/**
 * The residual plus the accumulated through-flow, so that its hour-to-hour change is the tide's slope plus that
 * hour's through-flow: the net flow. It has a value exactly where the residual does. Only its slopes mean anything.
 */
function flowSeries(residual: readonly (number | null)[], through: readonly number[]): (number | null)[] {
  let added = 0;
  return residual.map((level, index) => {
    const value = level == null ? null : level + added;
    added += through[index] ?? 0;
    return value;
  });
}

/**
 * Through-flow at a report's hour. Inside the series it is that hour's; outside, the value saved with the report.
 * Older reports saved none, and they count as having none: the seasonal curve runs about twice the measured drift.
 */
function reportThroughflow(item: ClassifiedReport, through: readonly number[]): number {
  if (item.seriesIndex >= 0) return through[item.seriesIndex] ?? 0;
  if (NUDGE_SOURCE === "off") return 0;
  const saved = item.report.throughflowM;
  return typeof saved === "number" && Number.isFinite(saved) ? saved : 0;
}

const NO_HEAD: readonly number[] = new Array<number>(WINDOW_HOURS).fill(0);

/**
 * Head drive round a report, lag -6 to +6. Inside the series it comes from the series; outside, from the window
 * saved with the report. Older reports saved none and count as having none.
 */
function reportHead(item: ClassifiedReport, hours: readonly MarineHour[], head: readonly number[]): readonly number[] {
  if (item.seriesIndex >= 0) {
    return Array.from({ length: WINDOW_HOURS }, (_, slot) => {
      const index = shiftIndex(hours, item.seriesIndex, slot - WINDOW_HALF_HOURS);
      return index < 0 ? 0 : head[index] ?? 0;
    });
  }
  const saved = item.report.headWindowM;
  if (!Array.isArray(saved)) return NO_HEAD;
  return Array.from({ length: WINDOW_HOURS }, (_, slot) => {
    const value = saved[slot];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  });
}

/**
 * Head drive from six hours before `time` through six after, slope units, to save with a report.
 * Null with no ring level, so nothing is saved.
 */
export function headWindowAt(
  hours: readonly MarineHour[],
  time: string,
  ringLevel: readonly RingLevel[] | undefined,
): number[] | null {
  if (!ringLevel || ringLevel.length === 0) return null;
  const reportMs = parseWall(time);
  if (Number.isNaN(reportMs)) return null;
  const head = headSeries(hours, residualSeries(hours), ringLevel, ATOLL_HEAD_TAU_HOURS);
  const window: number[] = [];
  for (let lag = -WINDOW_HALF_HOURS; lag <= WINDOW_HALF_HOURS; lag += 1) {
    const index = nearestIndex(hours, reportMs + lag * HOUR_MS, HOUR_MATCH_MS);
    window.push(index < 0 ? 0 : head[index]);
  }
  return window;
}

/** Through-flow at the hour nearest `time`, in slope units, to save with a report. Null when that hour is missing. */
export function throughflowAt(hours: readonly MarineHour[], time: string, inwardBearingDeg: number): number | null {
  const drifted = currentForNudge(hours);
  const index = nearestIndex(drifted, parseWall(time), HOUR_MATCH_MS);
  if (index < 0) return null;
  return throughflowFor(drifted[index], inwardBearingDeg);
}

/** Sea level less its 25-hour mean, per hour; null where there is no full window. */
export function residualLevels(hours: readonly MarineHour[]): (number | null)[] {
  return residualSeries(hours);
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

/**
 * Residual change over the hour after this one. The forward difference is kept on purpose: a centred one moves
 * turns half an hour earlier and scored worse on the replay benchmark (direction 91.3% to 89.1%, slack 20 to
 * 30 minutes). The half-hour lead likely stands in for the pass lagging the ocean. Revisit with real reports.
 */
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
  flow: readonly (number | null)[],
  offset: number,
  index: number,
): Direction | null {
  for (let later = index + 1; later < hours.length; later += 1) {
    const shifted = shiftIndex(hours, later, offset);
    if (shifted < 0) continue;
    const slope = slopeFromResidual(flow, shifted);
    if (slope == null) continue;
    const direction = directionFromSlope(slope);
    if (direction != null) return direction;
  }
  return null;
}

/**
 * The day's top band from its effective tidal range, metres: slack below `slack`, then mild, strong, and very strong
 * (stored as too_strong) from `strong` up. Set against the range climatology and the owner's experience: neap days
 * peak mild, most days strong, and very strong takes more than the tide alone (a monsoon push, the head across the
 * atoll, or a narrow channel), so it is rare outside the NE monsoon. HYDRODYNAMICS_PLAN §4.9.
 * Mutable only so scripts/strength-calibrate.ts can sweep it.
 */
export const RANGE_BANDS_M = { slack: 0.25, mild: 0.6, strong: 2.0 };

export function strengthFromRange(range: number, constriction: number = 1.0): Strength {
  const effectiveRange = range * constriction;
  if (effectiveRange < RANGE_BANDS_M.slack) return "slack";
  // Narrowing cannot lift a day with almost no tide past mild.
  if (range < RANGE_BANDS_M.slack) return "mild";
  if (effectiveRange < RANGE_BANDS_M.mild) return "mild";
  if (effectiveRange < RANGE_BANDS_M.strong) return "strong";
  return "too_strong";
}

/**
 * Slack below 0.02 m an hour. The steepest hour takes the envelope and the rest ramp up to it on the raw slope.
 * Channel narrowing is already in the envelope, so it does not also steepen the ramp.
 */
export function hourlyStrength(absSlope: number, maxAbsSlope: number, envelope: Strength): Strength {
  const top = bandIndex(envelope);
  if (absSlope < SLACK_SLOPE_M || top <= 0) return "slack";
  const span = maxAbsSlope - SLACK_SLOPE_M;
  if (!(span > 0)) return envelope;
  const t = Math.min(1, Math.max(0, (absSlope - SLACK_SLOPE_M) / span));
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

