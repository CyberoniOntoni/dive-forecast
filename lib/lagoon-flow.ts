import type { AtollRing } from "./atoll-ring";
import { pointInRing, type RimRing } from "./rim";
import { netFlowSeries } from "./forecast";
import { STRENGTHS, type HourForecast, type MarineHour, type Strength } from "./types";

/**
 * How much a known channel counts as an opening, in km of rim. The rim between channels leaks too, so each rim
 * point counts for the length of rim it stands for; a dive-site channel is a bigger, deeper gap on top of that.
 * Calibrated with the owner (scripts/lagoon-calibrate.ts, HYDRODYNAMICS_PLAN §4.10).
 */
export const CHANNEL_WEIGHT_KM = 2;

/**
 * Lagoon flow index, residual metres per hour of exchange spread over the lagoon: slack below `slack`, then mild,
 * strong, and very strong from `strong` up. Mutable only so scripts/lagoon-calibrate.ts can sweep it.
 */
export const LAGOON_BANDS = { slack: 0.02, mild: 0.2, strong: 0.55 };

/** Closer than this a source is treated as this far: a pin is never inside an opening. */
const MIN_DISTANCE_KM = 0.5;
const KM_PER_DEG_LAT = 110.57;
const KM_PER_DEG_LON = 111.32;

/** An opening in the rim: where it is, how much rim it stands for, and its net flow (positive in) by hour. */
export type LagoonSource = { lat: number; lon: number; weightKm: number; flow: ReadonlyMap<string, number> };

type Point = { lat: number; lon: number };

function flowByTime(hours: readonly MarineHour[], flow: readonly (number | null)[]): Map<string, number> {
  const byTime = new Map<string, number>();
  hours.forEach((hour, index) => {
    const value = flow[index];
    if (value != null && Number.isFinite(value)) byTime.set(hour.time, value);
  });
  return byTime;
}

function kmBetween(a: Point, b: Point): number {
  return Math.hypot(
    (b.lat - a.lat) * KM_PER_DEG_LAT,
    (b.lon - a.lon) * KM_PER_DEG_LON * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180),
  );
}

/**
 * The porous rim: each ring sample on the outline and a midpoint between each pair of neighbours, so 24 openings
 * for 12 samples, each standing for its share of the perimeter. A sample's flow is the channel model's net flow at
 * its sample point, along its inward normal, against the ring level; a midpoint takes the mean of its neighbours.
 * Samples with no series are left out with their midpoints.
 */
export function rimSources(ring: AtollRing, headTauHours?: number): LagoonSource[] {
  const count = ring.samples.length;
  if (count < 3 || ring.level.length === 0) return [];
  const flows = ring.samples.map((sample, index) => {
    const hours = ring.series[index];
    if (!hours) return null;
    return flowByTime(
      hours,
      netFlowSeries({ hours, inwardBearingDeg: sample.inwardDeg, ringLevel: ring.level, headTauHours }),
    );
  });
  let perimeter = 0;
  for (let index = 0; index < count; index += 1) perimeter += kmBetween(ring.samples[index].on, ring.samples[(index + 1) % count].on);
  const weightKm = perimeter / (2 * count);
  const sources: LagoonSource[] = [];
  for (let index = 0; index < count; index += 1) {
    const here = flows[index];
    if (!here) continue;
    const point = ring.samples[index].on;
    sources.push({ lat: point.lat, lon: point.lon, weightKm, flow: here });
    const nextIndex = (index + 1) % count;
    const next = flows[nextIndex];
    if (!next) continue;
    const nextPoint = ring.samples[nextIndex].on;
    const mean = new Map<string, number>();
    for (const [time, value] of here) {
      const other = next.get(time);
      if (other != null) mean.set(time, (value + other) / 2);
    }
    sources.push({ lat: (point.lat + nextPoint.lat) / 2, lon: (point.lon + nextPoint.lon) / 2, weightKm, flow: mean });
  }
  return sources;
}

/** A known channel as an opening: its own net flow from the channel model, weighted CHANNEL_WEIGHT_KM. */
export function channelSource(
  point: Point,
  hours: readonly MarineHour[],
  inwardBearingDeg: number,
  ringLevel: AtollRing["level"] | undefined,
  weightKm: number = CHANNEL_WEIGHT_KM,
  headTauHours?: number,
): LagoonSource {
  const flow = netFlowSeries({ hours: [...hours], inwardBearingDeg, ringLevel, headTauHours });
  return { ...point, weightKm, flow: flowByTime(hours, flow) };
}

/** Grid cells across the lagoon, for the rising or falling surface; at most about this many. */
const SINK_CELLS = 1500;

/**
 * Where the exchanged water goes: the lagoon surface rises or falls everywhere. Without it, openings spread evenly
 * round a closed rim give no flow inside at all (2-D sources on a ring cancel there), so the flood would not spread
 * inward. This is the pull at a site from a unit sink spread evenly over the lagoon (per km² per hour), from a grid
 * of cells inside the outline, plus the lagoon's area.
 */
