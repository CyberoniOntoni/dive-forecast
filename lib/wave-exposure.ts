import { destinationKm } from "./marine";
import type { ReefOpening } from "./openings";
import { CHANNEL_RIM_REACH_KM, KM_PER_DEG_LAT, KM_PER_DEG_LON, RIM_NEAR_KM, rimEdgeKm, ringBox, type RimRing } from "./rim";

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
/**
 * Calm water just behind a wooded island: the trees lift the wind off the surface for some way downwind (roughly
 * 10 to 20 tree heights). A first guess.
 */
export const WIND_SHADOW_KM = 0.2;
/** Fetch behind a wall's own reef for wind from the lagoon side. */
const OWN_LEE_FETCH_KM = 0.5;
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
/** What the ray tracer reads of a reef-crest mouth: the atolls it belongs to are only checked by the loader. */
export type GapOpening = Omit<ReefOpening, "atollIds">;

/** An atoll outline and its OSM way id, so a crossing knows whose reef it is. */
export type ExposureRing = { wayId: string; ring: RimRing };

/**
 * Where the site sits relative to the rim. "wall": on the outer reef, its own reef shelters it from the lagoon side.
 * "channel": in or at a gap in the rim, open both ways. "lagoon": inside the atoll.
 */
export type ExposureKind = "wall" | "channel" | "lagoon";

/** ownWayId: the outline of the site's own atoll, the only one whose rim the site may sit on. */
export type ExposureSite = {
  lat: number;
  lon: number;
  kind: ExposureKind;
  inwardBearingDeg: number | null;
  ownWayId: string | null;
};

/**
 * Share of the offshore wave height that reaches the site, for seas from each STEP_DEG direction (index 0 = from
 * north). fetchKm is the open water upwind of the site in each direction before the first reef (or the wall's own reef
 * on its lagoon side), for wind chop raised locally; null where the ray runs out to sea, which the wave model covers.
 * swell and wind are spread over ±45° (the seas fan out); rayWind is each ray's own wind share before that spread,
 * which says whether the water behind that ray's fetch is sheltered or open but for a sliver.
 */
export type SiteExposure = { swell: number[]; wind: number[]; rayWind: number[]; fetchKm: (number | null)[] };

/** An island in the ray tracer: its outline, and whether trees on it shelter the water behind from the wind. */
export type ExposureIsland = { ring: RimRing; wooded: boolean };

/** A shoal in the ray tracer: its outline and box, and the share of the swell height that crosses it. Make with exposureShoal. */
export type ExposureShoal = { ring: RimRing; transmission: number; south: number; north: number; west: number; east: number };

/** A shoal for the ray tracer, with the box read off its ring (the tracer's reach test uses the box). */
export function exposureShoal(ring: RimRing, transmission: number): ExposureShoal {
  return { ring, transmission, ...ringBox(ring) };
}
/**
 * Shoals are counted out to this far. A shoal is small next to an atoll's rim, and swell bends back in behind it within
 * a few of its widths, so a far one hardly shelters (it also keeps the tracing quick: there are thousands).
 */
const SHOAL_REACH_KM = 10;

type Vec = [number, number];
/** One edge of an atoll outline. */
type Segment = { from: Vec; to: Vec; wayId: string };
/**
 * Islands are not traced along the rays but by the arc of the horizon each one fills, in steps this fine, so an island
 * narrower than the STEP_DEG between two rays still casts its shadow, in proportion to how much of the sky it covers.
 */
const ARC_STEP_DEG = 0.5;
const ARCS = 360 / ARC_STEP_DEG;
const ARCS_PER_RAY = STEP_DEG / ARC_STEP_DEG;

/**
 * A rim site sits on its own reef, but the pin is never exactly on the coarse outline: a pin set by hand as a channel
 * can sit up to CHANNEL_RIM_REACH_KM off it. So crossings of the site's own outline are skipped out to its distance
 * from that outline plus RIM_NEAR_KM (the slack any rim pin has), never past CHANNEL_RIM_REACH_KM. Every other
 * atoll's reef always counts, however close: a strait wall or pass is often nearer the neighbour's outline than its own.
 */
