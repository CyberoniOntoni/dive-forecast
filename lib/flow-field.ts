import { atollRing } from "./atoll-ring";
import { lagoonSinkCells, lagoonVelocity, sinkAt, type LagoonSink, type LagoonSource } from "./lagoon-flow";
import { lagoonSources } from "./load-site";
import type { FetchOptions } from "./marine";
import { allRims, KM_PER_DEG_LAT, KM_PER_DEG_LON, pointInRing, rimForAtoll, rimWayId, ringBox, type RimRing } from "./rim";
import { crossesRim, flowsAlongReef } from "./site-type";
import { readCatalog } from "./store";
import { gapFlows, reefFlows } from "./flow-gaps";
import { readOpenings } from "./openings";
import { readIslands } from "./islands";
import { encodeVectors, KNOTS_PER_MS, lagoonKnots, type FlowAtoll, type FlowFieldView } from "./flow-wire";
import type { Atoll, MarineHour, Site } from "./types";

let seaLand: NonNullable<FlowFieldView["land"]> | null = null;

/**
 * The islands outside every atoll outline, as boxes (four decimals): the open sea's raster stops water there. Islands
 * inside an outline are the atoll raster's business. Made once.
 */
export function openSeaLand(): NonNullable<FlowFieldView["land"]> {
  if (seaLand) return seaLand;
  const rims = [...allRims().values()];
  const round = (value: number) => Math.round(value * 1e4) / 1e4;
  seaLand = readIslands()
    .filter((island) => !rims.some((rim) => pointInRing(island.ring[0][0], island.ring[0][1], rim)))
    .map((island) => {
      const box = ringBox(island.ring);
      return { south: round(box.south), north: round(box.north), west: round(box.west), east: round(box.east) };
    });
  return seaLand;
}

/**
 * At most about this many cells on an atoll's lagoon grid. The lagoon flow is smooth away from its openings, and the
 * map draws the channels' own jets over it, so about 1 km cells on the big atolls are enough.
 */
const LAGOON_CELLS = 1600;
const MIN_STEP_KM = 0.5;

type LagoonGrid = {
  south: number;
  west: number;
  stepLat: number;
  stepLon: number;
  rows: number;
  columns: number;
  points: { lat: number; lon: number }[];
  sinks: LagoonSink[];
};

/** Cell centres and their sinks depend only on the outline, so each outline's are built once per process. */
const gridMemo = new Map<string, LagoonGrid>();

/** The grid over an outline's box, one cell past it on every side, with each cell centre's lagoon sink. */
export function lagoonGrid(rim: RimRing, key?: string): LagoonGrid {
  const kept = key ? gridMemo.get(key) : undefined;
  if (kept) return kept;
  const box = ringBox(rim);
  const kmLon = KM_PER_DEG_LON * Math.cos((((box.south + box.north) / 2) * Math.PI) / 180);
  const boxKm2 = (box.north - box.south) * KM_PER_DEG_LAT * (box.east - box.west) * kmLon;
  const stepKm = Math.max(MIN_STEP_KM, Math.sqrt(boxKm2 / LAGOON_CELLS));
  const stepLat = stepKm / KM_PER_DEG_LAT;
  const stepLon = stepKm / kmLon;
  const south = box.south - stepLat;
  const west = box.west - stepLon;
  const rows = Math.ceil((box.north - box.south) / stepLat) + 2;
  const columns = Math.ceil((box.east - box.west) / stepLon) + 2;
  const points: { lat: number; lon: number }[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      points.push({ lat: south + (row + 0.5) * stepLat, lon: west + (column + 0.5) * stepLon });
    }
  }
  const cells = lagoonSinkCells(rim);
  const sinks = points.map((point) => sinkAt(point, cells));
  const grid = { south, west, stepLat, stepLon, rows, columns, points, sinks };
  if (key) gridMemo.set(key, grid);
  return grid;
}

const round = (value: number, places: number) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

/**
 * The lagoon flow on the grid at `time`, in knots (lagoonKnots on the index's size, its heading kept). Null when
 * any cell has fewer than half the openings for that hour (lagoonVelocity), which is then true of every cell.
 */
export function lagoonFlowGrid(grid: LagoonGrid, sources: readonly LagoonSource[], time: string): FlowAtoll["lagoon"] {
  const east: number[] = [];
  const north: number[] = [];
  for (let index = 0; index < grid.points.length; index += 1) {
    const velocity = lagoonVelocity(grid.points[index], sources, time, grid.sinks[index]);
    if (!velocity) return null;
    const size = Math.hypot(velocity.east, velocity.north);
    const knots = lagoonKnots(size);
    east.push(size > 0 ? (velocity.east / size) * knots : 0);
    north.push(size > 0 ? (velocity.north / size) * knots : 0);
  }
  const { south, west, stepLat, stepLon, rows, columns } = grid;
  return { south, west, stepLat, stepLon, rows, columns, vectors: encodeVectors(east, north) };
}

