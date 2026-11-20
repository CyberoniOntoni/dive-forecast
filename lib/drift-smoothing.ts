import { parseWall } from "./forecast";
import { distanceKm } from "./geometry";
import type { MarineHour } from "./types";

/**
 * The ocean model's current comes on a grid of about 8 km, so two channel sites a few hundred metres apart can draw
 * their drift from different cells: one gets 0.3 m/s along its axis and runs in all week, the other gets none and
 * turns with every tide (Prisca Head and Prisca Corner, North Malé, Nov 2026). Neither cell knows the reef that well.
 * Each channel site's drift is therefore the mean of the current at its own sample point and its neighbours' sample
 * points, weighted by a Gaussian of their distance: nearby sites end up with nearly the same drift, and a lone site
 * keeps its own. The tide and sea level stay the site's own; only the current is shared.
 */
export const DRIFT_SMOOTHING_SIGMA_KM = 3;
/** Neighbours' sample points further than this from the site's own add nothing worth fetching (weight under 2%). */
export const DRIFT_SMOOTHING_MAX_KM = 8;

/**
 * A sample point's series. `share` (default 1) is its pin's share of its channel: pins of one channel split one weight
 * (channelWeights in lib/load-site.ts), so a channel with four dive sites lends as much as one with a single pin.
 */
export type DriftSample = { point: { lat: number; lon: number }; hours: readonly MarineHour[]; share?: number };

/**
 * A lender's series can end earlier or start later than the site's: series are refreshed at different times. Past
 * either end, for up to this long, it lends the mean of its 25 hours at that end, so the weights hold steady to the
 * end of the week instead of the site falling back to its own cell. Its tide averages out over 25 hours.
 */
export const DRIFT_EDGE_HOLD_HOURS = 48;
const EDGE_MEAN_HOURS = 25;
const HOUR_MS = 60 * 60 * 1000;

/** A neighbour's weight by the distance between the two sample points: 1 at the same point, 0 past the cut-off. */
export function driftWeight(distance: number): number {
  if (!(distance <= DRIFT_SMOOTHING_MAX_KM)) return 0;
  return Math.exp(-(distance * distance) / (2 * DRIFT_SMOOTHING_SIGMA_KM * DRIFT_SMOOTHING_SIGMA_KM));
}

/**
 * The site's hours with each hour's current replaced by the weighted vector mean of its own current and the
 * neighbours' current at the same hour. Each weight is the pin's channel share times driftWeight. An hour where the
 * site has no current keeps none (the seasonal curve stands in later). A neighbour lends at an hour it has, or past
 * the ends of its series for up to DRIFT_EDGE_HOLD_HOURS its 25-hour mean at that end; otherwise it lends nothing
 * that hour. Sea level is untouched.
 */
export function smoothedDriftHours(own: DriftSample, neighbours: readonly DriftSample[]): MarineHour[] {
  const others = neighbours
    .map((sample) => ({
      weight: (sample.share ?? 1) * driftWeight(distanceKm(own.point, sample.point)),
      lend: lender(sample.hours),
    }))
    .filter((item) => item.weight > 0 && item.lend != null);
  if (others.length === 0) return [...own.hours];
  const ownWeight = own.share ?? 1;
  return own.hours.map((hour) => {
    const mine = currentVector(hour);
    if (!mine) return hour;
    let east = ownWeight * mine.east;
    let north = ownWeight * mine.north;
    let total = ownWeight;
    for (const other of others) {
      const theirs = other.lend!(hour.time);
      if (!theirs) continue;
      east += other.weight * theirs.east;
      north += other.weight * theirs.north;
      total += other.weight;
    }
    if (!(total > 0)) return hour;
    east /= total;
    north /= total;
    const speed = Math.hypot(east, north);
    const direction = speed > 0 ? (((Math.atan2(east, north) * 180) / Math.PI) + 360) % 360 : 0;
    return { ...hour, currentVelocityMs: speed, currentDirectionDeg: direction };
  });
}

type Vector = { east: number; north: number };


/** A neighbour's current by hour, holding its edge means past either end. Null when it has no current at all. */
function lender(hours: readonly MarineHour[]): ((time: string) => Vector | null) | null {
  const byTime = currentByTime(hours);
  const times = [...byTime.keys()].sort();
  if (times.length === 0) return null;
  const mean = (picked: readonly string[]): Vector => {
    let east = 0;
    let north = 0;
    for (const time of picked) {
      east += byTime.get(time)!.east;
      north += byTime.get(time)!.north;
    }
    return { east: east / picked.length, north: north / picked.length };
  };
  const firstMs = parseWall(times[0]);
  const lastMs = parseWall(times[times.length - 1]);
  const head = mean(times.slice(0, EDGE_MEAN_HOURS));
  const tail = mean(times.slice(-EDGE_MEAN_HOURS));
  const holdMs = DRIFT_EDGE_HOLD_HOURS * HOUR_MS;
  return (time) => {
    const exact = byTime.get(time);
    if (exact) return exact;
    const at = parseWall(time);
    if (!Number.isFinite(at)) return null;
    if (at > lastMs && at - lastMs <= holdMs) return tail;
    if (at < firstMs && firstMs - at <= holdMs) return head;
    return null;
  };
}

function currentVector(hour: MarineHour): Vector | null {
  const speed = hour.currentVelocityMs;
  const direction = hour.currentDirectionDeg;
  if (speed == null || direction == null || !Number.isFinite(speed) || !Number.isFinite(direction)) return null;
  const radians = (direction * Math.PI) / 180;
  return { east: speed * Math.sin(radians), north: speed * Math.cos(radians) };
}

function currentByTime(hours: readonly MarineHour[]): Map<string, Vector> {
  const map = new Map<string, Vector>();
  for (const hour of hours) {
    const vector = currentVector(hour);
    if (vector) map.set(hour.time, vector);
  }
  return map;
}
