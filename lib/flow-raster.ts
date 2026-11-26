/**
 * The current-flow animation's field, built in the browser for one atoll at one hour, and the particles that drift
 * through it. Pure code (no DOM, no Leaflet), so tests can drive it.
 *
 * The field is a raster of about 200 m cells over the atoll and a few km of sea round it. Each cell holds a velocity in
 * knots and what is there: open sea, lagoon or land. It is made of, in order:
 *  - inside the outline, the lagoon model's flow (FlowAtoll.lagoon), bilinear between its ~1 km cells;
 *  - outside, the ocean model's surface current, blended from the ring points, and within WALL_BAND_KM of the reef
 *    turned to run along it (the reef stops the part that runs at it), as the along-reef model reads it;
 *  - at each wall site, that site's forecast heading and band speed, fading out over a couple of km;
 *  - at each channel site, a jet along its forecast heading at its band speed: narrow and fast through the pass and
 *    widening, so slowing, as it spreads downstream. Only the jets are gates: a particle crosses the reef nowhere else.
 */
import { decodeVectors, type FlowAtoll } from "./flow-wire";
import type { RimRing } from "./rim";

export const KIND_SEA = 0;
export const KIND_LAGOON = 1;
export const KIND_LAND = 2;

const KM_PER_DEG_LAT = 110.57;
const KM_PER_DEG_LON = 111.32;
/** Sea drawn round the outline. */
export const SEA_MARGIN_KM = 6;
const CELL_KM = 0.2;
/** A raster never has more cells than this; a big atoll gets coarser cells. */
const MAX_CELLS = 160_000;
/** Within this of the reef, outside, the ocean current is turned to run along it. */
export const WALL_BAND_KM = 2.5;
/** The along-reef model's tidal gain is about 3; the drift part has none. A middle value for the map. */
const WALL_GAIN = 1.6;
/** A wall site's own forecast holds over this distance (Gaussian sigma). */
const WALL_SIGMA_KM = 1.4;
/** A channel jet: upstream reach, downstream reach, and its half-width in the gap. */
const JET_UP_KM = 1.2;
const JET_DOWN_KM = 2.6;
const JET_HALF_KM = 0.22;
/** How fast the jet widens downstream, km of half-width per km. */
const JET_SPREAD = 0.45;
/** A cell is a gate in the reef where a jet's weight is at least this. */
const GATE_WEIGHT = 0.3;
/** Channels slower than this feed no particles of their own: slack water has no stream to show. */
const FEED_MIN_KNOTS = 0.4;
/** The share of new particles fed into a channel's stream when one is in view. */
export const FEED_SHARE = 0.3;
/** A fed particle starts this far upstream of the pin (km, from-to) and this far to either side (sigma, km). */
const FEED_UP_KM: readonly [number, number] = [-1.1, 0.2];
const FEED_SIDE_KM = 0.12;

/** A site's forecast arrow on the map: where it is, where the water heads, and how fast (knots). */
export type FlowVector = { lat: number; lon: number; headingDeg: number; knots: number };
export type FlowShapes = { outline: RimRing; islands: readonly RimRing[] };

export type FlowRaster = {
  wayId: string;
  south: number;
  west: number;
  north: number;
  east: number;
  stepLat: number;
  stepLon: number;
  rows: number;
  columns: number;
  /** Knots, row-major from the south-west cell. */
  vEast: Float32Array;
  vNorth: Float32Array;
  kind: Uint8Array;
  gate: Uint8Array;
  /** The channels running at least mild this hour: where particles are fed in, so each channel shows its stream. */
  jets: { lat: number; lon: number; east: number; north: number }[];
};

type Frame = { refLat: number; kmLon: number };

type LagoonGrid = Omit<NonNullable<FlowAtoll["lagoon"]>, "vectors">;

function bilinear(grid: LagoonGrid, values: Float32Array, lat: number, lon: number): number {
  const y = (lat - grid.south) / grid.stepLat - 0.5;
  const x = (lon - grid.west) / grid.stepLon - 0.5;
  const row = Math.max(0, Math.min(grid.rows - 2, Math.floor(y)));
  const column = Math.max(0, Math.min(grid.columns - 2, Math.floor(x)));
  const fy = Math.max(0, Math.min(1, y - row));
  const fx = Math.max(0, Math.min(1, x - column));
  const at = (r: number, c: number) => values[r * grid.columns + c] ?? 0;
  const low = at(row, column) * (1 - fx) + at(row, column + 1) * fx;
  const high = at(row + 1, column) * (1 - fx) + at(row + 1, column + 1) * fx;
  return low * (1 - fy) + high * fy;
}

