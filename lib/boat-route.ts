import { distanceKm, polylineKm, type LatLon } from "./boat-nav";
import { readIslands } from "./islands";
import { readOpenings } from "./openings";
import { allRims, boxesOverlap, KM_PER_DEG_LAT, KM_PER_DEG_LON, nearestRimPoint, padBox, ringBox, type RimRing, type RingBox } from "./rim";
import { readShoals } from "./shoals";
import { listMergedSites } from "./store";

/**
 * A boat route to a dive site that keeps off the land and reef the app knows of: OSM islands, Allen Coral Atlas lagoon
 * reef tops and sand shallows, and the atoll outlines, which it crosses only at a reef-crest gap (data/openings.json)
 * or a pass dive site. These are satellite outlines, not a chart: no depths, no buoys, nothing under 50 m across.
 *
 * The search runs on a grid of square cells over the box round both ends: blocked cells are the shapes, every other
 * cell costs more the nearer it lies to a shape, so the route keeps a margin where there is room and still threads a
 * narrow pass. A* finds the cheapest path, which is then pulled straight wherever a straight leg costs no more.
 */

export type RouteGap = LatLon & { widthM: number; shallow: boolean };

export type RouteShapes = {
  /** Islands and reef: the route never enters them (except near either end). */
  blockers: readonly RimRing[];
  /** Atoll outlines: their line is crossed only at a gap. */
  rims: readonly RimRing[];
  /** Openings in the outlines. A shallow one (a reef-flat sill) is passable at a cost. */
  gaps: readonly RouteGap[];
};

export type BoatRoute = {
  /** From the boat to the site, [lat, lon]. A straight pair when `routed` is false. */
  points: [number, number][];
  lengthKm: number;
  /** False when no path through the known water was found; `points` is then the straight line. */
  routed: boolean;
  /** The outline gaps the route goes through, in order. */
  gaps: RouteGap[];
  /** The straight-line distance, for comparison. */
  directKm: number;
};

/** Grid cell edge, metres. Grown for long routes so the grid stays under MAX_CELLS. */
export const CELL_M = 50;
const MAX_CELLS = 2_000_000;
/**
 * The searches tried in turn until one finds a path: the water round the two ends it may use (km), and whether a
 * reef-flat sill counts as a way through an outline. A sill is a last resort, after a deep gap farther off.
 */
const ATTEMPTS = [
  { padKm: 3, sills: false },
  { padKm: 12, sills: false },
  { padKm: 12, sills: true },
] as const;
/** Within this of either end the route may cross shapes: a thila pin sits on its reef, a boat may lie alongside an island. */
export const ENDPOINT_FREE_M = 300;
/** Cells this close (in cells) to a shape cost more, up to 1 + MARGIN_CELLS × MARGIN_COST next to it. */
const MARGIN_CELLS = 4;
const MARGIN_COST = 0.6;
/** Extra cost per cell over a reef-flat sill gap (when one is allowed) and inside the free zone round the ends. */
const SHALLOW_GAP_COST = 40;
const ENDPOINT_COST = 4;
/** How far from the pin a pass site's outline crossing counts as open, metres. */
const PASS_OPEN_M = 150;
/** A pass pin farther than this from its outline does not open it. */
const PASS_RIM_MAX_KM = 0.8;

/** Cells past the last straight leg that pullStraight still tries before it keeps that corner. */
const PULL_LOOKAHEAD = 80;

const BLOCK = 1;
const RIM = 2;

type Grid = {
  south: number;
  west: number;
  /** Km per degree of longitude at the grid's middle latitude. */
  kmPerDegLon: number;
  cellKm: number;
  width: number;
  height: number;
  flags: Uint8Array;
  extra: Float32Array;
  /** 1 + the index in RouteShapes.gaps of the gap that opened this outline cell; 0 elsewhere. */
  gapOf: Int32Array;
};