export function siteExposure(
  site: ExposureSite,
  rings: readonly ExposureRing[],
  openings: readonly GapOpening[],
  islands: readonly ExposureIsland[] = [],
  shoals: readonly ExposureShoal[] = [],
): SiteExposure {
  const reachLat = RAY_KM / KM_PER_DEG_LAT + 0.1;
  const shoalLat = SHOAL_REACH_KM / KM_PER_DEG_LAT;
  const shoalLon = SHOAL_REACH_KM / (KM_PER_DEG_LON * Math.cos((site.lat * Math.PI) / 180));
  const project = (lat: number, lon: number): Vec => [
    (lon - site.lon) * KM_PER_DEG_LON * Math.cos((site.lat * Math.PI) / 180),
    (lat - site.lat) * KM_PER_DEG_LAT,
  ];
  const segments: Segment[] = [];
  let ownSkipKm = 0;
  for (const { wayId, ring } of rings) {
    if (!ring.some(([lat, lon]) => Math.abs(lat - site.lat) < reachLat && Math.abs(lon - site.lon) < reachLat)) continue;
    if (wayId === site.ownWayId && site.kind !== "lagoon") {
      ownSkipKm = Math.min(CHANNEL_RIM_REACH_KM, rimEdgeKm(site, ring) + RIM_NEAR_KM);
    }
    const points = ring.map(([lat, lon]) => project(lat, lon));
    for (let index = 0; index + 1 < points.length; index += 1) {
      segments.push({ from: points[index], to: points[index + 1], wayId });
    }
  }
  const shadows = horizonShadows(
    islands
      .filter(({ ring }) => ring.some(([lat, lon]) => Math.abs(lat - site.lat) < reachLat && Math.abs(lon - site.lon) < reachLat))
      .map(({ ring, wooded }) => ({ points: ring.map(([lat, lon]) => project(lat, lon)), wooded })),
    shoals
      .filter(
        (shoal) =>
          shoal.north > site.lat - shoalLat &&
          shoal.south < site.lat + shoalLat &&
          shoal.east > site.lon - shoalLon &&
          shoal.west < site.lon + shoalLon,
      )
      .map(({ ring, transmission }) => ({ points: ring.map(([lat, lon]) => project(lat, lon)), transmission })),
  );
  const byRay = segmentsByRay(segments);
  const gaps = openings
    .map((opening) => ({ at: project(opening.lat, opening.lon), opening }))
    .filter(({ at }) => Math.hypot(at[0], at[1]) < RAY_KM + 2);

  const raySwell: number[] = [];
  const rayWind: number[] = [];
  const fetchKm: (number | null)[] = [];
  for (let index = 0; index < DIRECTIONS; index += 1) {
    const ray = traceRay(index * STEP_DEG, site, byRay[index], gaps, ownSkipKm);
    const shaded = ray.lee ? ray : withShadows(ray, index, shadows, ownSkipKm);
    raySwell.push(shaded.swell);
    rayWind.push(shaded.wind);
    fetchKm.push(shaded.fetchKm == null ? null : Math.round(shaded.fetchKm * 100) / 100);
  }
  return { swell: spread(raySwell), wind: spread(rayWind), rayWind: rayWind.map((share) => Math.round(share * 100) / 100), fetchKm };
}

/**
 * The segments each ray can cross: those whose ends, seen from the site, lie either side of the ray's bearing. With
 * long outlines nearby, this keeps each ray to the few edges it might hit.
 */
function segmentsByRay(segments: readonly Segment[]): Segment[][] {
  const byRay: Segment[][] = Array.from({ length: DIRECTIONS }, () => []);
  for (const segment of segments) {
    if (Math.hypot(...segment.from) > RAY_KM + 1 && Math.hypot(...segment.to) > RAY_KM + 1) continue;
    let low = bearingOf(segment.from);
    let span = bearingOf(segment.to) - low;
    if (span > 180) span -= 360;
    if (span < -180) span += 360;
    if (span < 0) {
      low += span;
      span = -span;
    }
    // A segment through the site itself spans 180°; any ray may touch it.
    const first = Math.ceil(low / STEP_DEG - 1e-9);
    const last = Math.floor((low + span) / STEP_DEG + 1e-9);
    for (let step = first; step <= last; step += 1) byRay[((step % DIRECTIONS) + DIRECTIONS) % DIRECTIONS].push(segment);
  }
  return byRay;
}

