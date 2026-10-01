import { residualLevels } from "./forecast";
import { fetchMarine, seawardPoint, type FetchOptions } from "./marine";
import { pointInRing, rimForAtoll, rimInwardBearing, type RimRing } from "./rim";
import type { Atoll, MarineHour, RingLevel } from "./types";

/** Points spaced evenly round an atoll's outline. Their mean residual level stands for the lagoon's. */
export const RING_POINTS = 12;
/** With fewer ring points than this at an hour, the mean is lopsided and that hour has no ring level. */
export const MIN_RING_POINTS = 9;

const KM_PER_DEG_LAT = 110.57;
const KM_PER_DEG_LON = 111.32;

export type { RingLevel };

/**
 * RING_POINTS points spaced evenly by distance along the outline, each moved 3 km seaward along the outline's
 * inward normal there: the same offset as a site's sample point. Empty for a ring too small to sample.
 */
export function ringPoints(ring: RimRing): { lat: number; lon: number }[] {
  if (ring.length < 4) return [];
  const refLat = ring[0][0];
  const km = (a: readonly [number, number], b: readonly [number, number]) =>
    Math.hypot((b[0] - a[0]) * KM_PER_DEG_LAT, (b[1] - a[1]) * KM_PER_DEG_LON * Math.cos((refLat * Math.PI) / 180));
  const lengths = ring.slice(1).map((point, index) => km(ring[index], point));
  const perimeter = lengths.reduce((sum, value) => sum + value, 0);
  if (!(perimeter > 0)) return [];
  const points: { lat: number; lon: number }[] = [];
  for (let step = 0; step < RING_POINTS; step += 1) {
    let target = (step * perimeter) / RING_POINTS;
    let segment = 0;
    while (segment < lengths.length - 1 && target > lengths[segment]) {
      target -= lengths[segment];
      segment += 1;
    }
    const share = lengths[segment] > 0 ? Math.min(1, target / lengths[segment]) : 0;
    const [lat1, lon1] = ring[segment];
    const [lat2, lon2] = ring[segment + 1];
    const on = { lat: lat1 + share * (lat2 - lat1), lon: lon1 + share * (lon2 - lon1) };
    const inward = rimInwardBearing(on, ring);
    if (inward == null) continue;
    const seaward = seawardPoint(on.lat, on.lon, inward);
    // At an exact corner the normal can come out reversed; the point must be outside the atoll.
    points.push(pointInRing(seaward.lat, seaward.lon, ring) ? seawardPoint(on.lat, on.lon, inward + 180) : seaward);
  }
  return points;
}

/**
 * The mean residual level of the ring points by hour: the lagoon level a channel's head is measured against.
 * An hour present in fewer than MIN_RING_POINTS series is left out.
 */
export function ringLevelFromSeries(series: readonly (readonly MarineHour[])[]): RingLevel[] {
  const sums = new Map<string, { sum: number; count: number }>();
  for (const hours of series) {
    const residual = residualLevels(hours);
    hours.forEach((hour, index) => {
      const level = residual[index];
      if (level == null) return;
      const entry = sums.get(hour.time) ?? { sum: 0, count: 0 };
      entry.sum += level;
      entry.count += 1;
      sums.set(hour.time, entry);
    });
  }
  return [...sums.entries()]
    .filter(([, entry]) => entry.count >= MIN_RING_POINTS)
    .map(([time, entry]) => ({ time, levelM: entry.sum / entry.count }))
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

const MEMO_MS = 10 * 60 * 1000;
const memo = new Map<string, { at: number; level: RingLevel[] }>();

/**
 * The atoll's ring level, from the marine cache (fetching points it has not seen, unless told not to wait).
 * Empty when the atoll has no outline or too few points have data. Kept for ten minutes per atoll, so a map load
 * does not reread twelve files for every site.
 */
export async function atollRingLevel(atoll: Atoll, options: FetchOptions = {}): Promise<RingLevel[]> {
  const ring = rimForAtoll(atoll);
  if (!ring) return [];
  const key = atoll.rimSourceUrl;
  const kept = memo.get(key);
  if (kept && Date.now() - kept.at < MEMO_MS && kept.level.length > 0) return kept.level;
  // Every site on a map load asks at once: they share one read of the twelve points.
  const running = loading.get(key);
  if (running) return running;
  const load = Promise.all(ringPoints(ring).map((point) => fetchMarine(point.lat, point.lon, options)))
    .then((fetched) => {
      const series = fetched.flatMap((result) => (result.ok ? [result.hours] : []));
      const level = series.length >= MIN_RING_POINTS ? ringLevelFromSeries(series) : [];
      memo.set(key, { at: Date.now(), level });
      return level;
    })
    .finally(() => loading.delete(key));
  loading.set(key, load);
  return load;
}

const loading = new Map<string, Promise<RingLevel[]>>();

/** For tests. */
export function clearRingMemo(): void {
  memo.clear();
  loading.clear();
}