export function planRoute(from: LatLon, to: LatLon, shapes: RouteShapes): BoatRoute {
  const directKm = distanceKm(from, to);
  for (const { padKm, sills } of ATTEMPTS) {
    const grid = buildGrid(from, to, shapes, padKm, sills);
    const cells = findPath(grid, from, to);
    if (!cells) continue;
    const pulled = pullStraight(grid, cells);
    const points: [number, number][] = pulled.map((cell) => cellLatLon(grid, cell));
    points[0] = [from.lat, from.lon];
    points[points.length - 1] = [to.lat, to.lon];
    return { points, lengthKm: polylineKm(points), routed: true, gaps: gapsOnPath(grid, cells, shapes.gaps), directKm };
  }
  return { points: [[from.lat, from.lon], [to.lat, to.lon]], lengthKm: directKm, routed: false, gaps: [], directKm };
}

/** The route from the boat to a catalog site, through the shapes in data/. */
export async function boatRoute(from: LatLon, siteId: string): Promise<BoatRoute | null> {
  const sites = await listMergedSites();
  const site = sites.find((item) => item.id === siteId);
  if (!site) return null;
  return planRoute(from, site, routeShapes(sites));
}

type Boxed = { ring: RimRing; box: RingBox };
let shapeCache: { blockers: Boxed[]; rims: Boxed[]; gaps: RouteGap[] } | null = null;

function routeShapes(sites: readonly { lat: number; lon: number; siteType?: string }[]): RouteShapes {
  if (!shapeCache) {
    const boxed = (ring: RimRing): Boxed => ({ ring, box: ringBox(ring) });
    const rims = [...allRims().values()].map(boxed);
    const openings = readOpenings().map(({ lat, lon, widthM, reefFlatBridges }) => ({
      lat,
      lon,
      widthM,
      shallow: reefFlatBridges === true,
    }));
    shapeCache = {
      blockers: [...readIslands().map((island) => boxed(island.ring)), ...readShoals().map((shoal) => boxed(shoal.ring))],
      rims,
      gaps: openings,
    };
  }
  const { blockers, rims, gaps } = shapeCache;
  // A pass dive site is a way through its outline even where the crest map shows no gap.
  const passes = sites
    .filter((site) => site.siteType === "pass")
    .flatMap((site) => {
      const foot = nearestOnRims(site, rims);
      return foot && foot.km <= PASS_RIM_MAX_KM ? [{ lat: foot.lat, lon: foot.lon, widthM: PASS_OPEN_M * 2, shallow: false }] : [];
    });
  return { blockers: blockers.map((item) => item.ring), rims: rims.map((item) => item.ring), gaps: [...gaps, ...passes] };
}

/** The nearest point on any outline whose box lies near the pin. */
function nearestOnRims(pin: LatLon, rims: readonly Boxed[]): ReturnType<typeof nearestRimPoint> | null {
  const near = padBox({ south: pin.lat, north: pin.lat, west: pin.lon, east: pin.lon }, 0.02);
  let best: ReturnType<typeof nearestRimPoint> | null = null;
  for (const { ring, box } of rims) {
    if (!boxesOverlap(box, near)) continue;
    const foot = nearestRimPoint(pin, ring);
    if (!best || foot.km < best.km) best = foot;
  }
  return best;
}