/** Marks the cells whose centres a ring encloses, row by row (even-odd crossings). */
function fillRing(raster: FlowRaster, ring: RimRing, value: number): void {
  const { south, west, stepLat, stepLon, rows, columns, kind } = raster;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lat] of ring) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  const firstRow = Math.max(0, Math.floor((minLat - south) / stepLat - 0.5));
  const lastRow = Math.min(rows - 1, Math.ceil((maxLat - south) / stepLat - 0.5));
  const crossings: number[] = [];
  for (let row = firstRow; row <= lastRow; row += 1) {
    const lat = south + (row + 0.5) * stepLat;
    crossings.length = 0;
    for (let index = 0; index + 1 < ring.length; index += 1) {
      const [lat1, lon1] = ring[index];
      const [lat2, lon2] = ring[index + 1];
      if (lat1 > lat !== lat2 > lat) crossings.push(lon1 + ((lon2 - lon1) * (lat - lat1)) / (lat2 - lat1));
    }
    crossings.sort((a, b) => a - b);
    for (let pair = 0; pair + 1 < crossings.length; pair += 2) {
      const from = Math.max(0, Math.ceil((crossings[pair] - west) / stepLon - 0.5));
      const to = Math.min(columns - 1, Math.floor((crossings[pair + 1] - west) / stepLon - 0.5));
      for (let column = from; column <= to; column += 1) kind[row * columns + column] = value;
    }
  }
}

/**
 * Distance (km) from each cell within `bandKm` of the ring to its nearest segment, and that segment's direction as a
 * unit east/north vector. Cells farther away keep Infinity.
 */
function reefBand(raster: FlowRaster, ring: RimRing, bandKm: number, frame: Frame) {
  const { south, west, stepLat, stepLon, rows, columns } = raster;
  const size = rows * columns;
  const distance = new Float32Array(size).fill(Infinity);
  const tangentEast = new Float32Array(size);
  const tangentNorth = new Float32Array(size);
  const padLat = bandKm / KM_PER_DEG_LAT;
  const padLon = bandKm / frame.kmLon;
  for (let index = 0; index + 1 < ring.length; index += 1) {
    const [lat1, lon1] = ring[index];
    const [lat2, lon2] = ring[index + 1];
    const ax = (lon2 - lon1) * frame.kmLon;
    const ay = (lat2 - lat1) * KM_PER_DEG_LAT;
    const length2 = ax * ax + ay * ay;
    if (!(length2 > 0)) continue;
    const length = Math.sqrt(length2);
    const rowFrom = Math.max(0, Math.floor((Math.min(lat1, lat2) - padLat - south) / stepLat));
    const rowTo = Math.min(rows - 1, Math.ceil((Math.max(lat1, lat2) + padLat - south) / stepLat));
    const columnFrom = Math.max(0, Math.floor((Math.min(lon1, lon2) - padLon - west) / stepLon));
    const columnTo = Math.min(columns - 1, Math.ceil((Math.max(lon1, lon2) + padLon - west) / stepLon));
    for (let row = rowFrom; row <= rowTo; row += 1) {
      const py = (south + (row + 0.5) * stepLat - lat1) * KM_PER_DEG_LAT;
      for (let column = columnFrom; column <= columnTo; column += 1) {
        const px = (west + (column + 0.5) * stepLon - lon1) * frame.kmLon;
        const share = Math.max(0, Math.min(1, (px * ax + py * ay) / length2));
        const d = Math.hypot(px - share * ax, py - share * ay);
        const cell = row * columns + column;
        if (d >= distance[cell] || d > bandKm) continue;
        distance[cell] = d;
        tangentEast[cell] = ax / length;
        tangentNorth[cell] = ay / length;
      }
    }
  }
  return { distance, tangentEast, tangentNorth };
}

const smooth = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