/** The table's share for seas from `fromDeg`, between its entries (evenly spaced round the compass, 0 = from north). */
export function exposureAt(table: readonly number[], fromDeg: number): number {
  const position = ((((fromDeg % 360) + 360) % 360) / (360 / table.length)) % table.length;
  const low = Math.floor(position);
  const high = (low + 1) % table.length;
  const share = position - low;
  return table[low] * (1 - share) + table[high] * share;
}

function traceRay(
  towardDeg: number,
  site: ExposureSite,
  segments: readonly Segment[],
  gaps: readonly { at: Vec; opening: GapOpening }[],
  ownSkipKm: number,
): { swell: number; wind: number; fetchKm: number | null; lee: boolean } {
  if (site.kind === "wall" && site.inwardBearingDeg != null && angleBetween(towardDeg, site.inwardBearingDeg) < 90) {
    // The lagoon side of a wall: the wall's own reef and island are between the sea and the dive.
    return {
      swell: REEF_TRANSMISSION,
      wind: Math.max(REEF_TRANSMISSION, fetchShare(OWN_LEE_FETCH_KM)),
      fetchKm: OWN_LEE_FETCH_KM,
      lee: true,
    };
  }
  const radians = (towardDeg * Math.PI) / 180;
  const direction: Vec = [Math.sin(radians), Math.cos(radians)];
  const hits = segments
    .flatMap((segment) => {
      const km = crossingKm(direction, segment.from, segment.to);
      if (km == null || km > RAY_KM) return [];
      if (segment.wayId === site.ownWayId && km <= ownSkipKm) return [];
      return [{ km, wayId: segment.wayId }];
    })
    .sort((a, b) => a.km - b.km);
  if (hits.length === 0) return { swell: 1, wind: 1, fetchKm: null, lee: false };

  let swell = 1;
  for (const { km, wayId } of hits) {
    const point: Vec = [direction[0] * km, direction[1] * km];
    // Only a mouth in the outline this crossing is on: a neighbouring atoll's gap nearby is not a way through this reef.
    const gap = gaps.find(
      ({ at, opening }) =>
        opening.wayId === wayId && Math.hypot(at[0] - point[0], at[1] - point[1]) <= opening.widthM / 2000 + GAP_SLACK_KM,
    );
    if (!gap) {
      swell *= REEF_TRANSMISSION;
      continue;
    }
    const widthKm = gap.opening.widthM / 1000;
    swell *= (gap.opening.reefFlatBridges ? BRIDGED_GAP : 1) * Math.min(1, Math.sqrt((GAP_SPREAD_WIDTHS * widthKm) / km));
  }
  // The open water the wind has to raise chop over, up to the first reef.
  const fetchKm = hits[0].km;
  return { swell, wind: Math.max(swell, fetchShare(fetchKm)), fetchKm, lee: false };
}

/** A share of one arc that a wooded island fills, and its shore along the arc's bearing, km. */
type Shore = { share: number; km: number };

/**
 * Round the horizon in ARC_STEP_DEG arcs: how much of each arc land fills (0 to 1); and for wooded islands, the
 * shores across each arc, nearest first, each with the share of the arc it fills that no nearer shore already does
 * (the shares sum to at most 1). Arcs with no wooded island have no entry.
 */
type Shadows = { land: Float32Array; shores: Map<number, Shore[]>; shoals: Map<number, ShoalCrossing[]> };

/** A shoal across part of one arc: the share of the swell that arc keeps past it, and how far off it starts, km. */
type ShoalCrossing = { keeps: number; km: number };

/**
 * The arcs an outline spans seen from the site (in ARC_STEP_DEG units, `from` to `to`; it may straddle north), or null
 * when it is out of reach or winds right round the site, which then sits on it.
 */