function buildGrid(from: LatLon, to: LatLon, shapes: RouteShapes, padKm: number, sills: boolean): Grid {
  const midLat = (from.lat + to.lat) / 2;
  const kmPerDegLon = KM_PER_DEG_LON * Math.cos((midLat * Math.PI) / 180);
  const south = Math.min(from.lat, to.lat) - padKm / KM_PER_DEG_LAT;
  const north = Math.max(from.lat, to.lat) + padKm / KM_PER_DEG_LAT;
  const west = Math.min(from.lon, to.lon) - padKm / kmPerDegLon;
  const east = Math.max(from.lon, to.lon) + padKm / kmPerDegLon;
  const spanX = (east - west) * kmPerDegLon;
  const spanY = (north - south) * KM_PER_DEG_LAT;
  const cellKm = Math.max(CELL_M / 1000, Math.sqrt((spanX * spanY) / MAX_CELLS));
  const width = Math.ceil(spanX / cellKm);
  const height = Math.ceil(spanY / cellKm);
  const grid: Grid = {
    south,
    west,
    kmPerDegLon,
    cellKm,
    width,
    height,
    flags: new Uint8Array(width * height),
    extra: new Float32Array(width * height),
    gapOf: new Int32Array(width * height),
  };
  const box: RingBox = { south, north, west, east };
  for (const ring of shapes.blockers) {
    if (!boxesOverlap(ringBox(ring), box)) continue;
    fillRing(grid, ring);
    traceRing(grid, ring, BLOCK);
  }
  for (const ring of shapes.rims) {
    if (boxesOverlap(ringBox(ring), box)) traceRing(grid, ring, RIM);
  }
  shapes.gaps.forEach((gap, index) => {
    if (sills || !gap.shallow) openGap(grid, gap, index);
  });
  addMargins(grid);
  for (const end of [from, to]) freeEnd(grid, end);
  return grid;
}

function toCellXY(grid: Grid, lat: number, lon: number): [number, number] {
  return [((lon - grid.west) * grid.kmPerDegLon) / grid.cellKm, ((lat - grid.south) * KM_PER_DEG_LAT) / grid.cellKm];
}

function cellLatLon(grid: Grid, cell: number): [number, number] {
  const x = cell % grid.width;
  const y = Math.floor(cell / grid.width);
  return [grid.south + ((y + 0.5) * grid.cellKm) / KM_PER_DEG_LAT, grid.west + ((x + 0.5) * grid.cellKm) / grid.kmPerDegLon];
}

/** Every cell whose centre lies inside the ring (even-odd scanlines). */
function fillRing(grid: Grid, ring: RimRing) {
  const points = ring.map(([lat, lon]) => toCellXY(grid, lat, lon));
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of points) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const fromRow = Math.max(0, Math.ceil(minY - 0.5));
  const toRow = Math.min(grid.height - 1, Math.floor(maxY - 0.5));
  const crossings: number[] = [];
  for (let row = fromRow; row <= toRow; row += 1) {
    const yc = row + 0.5;
    crossings.length = 0;
    for (let index = 0; index + 1 < points.length; index += 1) {
      const [x1, y1] = points[index];
      const [x2, y2] = points[index + 1];
      if (y1 > yc !== y2 > yc) crossings.push(x1 + ((yc - y1) * (x2 - x1)) / (y2 - y1));
    }
    crossings.sort((a, b) => a - b);
    for (let pair = 0; pair + 1 < crossings.length; pair += 2) {
      const start = Math.max(0, Math.ceil(crossings[pair] - 0.5));
      const end = Math.min(grid.width - 1, Math.floor(crossings[pair + 1] - 0.5));
      for (let x = start; x <= end; x += 1) grid.flags[row * grid.width + x] |= BLOCK;
    }
  }
}

/** Every cell the ring's edge passes through, so a shape thinner than a cell still blocks. */
function traceRing(grid: Grid, ring: RimRing, flag: number) {
  for (let index = 0; index + 1 < ring.length; index += 1) {
    const from = toCellXY(grid, ring[index][0], ring[index][1]);
    const to = toCellXY(grid, ring[index + 1][0], ring[index + 1][1]);
    forCellsOnLine(grid, from, to, (cell) => {
      grid.flags[cell] |= flag;
    });
  }
}

/** Calls `visit` for each grid cell a straight line crosses (in cell units), sampled at a third of a cell. */
function forCellsOnLine(grid: Grid, from: readonly [number, number], to: readonly [number, number], visit: (cell: number) => void) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const steps = Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * 3) + 1;
  for (let step = 0; step <= steps; step += 1) {
    const x = Math.floor(x1 + ((x2 - x1) * step) / steps);
    const y = Math.floor(y1 + ((y2 - y1) * step) / steps);
    if (x >= 0 && y >= 0 && x < grid.width && y < grid.height) visit(y * grid.width + x);
  }
}

