import { destinationKm } from "./marine";
import type { RimRing } from "./rim";

/**
 * How much of the open-ocean sea reaches a site, by the direction it comes from. The wave model (about 9 km) treats a
 * whole atoll as one soft barrier and puts nearly the same swell in the lagoon as outside it, so the shelter comes from
 * our own geometry: atoll outlines (data/rims.json) and the reef-crest gaps in them (data/openings.json).
 *
 * For each direction a ray runs from the site toward where the sea comes from. Crossing an atoll outline is crossing
 * reef: swell over it keeps REEF_TRANSMISSION of its height. Crossing it through a gap lets the swell in, spreading
 * out behind the gap the farther the site is from it. Wind waves also grow again over open water behind the reef, so
 * their share is never less than what the fetch to the first reef would build.
 */

/** Height share of swell past a reef rim: overtopping and the swell that bends round the reef ends. */
export const REEF_TRANSMISSION = 0.15;
/** Rays run this far. Past it, other atolls' shelter is already in the offshore sample. */
export const RAY_KM = 60;
/** Fetch at which wind waves reach the offshore wind-wave height. */
export const FULL_FETCH_KM = 60;
/** Fetch behind a wall's own reef for wind from the lagoon side. */
const OWN_LEE_FETCH_KM = 0.5;
/** A rim site's own outline crossing is skipped within this distance: pins sit on the reef, not exactly on the line. */
const OWN_RIM_KM = 0.8;
/** A gap's spread: a site this many gap-widths behind it keeps the full swell; past that it falls with sqrt(distance). */
const GAP_SPREAD_WIDTHS = 2;
/** A crossing this close to a gap's middle beyond half its width still counts as through the gap. */
const GAP_SLACK_KM = 0.15;
/** A gap with a shallow reef-flat bridge lets through this share. */
const BRIDGED_GAP = 0.5;
/** Directional spread each side of the mean direction, degrees. */
const SPREAD_DEG = 45;
export const STEP_DEG = 5;
const DIRECTIONS = 360 / STEP_DEG;
const KM_PER_DEG_LAT = 110.57;
const KM_PER_DEG_LON = 111.32;

export type ExposureOpening = { lat: number; lon: number; widthM: number; reefFlatBridges?: boolean };

/**
 * Where the site sits relative to the rim. "wall": on the outer reef, its own reef shelters it from the lagoon side.
 * "channel": in or at a gap in the rim, open both ways. "lagoon": inside the atoll.
 */
export type ExposureKind = "wall" | "channel" | "lagoon";

export type ExposureSite = { lat: number; lon: number; kind: ExposureKind; inwardBearingDeg: number | null };

/** Share of the offshore wave height that reaches the site, for seas from each STEP_DEG direction (index 0 = from north). */
export type SiteExposure = { swell: number[]; wind: number[] };

type Vec = [number, number];

export function siteExposure(
  site: ExposureSite,
  rings: readonly RimRing[],
  openings: readonly ExposureOpening[],
): SiteExposure {
  const reachLat = RAY_KM / KM_PER_DEG_LAT + 0.1;
  const project = (lat: number, lon: number): Vec => [
    (lon - site.lon) * KM_PER_DEG_LON * Math.cos((site.lat * Math.PI) / 180),
    (lat - site.lat) * KM_PER_DEG_LAT,
  ];
  const segments: [Vec, Vec][] = [];
  for (const ring of rings) {
    if (!ring.some(([lat, lon]) => Math.abs(lat - site.lat) < reachLat && Math.abs(lon - site.lon) < reachLat)) continue;
    const points = ring.map(([lat, lon]) => project(lat, lon));
    for (let index = 0; index + 1 < points.length; index += 1) segments.push([points[index], points[index + 1]]);
  }
  const gaps = openings
    .map((opening) => ({ at: project(opening.lat, opening.lon), opening }))
    .filter(({ at }) => Math.hypot(at[0], at[1]) < RAY_KM + 2);

  const raySwell: number[] = [];
  const rayWind: number[] = [];
  for (let index = 0; index < DIRECTIONS; index += 1) {
    const ray = traceRay(index * STEP_DEG, site, segments, gaps);
    raySwell.push(ray.swell);
    rayWind.push(ray.wind);
  }
  return { swell: spread(raySwell), wind: spread(rayWind) };
}

/** The table's share for seas from `fromDeg`, between its STEP_DEG entries. */
export function exposureAt(table: readonly number[], fromDeg: number): number {
  const position = ((((fromDeg % 360) + 360) % 360) / STEP_DEG) % table.length;
  const low = Math.floor(position);
  const high = (low + 1) % table.length;
  const share = position - low;
  return table[low] * (1 - share) + table[high] * share;
}