/** The ocean current at a point: inverse-distance-squared blend of the ring points. */
function oceanAt(ocean: FlowAtoll["ocean"], lat: number, lon: number, frame: Frame): [number, number] {
  let east = 0;
  let north = 0;
  let total = 0;
  for (const point of ocean) {
    const dx = (lon - point.lon) * frame.kmLon;
    const dy = (lat - point.lat) * KM_PER_DEG_LAT;
    const weight = 1 / (dx * dx + dy * dy + 4);
    east += point.east * weight;
    north += point.north * weight;
    total += weight;
  }
  return total > 0 ? [east / total, north / total] : [0, 0];
}

/** Adds weighted vectors into running sums over a box of cells round a point. */
function forCellsNear(
  raster: FlowRaster,
  lat: number,
  lon: number,
  reachKm: number,
  frame: Frame,
  visit: (cell: number, dxKm: number, dyKm: number) => void,
): void {
  const { south, west, stepLat, stepLon, rows, columns } = raster;
  const rowFrom = Math.max(0, Math.floor((lat - reachKm / KM_PER_DEG_LAT - south) / stepLat));
  const rowTo = Math.min(rows - 1, Math.ceil((lat + reachKm / KM_PER_DEG_LAT - south) / stepLat));
  const columnFrom = Math.max(0, Math.floor((lon - reachKm / frame.kmLon - west) / stepLon));
  const columnTo = Math.min(columns - 1, Math.ceil((lon + reachKm / frame.kmLon - west) / stepLon));
  for (let row = rowFrom; row <= rowTo; row += 1) {
    const dy = (south + (row + 0.5) * stepLat - lat) * KM_PER_DEG_LAT;
    for (let column = columnFrom; column <= columnTo; column += 1) {
      visit(row * columns + column, (west + (column + 0.5) * stepLon - lon) * frame.kmLon, dy);
    }
  }
}

/** Builds one atoll's raster for one hour. `channels` and `walls` are the sites' forecast arrows this hour. */
export function buildFlowRaster(
  atoll: FlowAtoll,
  shapes: FlowShapes,
  channels: readonly FlowVector[],
  walls: readonly FlowVector[],
): FlowRaster {
  const outline = shapes.outline;
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const [lat, lon] of outline) {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lon);
    east = Math.max(east, lon);
  }
  const refLat = (south + north) / 2;
  const frame: Frame = { refLat, kmLon: KM_PER_DEG_LON * Math.cos((refLat * Math.PI) / 180) };
  south -= SEA_MARGIN_KM / KM_PER_DEG_LAT;
  north += SEA_MARGIN_KM / KM_PER_DEG_LAT;
  west -= SEA_MARGIN_KM / frame.kmLon;
  east += SEA_MARGIN_KM / frame.kmLon;
  const areaKm2 = (north - south) * KM_PER_DEG_LAT * (east - west) * frame.kmLon;
  const cellKm = Math.max(CELL_KM, Math.sqrt(areaKm2 / MAX_CELLS));
  const stepLat = cellKm / KM_PER_DEG_LAT;
  const stepLon = cellKm / frame.kmLon;
  const rows = Math.max(1, Math.ceil((north - south) / stepLat));
  const columns = Math.max(1, Math.ceil((east - west) / stepLon));
  const size = rows * columns;
  const raster: FlowRaster = {
    wayId: atoll.wayId,
    south,
    west,
    north: south + rows * stepLat,
    east: west + columns * stepLon,
    stepLat,
    stepLon,
    rows,
    columns,
    vEast: new Float32Array(size),
    vNorth: new Float32Array(size),
    kind: new Uint8Array(size),
    gate: new Uint8Array(size),
    jets: channels
      .filter((site) => site.knots >= FEED_MIN_KNOTS)
      .map((site) => ({
        lat: site.lat,
        lon: site.lon,
        east: Math.sin((site.headingDeg * Math.PI) / 180),
        north: Math.cos((site.headingDeg * Math.PI) / 180),
      })),
  };
  fillRing(raster, outline, KIND_LAGOON);
  for (const island of shapes.islands) fillRing(raster, island, KIND_LAND);
  const band = reefBand(raster, outline, WALL_BAND_KM, frame);
  const lagoon = atoll.lagoon ? { grid: atoll.lagoon, ...decodeVectors(atoll.lagoon.vectors) } : null;

  for (let row = 0; row < rows; row += 1) {
    const lat = south + (row + 0.5) * stepLat;
    for (let column = 0; column < columns; column += 1) {
      const cell = row * columns + column;
      const lon = west + (column + 0.5) * stepLon;
      const kind = raster.kind[cell];
      if (kind === KIND_LAND) continue;
      if (kind === KIND_LAGOON) {
        if (!lagoon) continue;
        raster.vEast[cell] = bilinear(lagoon.grid, lagoon.east, lat, lon);
        raster.vNorth[cell] = bilinear(lagoon.grid, lagoon.north, lat, lon);
        continue;
      }
      let [ve, vn] = oceanAt(atoll.ocean, lat, lon, frame);
      const d = band.distance[cell];
      if (d <= WALL_BAND_KM) {
        // Near the reef the water cannot run at it, so the current turns to run along it, faster for the wall.
        const te = band.tangentEast[cell];
        const tn = band.tangentNorth[cell];
        const along = (ve * te + vn * tn) * WALL_GAIN;
        const share = 1 - smooth(d / WALL_BAND_KM);
        ve = ve * (1 - share) + along * te * share;
        vn = vn * (1 - share) + along * tn * share;
      }
      raster.vEast[cell] = ve;
      raster.vNorth[cell] = vn;
    }
  }

  // Wall sites: their own forecast along the reef, outside only.
  const wallSum = blendSites(raster, walls, frame, 3 * WALL_SIGMA_KM, (dx, dy) => Math.exp(-(dx * dx + dy * dy) / (2 * WALL_SIGMA_KM ** 2)), true);
  applyBlend(raster, wallSum, false);

  // Channel jets, on both sides of the reef: they are what joins the lagoon to the sea.
  const jetSum = blendSites(raster, channels, frame, JET_DOWN_KM, jetWeight, false);
  applyBlend(raster, jetSum, true);
  return raster;
}