/** The ocean model's current at `time` at each ring point that has it, in knots. */
export function oceanPoints(
  samples: readonly { seaward: { lat: number; lon: number } }[],
  series: readonly (readonly MarineHour[] | null)[],
  time: string,
): FlowAtoll["ocean"] {
  const points: FlowAtoll["ocean"] = [];
  samples.forEach((sample, index) => {
    const hour = series[index]?.find((item) => item.time === time);
    if (!hour || hour.currentVelocityMs == null || hour.currentDirectionDeg == null) return;
    const knots = hour.currentVelocityMs * KNOTS_PER_MS;
    const radians = (hour.currentDirectionDeg * Math.PI) / 180;
    points.push({
      lat: round(sample.seaward.lat, 5),
      lon: round(sample.seaward.lon, 5),
      east: round(knots * Math.sin(radians), 2),
      north: round(knots * Math.cos(radians), 2),
    });
  });
  return points;
}

/** The atoll's catalog channels (water crosses the rim) and walls (it runs along the reef). */
export function atollRoles(atoll: Atoll, sites: readonly Site[]): Pick<FlowAtoll, "channels" | "walls"> {
  const own = sites.filter((site) => site.atollId === atoll.id);
  return {
    channels: own
      .filter((site) => crossesRim(site, sites))
      .map((site) => ({ id: site.id, widthM: site.channelWidthM ?? site.atlasWidthM ?? null })),
    walls: own.filter((site) => site.siteType === "strait-wall" || flowsAlongReef(site, sites)).map((site) => site.id),
  };
}

/**
 * One outline's flow. Atolls that share an outline (Gaafu Alif and Gaafu Dhaalu round Huvadhu) are one lagoon: the
 * first atoll's openings (its porous rim and channels) with the others' channels added, so the rim is counted once.
 */
async function outlineFlow(atolls: readonly Atoll[], sites: readonly Site[], time: string, options: FetchOptions): Promise<FlowAtoll | null> {
  const [first, ...others] = atolls;
  const rim = rimForAtoll(first);
  if (!rim) return null;
  const wayId = rimWayId(first);
  const [ring, own, ...rest] = await Promise.all([
    atollRing(first, options),
    lagoonSources(first, sites, options),
    ...others.map((atoll) => lagoonSources(atoll, sites, options)),
  ]);
  const roles = atolls.map((atoll) => atollRoles(atoll, sites));
  const sources = [
    ...own,
    ...rest.flatMap((list, index) => {
      const channels = new Set(roles[index + 1].channels.map((channel) => channel.id));
      return list.filter((source) => source.siteId != null && channels.has(source.siteId));
    }),
  ];
  const ocean = oceanPoints(ring.samples, ring.series, time);
  const lagoon = own.length > 0 ? lagoonFlowGrid(lagoonGrid(rim, wayId), sources, time) : null;
  if (!lagoon && ocean.length === 0) return null;
  const channelIds = new Set(roles.flatMap((role) => role.channels.map((channel) => channel.id)));
  const gaps = gapFlows(
    readOpenings().filter((opening) => opening.wayId === wayId),
    rim,
    ring,
    sites.filter((site) => channelIds.has(site.id)),
    time,
  );
  return {
    wayId,
    atollId: first.id,
    box: ringBox(rim),
    lagoon,
    ocean,
    channels: roles.flatMap((role) => role.channels),
    walls: roles.flatMap((role) => role.walls),
    gaps,
    reef: reefFlows(ring, time),
  };
}

/**
 * Everything the map's flow animation needs for one hour, atoll by atoll: the lagoon model's flow on a grid, the
 * ocean current round the outline, and which catalog sites are channels and walls (their own direction and strength
 * come with the map's nowcasts). An atoll whose series are not cached yet is left out ({ wait: false }), as the map's
 * pins are, and joins on a later load.
 */
export async function flowField(time: string, options: FetchOptions = { wait: false }): Promise<FlowFieldView> {
  const catalog = readCatalog();
  const byOutline = new Map<string, Atoll[]>();
  for (const atoll of catalog.atolls) {
    if (!rimForAtoll(atoll)) continue;
    const wayId = rimWayId(atoll);
    byOutline.set(wayId, [...(byOutline.get(wayId) ?? []), atoll]);
  }
  const atolls = await Promise.all(
    [...byOutline.values()].map((group) => outlineFlow(group, catalog.sites, time, options).catch(() => null)),
  );
  const found = atolls.filter((item) => item != null);
  return { time, atolls: found, missing: atolls.length - found.length, land: openSeaLand() };
}