/** Clears the outline across a gap's mouth; a shallow gap stays passable at extra cost. Reef in the gap still blocks. */
function openGap(grid: Grid, gap: RouteGap, index: number) {
  const radius = gap.widthM / 1000 / 2 / grid.cellKm;
  forCellsWithin(grid, gap, radius + 0.5, (cell) => {
    if (!(grid.flags[cell] & RIM)) return;
    grid.flags[cell] &= ~RIM;
    grid.gapOf[cell] = index + 1;
    if (gap.shallow) grid.extra[cell] = Math.max(grid.extra[cell], SHALLOW_GAP_COST);
  });
}

/** Calls `visit` for each grid cell whose centre lies within `reach` cells of the point. */
function forCellsWithin(grid: Grid, point: LatLon, reach: number, visit: (cell: number) => void) {
  const [cx, cy] = toCellXY(grid, point.lat, point.lon);
  for (let y = Math.max(0, Math.floor(cy - reach)); y <= Math.min(grid.height - 1, Math.ceil(cy + reach)); y += 1) {
    for (let x = Math.max(0, Math.floor(cx - reach)); x <= Math.min(grid.width - 1, Math.ceil(cx + reach)); x += 1) {
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= reach) visit(y * grid.width + x);
    }
  }
}

/** Distance in cells to the nearest blocked cell (two-pass chamfer), turned into extra cost near shapes. */
function addMargins(grid: Grid) {
  const { width, height, flags } = grid;
  const far = MARGIN_CELLS + 1;
  const distance = new Float32Array(width * height).fill(far);
  for (let cell = 0; cell < flags.length; cell += 1) if (flags[cell]) distance[cell] = 0;
  const relax = (cell: number, other: number, step: number) => {
    const through = distance[other] + step;
    if (through < distance[cell]) distance[cell] = through;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = y * width + x;
      if (x > 0) relax(cell, cell - 1, 1);
      if (y > 0) {
        relax(cell, cell - width, 1);
        if (x > 0) relax(cell, cell - width - 1, Math.SQRT2);
        if (x + 1 < width) relax(cell, cell - width + 1, Math.SQRT2);
      }
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const cell = y * width + x;
      if (x + 1 < width) relax(cell, cell + 1, 1);
      if (y + 1 < height) {
        relax(cell, cell + width, 1);
        if (x + 1 < width) relax(cell, cell + width + 1, Math.SQRT2);
        if (x > 0) relax(cell, cell + width - 1, Math.SQRT2);
      }
    }
  }
  for (let cell = 0; cell < flags.length; cell += 1) {
    if (flags[cell]) continue;
    grid.extra[cell] += Math.max(0, MARGIN_CELLS - distance[cell] + 1) * MARGIN_COST;
  }
}

function freeEnd(grid: Grid, end: LatLon) {
  forCellsWithin(grid, end, Math.max(ENDPOINT_FREE_M / 1000 / grid.cellKm, 1), (cell) => {
    if (!grid.flags[cell]) return;
    grid.flags[cell] = 0;
    grid.extra[cell] = Math.max(grid.extra[cell], ENDPOINT_COST);
  });
}

function cellAt(grid: Grid, point: LatLon): number {
  const [x, y] = toCellXY(grid, point.lat, point.lon);
  const cx = Math.min(grid.width - 1, Math.max(0, Math.floor(x)));
  const cy = Math.min(grid.height - 1, Math.max(0, Math.floor(y)));
  return cy * grid.width + cx;
}