/**
 * A jet's weight at a cell, from its offset along (downstream positive) and across the heading, and how much the
 * jet's own speed is cut there: the same water through a wider section runs slower.
 */
function jetWeight(along: number, across: number): number {
  if (along < -JET_UP_KM || along > JET_DOWN_KM) return 0;
  const half = JET_HALF_KM + Math.max(0, along) * JET_SPREAD + Math.max(0, -along) * JET_SPREAD * 0.6;
  const ends = along < 0 ? 1 - smooth(-along / JET_UP_KM) : 1 - smooth(along / JET_DOWN_KM);
  return Math.exp(-((across / half) ** 2)) * ends;
}

function jetSlowdown(along: number): number {
  const half = JET_HALF_KM + Math.abs(along) * JET_SPREAD * (along < 0 ? 0.6 : 1);
  return Math.sqrt(JET_HALF_KM / half);
}

type Blend = { weight: Float32Array; east: Float32Array; north: Float32Array };

function blendSites(
  raster: FlowRaster,
  sites: readonly FlowVector[],
  frame: Frame,
  reachKm: number,
  weightAt: (along: number, across: number) => number,
  seaOnly: boolean,
): Blend {
  const size = raster.rows * raster.columns;
  const blend: Blend = { weight: new Float32Array(size), east: new Float32Array(size), north: new Float32Array(size) };
  for (const site of sites) {
    if (site.lat < raster.south || site.lat > raster.north || site.lon < raster.west || site.lon > raster.east) continue;
    const radians = (site.headingDeg * Math.PI) / 180;
    const he = Math.sin(radians);
    const hn = Math.cos(radians);
    const isJet = !seaOnly;
    forCellsNear(raster, site.lat, site.lon, reachKm, frame, (cell, dx, dy) => {
      if (raster.kind[cell] === KIND_LAND) return;
      if (seaOnly && raster.kind[cell] !== KIND_SEA) return;
      // A wall's weight is round; a jet's runs along its heading.
      const along = isJet ? dx * he + dy * hn : dx;
      const across = isJet ? -dx * hn + dy * he : dy;
      const weight = weightAt(along, across);
      if (weight < 0.01) return;
      const knots = site.knots * (isJet ? jetSlowdown(along) : 1);
      blend.weight[cell] += weight;
      blend.east[cell] += weight * knots * he;
      blend.north[cell] += weight * knots * hn;
    });
  }
  return blend;
}

function applyBlend(raster: FlowRaster, blend: Blend, gates: boolean): void {
  for (let cell = 0; cell < blend.weight.length; cell += 1) {
    const total = blend.weight[cell];
    if (total <= 0) continue;
    const share = Math.min(1, total);
    raster.vEast[cell] = raster.vEast[cell] * (1 - share) + (blend.east[cell] / total) * share;
    raster.vNorth[cell] = raster.vNorth[cell] * (1 - share) + (blend.north[cell] / total) * share;
    if (gates && share >= GATE_WEIGHT) raster.gate[cell] = 1;
  }
}

