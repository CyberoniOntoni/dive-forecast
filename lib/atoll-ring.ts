import { residualLevels } from "./forecast";
import { inFlightPerRequest } from "./cloudflare";
import { fetchMarine, seawardPoint, seriesWindowKey, type FetchOptions } from "./marine";
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

/** Hours of full coverage needed before a ring with points missing at an hour is filled in from the others. */
const MIN_FIT_HOURS = 48;
/**
 * Fill weights whose absolute values sum past this are not used (the plain mean is): large weights of opposite sign
 * would turn a small difference between two points, such as a kept older fetch, into a large ring level. Real rings
 * sum to 1.0 to 1.2 (all 20 atolls, 23 Nov 2026, 3 neighbouring points missing).
 */
const MAX_WEIGHT_SUM = 3;

/**
 * The mean residual level of the ring points by hour: the lagoon level a channel's head is measured against.
 * An hour present in fewer than MIN_RING_POINTS series is left out. A series that is null (no data at all) is not a
 * ring point; the mean is over the others.
 *
 * Series can cover different hours (one fetched on another Maldives date, or kept from an older fetch after a failed
 * one). A plain mean over whichever points an hour has would step by up to 3.7 cm where the set changes, which the
 * head's τ of 0.25 h turns into 0.15 m/h: as much as a typical tide slope. So at an hour with points missing, the
 * mean of all the ring's points is predicted from the points it has, by least squares over the hours where every
 * point has data. The ring's levels are tidal and span a few constituents, so that prediction holds to under 0.5 cm
 * (checked on all 20 atolls, 23 Nov 2026, 1 to 3 neighbouring points missing). With fewer than MIN_FIT_HOURS of full
 * coverage, or weights summing past MAX_WEIGHT_SUM, it falls back to the plain mean.
 */
export function ringLevelFromSeries(series: readonly (readonly MarineHour[] | null)[]): RingLevel[] {
  const points = series
    .filter((hours): hours is readonly MarineHour[] => hours != null)
    .map((hours) => {
      const residual = residualLevels(hours);
      const byTime = new Map<string, number>();
      hours.forEach((hour, index) => {
        const level = residual[index];
        if (level != null) byTime.set(hour.time, level);
      });
      return byTime;
    });
  const times = [...new Set(points.flatMap((byTime) => [...byTime.keys()]))].sort();
  const full = times.filter((time) => points.every((byTime) => byTime.has(time)));
  const meanOf = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const fits = new Map<string, number[] | null>();
  const fitFor = (present: readonly number[]): number[] | null => {
    const key = present.join(",");
    if (!fits.has(key)) {
      fits.set(
        key,
        full.length >= MIN_FIT_HOURS
          ? leastSquares(
              full.map((time) => present.map((index) => points[index].get(time)!)),
              full.map((time) => meanOf(points.map((byTime) => byTime.get(time)!))),
            )
          : null,
      );
    }
    return fits.get(key)!;
  };
  const levels: RingLevel[] = [];
  for (const time of times) {
    const present = points.flatMap((byTime, index) => (byTime.has(time) ? [index] : []));
    if (present.length < MIN_RING_POINTS) continue;
    const values = present.map((index) => points[index].get(time)!);
    const weights = present.length < points.length ? fitFor(present) : null;
    const levelM = weights && weights.reduce((sum, weight) => sum + Math.abs(weight), 0) <= MAX_WEIGHT_SUM ? values.reduce((sum, value, at) => sum + weights[at] * value, 0) : meanOf(values);
    levels.push({ time, levelM });
  }
  return levels;
}

/**
 * Weights w minimising |A·w − b|², by the normal equations with a tiny ridge (the points' levels are close to
 * collinear), solved by Gaussian elimination with partial pivoting. Null when the system is singular.
 */
function leastSquares(rows: readonly (readonly number[])[], target: readonly number[]): number[] | null {
  const size = rows[0]?.length ?? 0;
  if (size === 0) return null;
  const matrix = Array.from({ length: size }, () => new Array<number>(size + 1).fill(0));
  rows.forEach((row, r) => {
    for (let i = 0; i < size; i += 1) {
      matrix[i][size] += row[i] * target[r];
      for (let j = 0; j < size; j += 1) matrix[i][j] += row[i] * row[j];
    }
  });
  const scale = Math.max(...matrix.map((row, i) => row[i]));
  if (!(scale > 0)) return null;
  for (let i = 0; i < size; i += 1) matrix[i][i] += scale * 1e-9;
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
    }
    if (!(Math.abs(matrix[pivot][column]) > 0)) return null;
    [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
    for (let row = column + 1; row < size; row += 1) {
      const factor = matrix[row][column] / matrix[column][column];
      for (let j = column; j <= size; j += 1) matrix[row][j] -= factor * matrix[column][j];
    }
  }
  const weights = new Array<number>(size).fill(0);
  for (let i = size - 1; i >= 0; i -= 1) {
    let sum = matrix[i][size];
    for (let j = i + 1; j < size; j += 1) sum -= matrix[i][j] * weights[j];
    weights[i] = sum / matrix[i][i];
  }
  return weights.every(Number.isFinite) ? weights : null;
}

const MEMO_MS = 10 * 60 * 1000;

/**
 * An atoll's ring: its samples, each sample's series (null where it has none yet), and the mean level. `pending`
 * counts the samples still waiting on their first fetch (asked not to wait); a ring with any is not kept. A sample
 * whose fetch failed is null but not pending.
 */
export type AtollRing = { samples: RingSample[]; series: (MarineHour[] | null)[]; level: RingLevel[]; pending?: number };

const memo = new Map<string, { at: number; ring: AtollRing }>();
/** Per request on a worker (perRequest); the memo above holds plain data and is shared. */
const ringLoadsInFlight = inFlightPerRequest<AtollRing>();
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
  // The long past window (options.past) is another ring: kept apart.
  const key = seriesWindowKey(options, atoll.rimSourceUrl);
  const kept = memo.get(key);
  if (kept && Date.now() - kept.at < MEMO_MS && kept.ring.level.length > 0) return kept.ring;
  const loading = ringLoadsInFlight();
  const running = loading.get(key);
  if (running) return running;
  const samples = ringSamples(rim);
  const load = Promise.all(samples.map((sample) => fetchMarine(sample.seaward.lat, sample.seaward.lon, options)))
    .then((fetched) => {
      const series = fetched.map((result) => (result.ok ? result.hours : null));
      const usable = series.filter((hours): hours is MarineHour[] => hours != null);
      const pending = fetched.filter((result) => !result.ok && result.pending).length;
      const level = usable.length >= MIN_RING_POINTS ? ringLevelFromSeries(series) : [];
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
  ringLoadsInFlight().clear();
}