function traceRay(
  towardDeg: number,
  site: ExposureSite,
  segments: readonly [Vec, Vec][],
  gaps: readonly { at: Vec; opening: ExposureOpening }[],
): { swell: number; wind: number } {
  if (site.kind === "wall" && site.inwardBearingDeg != null && angleBetween(towardDeg, site.inwardBearingDeg) < 90) {
    // The lagoon side of a wall: the wall's own reef and island are between the sea and the dive.
    return { swell: REEF_TRANSMISSION, wind: Math.max(REEF_TRANSMISSION, fetchShare(OWN_LEE_FETCH_KM)) };
  }
  const radians = (towardDeg * Math.PI) / 180;
  const direction: Vec = [Math.sin(radians), Math.cos(radians)];
  const skipKm = site.kind === "lagoon" ? 0 : OWN_RIM_KM;
  const hits = segments
    .map(([from, to]) => crossingKm(direction, from, to))
    .filter((km): km is number => km != null && km > skipKm && km <= RAY_KM)
    .sort((a, b) => a - b);
  if (hits.length === 0) return { swell: 1, wind: 1 };

  let swell = 1;
  for (const km of hits) {
    const point: Vec = [direction[0] * km, direction[1] * km];
    const gap = gaps.find(({ at, opening }) => Math.hypot(at[0] - point[0], at[1] - point[1]) <= opening.widthM / 2000 + GAP_SLACK_KM);
    if (!gap) {
      swell *= REEF_TRANSMISSION;
      continue;
    }
    const widthKm = gap.opening.widthM / 1000;
    swell *= (gap.opening.reefFlatBridges ? BRIDGED_GAP : 1) * Math.min(1, Math.sqrt((GAP_SPREAD_WIDTHS * widthKm) / km));
  }
  return { swell, wind: Math.max(swell, fetchShare(hits[0])) };
}

/** Wind-wave height share grown over this fetch: fetch-limited growth goes as its square root. */
export function fetchShare(fetchKm: number): number {
  return Math.min(1, Math.sqrt(Math.max(0, fetchKm) / FULL_FETCH_KM));
}

/** Km along the unit ray from the origin to where it crosses the segment, or null when it misses. */
function crossingKm(direction: Vec, from: Vec, to: Vec): number | null {
  const edge: Vec = [to[0] - from[0], to[1] - from[1]];
  const denominator = direction[0] * edge[1] - direction[1] * edge[0];
  if (Math.abs(denominator) < 1e-12) return null;
  const along = (from[0] * edge[1] - from[1] * edge[0]) / denominator;
  const onEdge = (from[0] * direction[1] - from[1] * direction[0]) / denominator;
  if (along <= 0 || onEdge < 0 || onEdge > 1) return null;
  return along;
}

/** Seas come from a fan of directions round their mean, weighted cos². */
function spread(rays: readonly number[]): number[] {
  const offsets: { step: number; weight: number }[] = [];
  for (let degrees = -SPREAD_DEG; degrees <= SPREAD_DEG; degrees += STEP_DEG) {
    offsets.push({ step: degrees / STEP_DEG, weight: Math.cos((degrees * Math.PI) / 180) ** 2 });
  }
  const total = offsets.reduce((sum, offset) => sum + offset.weight, 0);
  return rays.map((_, index) => {
    let sum = 0;
    for (const { step, weight } of offsets) sum += weight * rays[(index + step + rays.length) % rays.length];
    return Math.round((sum / total) * 1000) / 1000;
  });
}

function angleBetween(a: number, b: number): number {
  const difference = Math.abs((((a - b) % 360) + 360) % 360);
  return difference > 180 ? 360 - difference : difference;
}

/** Km past the outline that the offshore samples sit, so the wave model's cell is open ocean, not the atoll. */
export const OFFSHORE_KM = 12;
/** The wave model's grid, degrees. Offshore points snap to it so nearby rings share one fetch. */
const WAVE_GRID_DEG = 1 / 12;

/**
 * Eight open-ocean points round an atoll outline, one per compass side (N, NE, ... NW), OFFSHORE_KM past its far
 * edge on that side and snapped to the wave model's grid.
 */
export function offshorePoints(ring: RimRing): { sideDeg: number; lat: number; lon: number }[] {
  const open = ring.slice(0, -1);
  const centre = {
    lat: open.reduce((sum, point) => sum + point[0], 0) / open.length,
    lon: open.reduce((sum, point) => sum + point[1], 0) / open.length,
  };
  const project = (lat: number, lon: number): Vec => [
    (lon - centre.lon) * KM_PER_DEG_LON * Math.cos((centre.lat * Math.PI) / 180),
    (lat - centre.lat) * KM_PER_DEG_LAT,
  ];
  const points = ring.map(([lat, lon]) => project(lat, lon));
  const sides: { sideDeg: number; lat: number; lon: number }[] = [];
  for (let sideDeg = 0; sideDeg < 360; sideDeg += 45) {
    const radians = (sideDeg * Math.PI) / 180;
    const direction: Vec = [Math.sin(radians), Math.cos(radians)];
    let farKm = 0;
    for (let index = 0; index + 1 < points.length; index += 1) {
      const km = crossingKm(direction, points[index], points[index + 1]);
      if (km != null && km > farKm) farKm = km;
    }
    const at = destinationKm(centre.lat, centre.lon, sideDeg, farKm + OFFSHORE_KM);
    sides.push({ sideDeg, lat: snap(at.lat), lon: snap(at.lon) });
  }
  return sides;
}

function snap(degrees: number): number {
  return Math.round(Math.round(degrees / WAVE_GRID_DEG) * WAVE_GRID_DEG * 10000) / 10000;
}