function arcSpan(points: readonly Vec[], reachKm: number): { from: number; to: number } | null {
  let nearKm = Number.POSITIVE_INFINITY;
  for (let index = 0; index + 1 < points.length; index += 1) nearKm = Math.min(nearKm, distanceToSegment(points[index], points[index + 1]));
  if (nearKm > reachKm) return null;
  const start = bearingOf(points[0]);
  let turned = 0;
  let low = 0;
  let high = 0;
  for (let index = 1; index < points.length; index += 1) {
    let step = bearingOf(points[index]) - bearingOf(points[index - 1]);
    if (step > 180) step -= 360;
    if (step < -180) step += 360;
    turned += step;
    low = Math.min(low, turned);
    high = Math.max(high, turned);
  }
  if (Math.abs(turned) > 180) return null;
  return { from: (start + low) / ARC_STEP_DEG, to: (start + high) / ARC_STEP_DEG };
}

/**
 * Each arc an outline covers, with the share of it covered and, along the middle of that covered part (as a reef's
 * distance is read along its ray), how far off the outline's near edge is (Infinity if the bearing misses it).
 */
function* coveredArcs(points: readonly Vec[], { from, to }: { from: number; to: number }) {
  for (let arc = Math.floor(from); arc < Math.ceil(to); arc += 1) {
    const covered = Math.min(to, arc + 1) - Math.max(from, arc);
    const radians = (((Math.max(from, arc) + Math.min(to, arc + 1)) / 2) * ARC_STEP_DEG * Math.PI) / 180;
    const direction: Vec = [Math.sin(radians), Math.cos(radians)];
    let edgeKm = Number.POSITIVE_INFINITY;
    for (let index = 0; index + 1 < points.length; index += 1) {
      const km = crossingKm(direction, points[index], points[index + 1]);
      if (km != null) edgeKm = Math.min(edgeKm, km);
    }
    yield { at: ((arc % ARCS) + ARCS) % ARCS, covered, edgeKm };
  }
}

/** What islands and shoals cast across the horizon, arc by arc. */
function horizonShadows(
  islands: readonly { points: Vec[]; wooded: boolean }[],
  shoalOutlines: readonly { points: Vec[]; transmission: number }[],
): Shadows {
  const land = new Float32Array(ARCS);
  const found = new Map<number, Shore[]>();
  for (const { points, wooded: trees } of islands) {
    // A site or cell is never on land, so an outline that winds round it is skipped.
    const span = arcSpan(points, RAY_KM);
    if (!span) continue;
    for (const { at, covered, edgeKm } of coveredArcs(points, span)) {
      land[at] = Math.max(land[at], covered);
      if (trees && edgeKm !== Number.POSITIVE_INFINITY) pushAt(found, at, { share: covered, km: edgeKm });
    }
  }
  // A shoal the site sits on is skipped too: its swell is what crossed the shoals round it.
  const shoals = new Map<number, ShoalCrossing[]>();
  for (const { points, transmission } of shoalOutlines) {
    const span = arcSpan(points, SHOAL_REACH_KM);
    if (!span) continue;
    for (const { at, covered, edgeKm } of coveredArcs(points, span)) {
      if (edgeKm !== Number.POSITIVE_INFINITY) pushAt(shoals, at, { keeps: 1 - covered * (1 - transmission), km: edgeKm });
    }
  }
  // Nearest shore first; a farther one only adds the part of the arc the nearer ones leave open.
  const shores = new Map<number, Shore[]>();
  for (const [at, list] of found) {
    let filled = 0;
    const kept: Shore[] = [];
    for (const { share, km } of list.sort((a, b) => a.km - b.km)) {
      const adds = Math.min(share, 1 - filled);
      if (adds <= 0) break;
      kept.push({ share: adds, km });
      filled += adds;
    }
    shores.set(at, kept);
  }
  return { land, shores, shoals };
}

function pushAt<T>(lists: Map<number, T[]>, at: number, item: T): void {
  const list = lists.get(at);
  if (list) list.push(item);
  else lists.set(at, [item]);
}

