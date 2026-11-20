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

export type DriftSample = { point: { lat: number; lon: number }; hours: readonly MarineHour[] };

/** A neighbour's weight by the distance between the two sample points: 1 at the same point, 0 past the cut-off. */
export function driftWeight(distance: number): number {
  if (!(distance <= DRIFT_SMOOTHING_MAX_KM)) return 0;
  return Math.exp(-(distance * distance) / (2 * DRIFT_SMOOTHING_SIGMA_KM * DRIFT_SMOOTHING_SIGMA_KM));
}

/**
 * The site's hours with each hour's current replaced by the weighted vector mean of its own current and the
 * neighbours' current at the same hour. An hour where the site has no current keeps none (the seasonal curve stands
 * in later); a neighbour missing that hour or its current is left out of it. Sea level is untouched.
 */
export function smoothedDriftHours(own: DriftSample, neighbours: readonly DriftSample[]): MarineHour[] {
  const others = neighbours
    .map((sample) => ({ weight: driftWeight(distanceKm(own.point, sample.point)), byTime: currentByTime(sample.hours) }))
    .filter((item) => item.weight > 0);
  if (others.length === 0) return [...own.hours];
  return own.hours.map((hour) => {
    const mine = currentVector(hour);
    if (!mine) return hour;
    let east = mine.east;
    let north = mine.north;
    let total = 1;
    for (const other of others) {
      const theirs = other.byTime.get(hour.time);
      if (!theirs) continue;
      east += other.weight * theirs.east;
      north += other.weight * theirs.north;
      total += other.weight;
    }
    east /= total;
    north /= total;
    const speed = Math.hypot(east, north);
    const direction = speed > 0 ? (((Math.atan2(east, north) * 180) / Math.PI) + 360) % 360 : 0;
    return { ...hour, currentVelocityMs: speed, currentDirectionDeg: direction };
  });
}

function currentVector(hour: MarineHour): { east: number; north: number } | null {
  const speed = hour.currentVelocityMs;
  const direction = hour.currentDirectionDeg;
  if (speed == null || direction == null || !Number.isFinite(speed) || !Number.isFinite(direction)) return null;
  const radians = (direction * Math.PI) / 180;
  return { east: speed * Math.sin(radians), north: speed * Math.cos(radians) };
}

function currentByTime(hours: readonly MarineHour[]): Map<string, { east: number; north: number }> {
  const map = new Map<string, { east: number; north: number }>();
  for (const hour of hours) {
    const vector = currentVector(hour);
    if (vector) map.set(hour.time, vector);
  }
  return map;
}