const NEIGHBOURS: readonly [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** A* over the grid, 8 neighbours, no corner cutting past a blocked cell. Null when the goal is walled off. */
function findPath(grid: Grid, from: LatLon, to: LatLon): number[] | null {
  const { width, height, flags, extra } = grid;
  const start = cellAt(grid, from);
  const goal = cellAt(grid, to);
  const gx = goal % width;
  const gy = Math.floor(goal / width);
  const cost = new Float32Array(width * height).fill(Infinity);
  const came = new Int32Array(width * height).fill(-1);
  const closed = new Uint8Array(width * height);
  const heap = new MinHeap();
  cost[start] = 0;
  heap.push(start, 0);
  while (heap.size > 0) {
    const cell = heap.pop();
    if (closed[cell]) continue;
    if (cell === goal) return walkBack(came, goal);
    closed[cell] = 1;
    const x = cell % width;
    const y = Math.floor(cell / width);
    for (const [dx, dy, step] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (flags[next] || closed[next]) continue;
      if (dx !== 0 && dy !== 0 && (flags[y * width + nx] || flags[ny * width + x])) continue;
      const through = cost[cell] + step * (1 + extra[next]);
      if (through >= cost[next]) continue;
      cost[next] = through;
      came[next] = cell;
      const ax = Math.abs(nx - gx);
      const ay = Math.abs(ny - gy);
      heap.push(next, through + Math.max(ax, ay) + (Math.SQRT2 - 1) * Math.min(ax, ay));
    }
  }
  return null;
}

function walkBack(came: Int32Array, goal: number): number[] {
  const path = [goal];
  for (let cell = came[goal]; cell !== -1; cell = came[cell]) path.push(cell);
  return path.reverse();
}

/** The cells a straight leg between two cell centres crosses. */
function legCells(grid: Grid, a: number, b: number): number[] {
  const centre = (cell: number): [number, number] => [(cell % grid.width) + 0.5, Math.floor(cell / grid.width) + 0.5];
  const cells: number[] = [];
  forCellsOnLine(grid, centre(a), centre(b), (cell) => {
    if (cells[cells.length - 1] !== cell) cells.push(cell);
  });
  return cells;
}

/**
 * Drops corners where a straight leg to a later cell crosses nothing blocked and nothing costlier than the worst cell
 * the path itself crossed between them, so the route keeps its margins and narrow-pass line but loses the grid's zigzag.
 */
function pullStraight(grid: Grid, path: number[]): number[] {
  const kept = [path[0]];
  let anchor = 0;
  while (anchor < path.length - 1) {
    let reach = anchor + 1;
    let worst = grid.extra[path[anchor + 1]];
    for (let next = anchor + 2; next < path.length; next += 1) {
      worst = Math.max(worst, grid.extra[path[next]]);
      const cells = legCells(grid, path[anchor], path[next]);
      if (cells.every((cell) => !grid.flags[cell] && grid.extra[cell] <= worst + 1e-6)) reach = next;
      else if (next - reach > PULL_LOOKAHEAD) break;
    }
    kept.push(path[reach]);
    anchor = reach;
  }
  return kept;
}

/** The gaps whose opened outline cells the path steps through, in order. */
function gapsOnPath(grid: Grid, path: readonly number[], gaps: readonly RouteGap[]): RouteGap[] {
  const used: RouteGap[] = [];
  for (const cell of path) {
    const gap = gaps[grid.gapOf[cell] - 1];
    if (gap && used[used.length - 1] !== gap) used.push(gap);
  }
  return used;
}

class MinHeap {
  private cells: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.cells.length;
  }
  push(cell: number, key: number) {
    let index = this.cells.length;
    this.cells.push(cell);
    this.keys.push(key);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.keys[parent] <= key) break;
      this.cells[index] = this.cells[parent];
      this.keys[index] = this.keys[parent];
      index = parent;
    }
    this.cells[index] = cell;
    this.keys[index] = key;
  }
  pop(): number {
    const top = this.cells[0];
    const lastCell = this.cells.pop() as number;
    const lastKey = this.keys.pop() as number;
    const size = this.cells.length;
    if (size > 0) {
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        if (left >= size) break;
        const right = left + 1;
        const child = right < size && this.keys[right] < this.keys[left] ? right : left;
        if (this.keys[child] >= lastKey) break;
        this.cells[index] = this.cells[child];
        this.keys[index] = this.keys[child];
        index = child;
      }
      this.cells[index] = lastCell;
      this.keys[index] = lastKey;
    }
    return top;
  }
}