/**
 * A ray's reef-only exposure with the islands and shoals across its STEP_DEG of horizon. Land stops swell outright, so the swell
 * keeps only the share of the ray's arcs that no island fills. A wooded island ends the wind's fetch WIND_SHADOW_KM
 * short of its shore, if that is nearer than the reef; bare sand islands block swell but not the wind. The ray's fetch
 * is the shortest of its arcs' (as a grid bin keeps the shortest of its rays'), so a lee on any arc is kept; the wind
 * share counts each part of an arc at its own shore's fetch, and the rest of the arc at the reef's. Each shoal in front
 * of the reef cuts the swell on the arcs it covers; the wind blows on over it, so the wind share keeps the floor of
 * the swell past land alone. Shoals behind the reef are left out, the reef having already cut that swell. So are
 * shoals within `ownReefKm` of a rim site (pass or wall): there the reef the pass cuts through, or the wall stands on,
 * runs on inside the outline, and it is the site's own reef, as its rim is. (A wall's lagoon-side rays are its own reef's lee and never get here.)
 */
function withShadows(
  ray: { swell: number; wind: number; fetchKm: number | null },
  index: number,
  { land, shores, shoals }: Shadows,
  ownReefKm = 0,
): { swell: number; wind: number; fetchKm: number | null } {
  let open = 0;
  let pastLand = 0;
  let windSum = 0;
  let fetchKm = ray.fetchKm;
  const reefWind = ray.fetchKm == null ? 1 : fetchShare(ray.fetchKm);
  for (let offset = -ARCS_PER_RAY / 2; offset < ARCS_PER_RAY / 2; offset += 1) {
    const at = (((index * ARCS_PER_RAY + offset) % ARCS) + ARCS) % ARCS;
    let keeps = 1 - land[at];
    pastLand += keeps;
    for (const shoal of shoals.get(at) ?? []) {
      if (shoal.km > ownReefKm && (ray.fetchKm == null || shoal.km < ray.fetchKm)) keeps *= shoal.keeps;
    }
    open += keeps;
    let calmed = 0;
    let arcWind = 0;
    for (const shore of shores.get(at) ?? []) {
      const island = Math.max(0, shore.km - WIND_SHADOW_KM);
      if (ray.fetchKm != null && island >= ray.fetchKm) continue;
      calmed += shore.share;
      arcWind += shore.share * fetchShare(island);
      fetchKm = fetchKm == null ? island : Math.min(fetchKm, island);
    }
    windSum += arcWind + (1 - calmed) * reefWind;
  }
  const swell = ray.swell * (open / ARCS_PER_RAY);
  return { swell, wind: Math.max(ray.swell * (pastLand / ARCS_PER_RAY), windSum / ARCS_PER_RAY), fetchKm };
}

function bearingOf([x, y]: Vec): number {
  return (((Math.atan2(x, y) * 180) / Math.PI) % 360 + 360) % 360;
}

/** Km from the origin to the nearest point of the segment. */
function distanceToSegment(from: Vec, to: Vec): number {
  const edge: Vec = [to[0] - from[0], to[1] - from[1]];
  const length = edge[0] ** 2 + edge[1] ** 2;
  const along = length === 0 ? 0 : Math.max(0, Math.min(1, -(from[0] * edge[0] + from[1] * edge[1]) / length));
  return Math.hypot(from[0] + along * edge[0], from[1] + along * edge[1]);
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

/** Smallest angle between two compass directions, 0 to 180. */
export function angleBetween(a: number, b: number): number {
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
  const centre = ringCentre(ring);
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

/** The mean of an outline's points: the atoll's middle, where its one wind sample is taken. */
export function ringCentre(ring: RimRing): { lat: number; lon: number } {
  const open = ring.slice(0, -1);
  return {
    lat: open.reduce((sum, point) => sum + point[0], 0) / open.length,
    lon: open.reduce((sum, point) => sum + point[1], 0) / open.length,
  };
}

/** A position snapped to the wave model's grid, so nearby samples share one cache file. */
export function snapToWaveGrid(point: { lat: number; lon: number }): { lat: number; lon: number } {
  return { lat: snap(point.lat), lon: snap(point.lon) };
}

function snap(degrees: number): number {
  return Math.round(Math.round(degrees / WAVE_GRID_DEG) * WAVE_GRID_DEG * 10000) / 10000;
}