/** The cell index at a point, or -1 off the raster. */
export function cellAt(raster: FlowRaster, lat: number, lon: number): number {
  const row = Math.floor((lat - raster.south) / raster.stepLat);
  const column = Math.floor((lon - raster.west) / raster.stepLon);
  if (row < 0 || row >= raster.rows || column < 0 || column >= raster.columns) return -1;
  return row * raster.columns + column;
}

/** Bilinear velocity (knots) at a point into `out` [east, north]; false off the raster. */
export function velocityAt(raster: FlowRaster, lat: number, lon: number, out: Float64Array | number[]): boolean {
  const y = (lat - raster.south) / raster.stepLat - 0.5;
  const x = (lon - raster.west) / raster.stepLon - 0.5;
  if (y < -0.5 || x < -0.5 || y > raster.rows - 0.5 || x > raster.columns - 0.5) return false;
  const row = Math.max(0, Math.min(raster.rows - 2, Math.floor(y)));
  const column = Math.max(0, Math.min(raster.columns - 2, Math.floor(x)));
  const fy = Math.max(0, Math.min(1, y - row));
  const fx = Math.max(0, Math.min(1, x - column));
  const c00 = row * raster.columns + column;
  const c01 = c00 + 1;
  const c10 = c00 + raster.columns;
  const c11 = c10 + 1;
  const mix = (values: Float32Array) =>
    (values[c00] * (1 - fx) + values[c01] * fx) * (1 - fy) + (values[c10] * (1 - fx) + values[c11] * fx) * fy;
  out[0] = mix(raster.vEast);
  out[1] = mix(raster.vNorth);
  return true;
}

/**
 * Particles drifting through a set of rasters. Positions are lat/lon; each keeps a short trail of past positions.
 * A particle is reborn somewhere new when it runs out of life, leaves every raster, lands on an island, or would cross
 * the reef anywhere but a channel's gate.
 */
export class FlowParticles {
  readonly count: number;
  readonly trail: number;
  readonly lat: Float64Array;
  readonly lon: Float64Array;
  readonly speed: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  /** Trail ring buffers: trail positions per particle, newest at `head`. `filled` is how many are set. */
  readonly trailLat: Float64Array;
  readonly trailLon: Float64Array;
  readonly head: Uint16Array;
  readonly filled: Uint16Array;
  private readonly rasterOf: Int16Array;
  private readonly velocity = new Float64Array(2);

  constructor(count: number, trail: number, private readonly random: () => number = Math.random) {
    this.count = count;
    this.trail = trail;
    this.lat = new Float64Array(count);
    this.lon = new Float64Array(count);
    this.speed = new Float32Array(count);
    this.age = new Float32Array(count);
    this.life = new Float32Array(count);
    this.trailLat = new Float64Array(count * trail);
    this.trailLon = new Float64Array(count * trail);
    this.head = new Uint16Array(count);
    this.filled = new Uint16Array(count);
    this.rasterOf = new Int16Array(count).fill(-1);
  }

