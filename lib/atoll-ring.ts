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

/** A point on the outline, its inward normal there, and its sample point 3 km out to sea. */
export type RingSample = {
  on: { lat: number; lon: number };
  inwardDeg: number;
  seaward: { lat: number; lon: number };
};

/**
 * RING_POINTS points spaced evenly by distance along the outline, each with its sample point moved 3 km seaward
 * along the outline's inward normal there: the same offset as a site's sample point. Empty for a ring too small
 * to sample.
 */
export function ringSamples(ring: RimRing): RingSample[] {
  if (ring.length < 4) return [];
  const refLat = ring[0][0];
  const km = (a: readonly [number, number], b: readonly [number, number]) =>
    Math.hypot((b[0] - a[0]) * KM_PER_DEG_LAT, (b[1] - a[1]) * KM_PER_DEG_LON * Math.cos((refLat * Math.PI) / 180));
  const lengths = ring.slice(1).map((point, index) => km(ring[index], point));
  const perimeter = lengths.reduce((sum, value) => sum + value, 0);
  if (!(perimeter > 0)) return [];
  const samples: RingSample[] = [];
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
    const normal = rimInwardBearing(on, ring);
    if (normal == null) continue;
    // At an exact corner the normal can come out reversed; the sample point must be outside the atoll.
    // Ring points stay 3 km out. The GEBCO step-out is per catalog site, whose 3 km cell can sit on the reef.
    const out = seawardPoint(on.lat, on.lon, normal);
    const reversed = pointInRing(out.lat, out.lon, ring);
    const inwardDeg = reversed ? (normal + 180) % 360 : normal;
    samples.push({ on, inwardDeg, seaward: reversed ? seawardPoint(on.lat, on.lon, inwardDeg) : out });
  }
  return samples;
}

/** The ring samples' sample points. */
export function ringPoints(ring: RimRing): { lat: number; lon: number }[] {
  return ringSamples(ring).map((sample) => sample.seaward);
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

/**
 * An atoll's ring: its samples, each sample's series (null where it has none yet), and the mean level. `pending`
 * counts the samples still waiting on their first fetch (asked not to wait); a ring with any is not kept. A sample
 * whose fetch failed is null but not pending.
 */
export type AtollRing = { samples: RingSample[]; series: (MarineHour[] | null)[]; level: RingLevel[]; pending?: number };

const memo = new Map<string, { at: number; ring: AtollRing }>();
const loading = new Map<string, Promise<AtollRing>>();
const EMPTY: AtollRing = { samples: [], series: [], level: [] };

/**
 * The atoll's ring from the marine cache (fetching points it has not seen, unless told not to wait). Its level is
 * empty when the atoll has no outline or too few points have data. Kept for ten minutes per atoll, so a map load
 * does not reread twelve files for every site; every site asking at once shares one read. A ring with points still
 * pending their first fetch is not kept, so the next load picks them up instead of a lopsided ring for ten minutes.
 */
export async function atollRing(atoll: Atoll, options: FetchOptions = {}): Promise<AtollRing> {
  const rim = rimForAtoll(atoll);
  if (!rim) return EMPTY;
  const key = atoll.rimSourceUrl;
  const kept = memo.get(key);
  if (kept && Date.now() - kept.at < MEMO_MS && kept.ring.level.length > 0) return kept.ring;
  const running = loading.get(key);
  if (running) return running;
  const samples = ringSamples(rim);
  const load = Promise.all(samples.map((sample) => fetchMarine(sample.seaward.lat, sample.seaward.lon, options)))
    .then((fetched) => {
      const series = fetched.map((result) => (result.ok ? result.hours : null));
      const usable = series.filter((hours): hours is MarineHour[] => hours != null);
      const pending = fetched.filter((result) => !result.ok && result.pending).length;
      const level = usable.length >= MIN_RING_POINTS ? ringLevelFromSeries(usable) : [];
      const ring: AtollRing = { samples, series, level, pending };
      if (pending === 0) memo.set(key, { at: Date.now(), ring });
      else memo.delete(key);
      return ring;
    })
    .finally(() => loading.delete(key));
  loading.set(key, load);
  return load;
}

/** The atoll's ring level: empty when it has none. */
export async function atollRingLevel(atoll: Atoll, options: FetchOptions = {}): Promise<RingLevel[]> {
  return (await atollRing(atoll, options)).level;
}

/** For tests. */
export function clearRingMemo(): void {
  memo.clear();
  loading.clear();
}