export type LagoonSink = { east: number; north: number; areaKm2: number };

export function lagoonSink(site: Point, rim: RimRing): LagoonSink {
  const lats = rim.map(([lat]) => lat);
  const lons = rim.map(([, lon]) => lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const kmLon = KM_PER_DEG_LON * Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const boxKm2 = (maxLat - minLat) * KM_PER_DEG_LAT * (maxLon - minLon) * kmLon;
  const stepKm = Math.max(0.5, Math.sqrt(boxKm2 / SINK_CELLS));
  const cellKm2 = stepKm * stepKm;
  let east = 0;
  let north = 0;
  let areaKm2 = 0;
  for (let lat = minLat + stepKm / KM_PER_DEG_LAT / 2; lat < maxLat; lat += stepKm / KM_PER_DEG_LAT) {
    for (let lon = minLon + stepKm / kmLon / 2; lon < maxLon; lon += stepKm / kmLon) {
      if (!pointInRing(lat, lon, rim)) continue;
      areaKm2 += cellKm2;
      const dx = (site.lon - lon) * kmLon;
      const dy = (site.lat - lat) * KM_PER_DEG_LAT;
      const r = Math.max(MIN_DISTANCE_KM, Math.hypot(dx, dy));
      // A sink draws toward itself: the opposite of a source's push.
      const scale = -cellKm2 / (2 * Math.PI * r * r);
      east += scale * dx;
      north += scale * dy;
    }
  }
  return { east, north, areaKm2 };
}

/**
 * Lagoon current at a point and hour: each opening's exchange spreading from it (in) or drawing toward it (out),
 * as a 2-D source, and the same water taken up evenly by the lagoon surface (the sink). East and north components.
 * Null when fewer than half the openings have that hour.
 */
export function lagoonVelocity(
  site: Point,
  sources: readonly LagoonSource[],
  time: string,
  sink?: LagoonSink,
): { east: number; north: number } | null {
  let east = 0;
  let north = 0;
  let present = 0;
  let exchange = 0;
  for (const source of sources) {
    const q = source.flow.get(time);
    if (q == null) continue;
    present += 1;
    exchange += q * source.weightKm;
    const dx = (site.lon - source.lon) * KM_PER_DEG_LON * Math.cos((site.lat * Math.PI) / 180);
    const dy = (site.lat - source.lat) * KM_PER_DEG_LAT;
    const r = Math.max(MIN_DISTANCE_KM, Math.hypot(dx, dy));
    const scale = (q * source.weightKm) / (2 * Math.PI * r * r);
    east += scale * dx;
    north += scale * dy;
  }
  if (present * 2 < sources.length || present === 0) return null;
  if (sink && sink.areaKm2 > 0) {
    const density = exchange / sink.areaKm2;
    east += density * sink.east;
    north += density * sink.north;
  }
  return { east, north };
}

/** Compass heading of the main axis of a set of vectors, in [0, 180). */
export function mainAxisDeg(vectors: readonly { east: number; north: number }[]): number {
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const { east, north } of vectors) {
    sxx += east * east;
    syy += north * north;
    sxy += east * north;
  }
  // Angle of the axis from east, counter-clockwise; compass heading is 90° minus that.
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const heading = 90 - (theta * 180) / Math.PI;
  return ((heading % 180) + 180) % 180;
}

export function lagoonStrength(speed: number): Strength {
  if (speed < LAGOON_BANDS.slack) return STRENGTHS[0];
  if (speed < LAGOON_BANDS.mild) return "mild";
  if (speed < LAGOON_BANDS.strong) return "strong";
  return "too_strong";
}

export type LagoonForecast = { hours: HourForecast[]; axisDeg: number | null };

/**
 * Hour by hour lagoon flow at a site, along its main axis: "incoming" runs toward axisDeg, "outgoing" the other way,
 * as along a reef. `levels` are the site's own residual levels by hour, for the tide line under the slider.
 * Confidence is always low. Empty with no axis when no hour has enough openings.
 */
export function lagoonHours(
  site: Point,
  sources: readonly LagoonSource[],
  levels: readonly { time: string; levelM: number }[],
  sink?: LagoonSink,
): LagoonForecast {
  const flows = levels
    .map((level) => ({ level, u: lagoonVelocity(site, sources, level.time, sink) }))
    .filter((item): item is { level: { time: string; levelM: number }; u: { east: number; north: number } } => item.u != null);
  if (flows.length === 0) return { hours: [], axisDeg: null };
  const axisDeg = mainAxisDeg(flows.map((item) => item.u));
  const radians = (axisDeg * Math.PI) / 180;
  const hours = flows.map(({ level, u }) => {
    const along = u.east * Math.sin(radians) + u.north * Math.cos(radians);
    return {
      time: level.time,
      direction: along >= 0 ? ("incoming" as const) : ("outgoing" as const),
      strength: lagoonStrength(Math.abs(along)),
      confidence: "low" as const,
      levelM: level.levelM,
    };
  });
  return { hours, axisDeg };
}