  /**
   * Places particle `index` at a random water point of the view on some raster: up to a few tries, after which it
   * waits (no raster) and tries again next step.
   */
  spawn(index: number, rasters: readonly FlowRaster[], view: { south: number; west: number; north: number; east: number }): void {
    this.filled[index] = 0;
    this.age[index] = 0;
    this.life[index] = 2 + this.random() * 5;
    this.rasterOf[index] = -1;
    if (this.random() < FEED_SHARE && this.feed(index, rasters, view)) return;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const lat = view.south + this.random() * (view.north - view.south);
      const lon = view.west + this.random() * (view.east - view.west);
      for (let at = 0; at < rasters.length; at += 1) {
        const cell = cellAt(rasters[at], lat, lon);
        if (cell < 0 || rasters[at].kind[cell] === KIND_LAND) continue;
        this.lat[index] = lat;
        this.lon[index] = lon;
        this.rasterOf[index] = at;
        this.pushTrail(index);
        return;
      }
    }
  }

  /** Places particle `index` upstream of a random channel in view; false when no channel is. */
  private feed(index: number, rasters: readonly FlowRaster[], view: { south: number; west: number; north: number; east: number }): boolean {
    const inView = (jet: { lat: number; lon: number }) =>
      jet.lat >= view.south && jet.lat <= view.north && jet.lon >= view.west && jet.lon <= view.east;
    let total = 0;
    for (const raster of rasters) for (const jet of raster.jets) if (inView(jet)) total += 1;
    if (total === 0) return false;
    let pick = Math.floor(this.random() * total);
    for (let at = 0; at < rasters.length; at += 1) {
      for (const jet of rasters[at].jets) {
        if (!inView(jet) || pick-- > 0) continue;
        const along = FEED_UP_KM[0] + this.random() * (FEED_UP_KM[1] - FEED_UP_KM[0]);
        // Roughly normal across the stream: the mean of three uniforms.
        const across = ((this.random() + this.random() + this.random()) / 1.5 - 1) * FEED_SIDE_KM * 1.7;
        const kmLon = KM_PER_DEG_LON * Math.cos((jet.lat * Math.PI) / 180);
        const lat = jet.lat + (along * jet.north + across * jet.east) / KM_PER_DEG_LAT;
        const lon = jet.lon + (along * jet.east - across * jet.north) / kmLon;
        const cell = cellAt(rasters[at], lat, lon);
        if (cell < 0 || rasters[at].kind[cell] === KIND_LAND) return false;
        this.lat[index] = lat;
        this.lon[index] = lon;
        this.rasterOf[index] = at;
        this.pushTrail(index);
        return true;
      }
    }
    return false;
  }

  private pushTrail(index: number): void {
    const head = (this.head[index] + 1) % this.trail;
    this.head[index] = head;
    this.trailLat[index * this.trail + head] = this.lat[index];
    this.trailLon[index * this.trail + head] = this.lon[index];
    if (this.filled[index] < this.trail) this.filled[index] += 1;
  }

  /** Forgets every trail (after the map jumps), keeping the particles where they are. */
  clearTrails(): void {
    for (let index = 0; index < this.count; index += 1) {
      this.filled[index] = 0;
      if (this.rasterOf[index] >= 0) this.pushTrail(index);
    }
  }

  /** Forgets every particle's raster, so each is placed again (after the rasters change). */
  reset(): void {
    this.rasterOf.fill(-1);
    this.filled.fill(0);
  }

  /**
   * Moves every particle `seconds` on: `degPerKnotSecond` turns knots into degrees of latitude per second on screen
   * (the animation runs much faster than the water), longitude scaled for the latitude. `record` adds the new position
   * to the trail.
   */
  step(
    seconds: number,
    rasters: readonly FlowRaster[],
    view: { south: number; west: number; north: number; east: number },
    degPerKnotSecond: number,
    record: boolean,
  ): void {
    const lonScale = 1 / Math.cos((((view.south + view.north) / 2) * Math.PI) / 180);
    for (let index = 0; index < this.count; index += 1) {
      const at = this.rasterOf[index];
      this.age[index] += seconds;
      if (at < 0 || at >= rasters.length || this.age[index] > this.life[index]) {
        this.spawn(index, rasters, view);
        continue;
      }
      const raster = rasters[at];
      const lat = this.lat[index];
      const lon = this.lon[index];
      if (!velocityAt(raster, lat, lon, this.velocity)) {
        this.spawn(index, rasters, view);
        continue;
      }
      const ve = this.velocity[0];
      const vn = this.velocity[1];
      this.speed[index] = Math.hypot(ve, vn);
      const nextLat = lat + vn * degPerKnotSecond * seconds;
      const nextLon = lon + ve * degPerKnotSecond * lonScale * seconds;
      const from = cellAt(raster, lat, lon);
      const to = cellAt(raster, nextLat, nextLon);
      if (to < 0 || raster.kind[to] === KIND_LAND) {
        this.spawn(index, rasters, view);
        continue;
      }
      // The reef: only a channel's gate lets water between the lagoon and the sea.
      if (from >= 0 && raster.kind[from] !== raster.kind[to] && !raster.gate[from] && !raster.gate[to]) {
        this.spawn(index, rasters, view);
        continue;
      }
      if (nextLat < view.south || nextLat > view.north || nextLon < view.west || nextLon > view.east) {
        this.spawn(index, rasters, view);
        continue;
      }
      this.lat[index] = nextLat;
      this.lon[index] = nextLon;
      if (record) this.pushTrail(index);
    }
  }
}
