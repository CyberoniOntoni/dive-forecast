import zlib from "zlib";
import { toMaldivesWall } from "./forecast";
import { readIslands } from "./islands";
import { readOpenings } from "./openings";
import {
  allRims,
  boxesOverlap,
  KM_PER_DEG_LAT,
  padBox,
  pointInRing,
  rimEdgeKm,
  rimForAtoll,
  rimWayId,
  ringBox,
  type RimRing,
  type RingBox,
} from "./rim";
import { blendSeaState, exposureIslands, exposureRings, exposureShoals, loadOffshore, seaStateHours, type Offshore } from "./sea-state";
import { readCatalog } from "./store";
import { siteExposure, type SiteExposure } from "./wave-exposure";
import { FIELD_LAND, FIELD_NONE, FIELD_OTHER, fieldByte } from "./shelter-field";
import type { Atoll, SeaStateHour } from "./types";
import { readDataFileIfPresent } from "./data-files";

/**
 * The sheltered-water map layer: every atoll's lagoon and the sea for SHELTER_BAND_KM outside its outline, each cell
 * with its exposure to seas from each direction (worked out once by npm run shelter-grid with the same ray tracing as
 * the dive sites, islands, lagoon shoals and reef gaps included), banded for one hour from the atoll's offshore waves and wind exactly
 * as a site's sea state is. Two layers: 500 m cells everywhere, and 125 m cells within SHELTER_FINE_KM of an island,
 * where a small island's lee is only a few hundred metres long.
 */

/** Coarse grid spacing, degrees: about 500 m. */
export const SHELTER_STEP_DEG = 1 / 222;
/** Fine grid spacing near islands: a quarter of the coarse one, about 125 m, so the two grids line up. */
export const SHELTER_FINE_STEP_DEG = 1 / 888;
/** How far past the outline the layer reaches. */
export const SHELTER_BAND_KM = 5;
/**
 * Where two atolls' seas meet, each atoll's cells this close to the meeting line blend toward the other's waves and
 * wind, so the shading has no step where one atoll's offshore samples give way to the next one's.
 */
export const SHELTER_BLEND_KM = 2;
/** Fine cells cover the water this close to an island's coast. */
export const SHELTER_FINE_KM = 0.4;
/** Directions kept per cell, evenly round the compass. The tables are already spread over ±45°, so 15° loses little. */
export const SHELTER_DIRECTIONS = 24;
/** Bytes per cell: swell share, wind share, fetch and the sheltered rays' own wind share for each direction. */
export const SHELTER_CELL_BYTES = SHELTER_DIRECTIONS * 4;
/** Share quantum: 0 to 100 is 0 to 1. Fetch quantum: 0.25 km, with NO_FETCH for a ray that runs out to sea. */
const SHARE_SCALE = 100;
const FETCH_SCALE = 4;
const NO_FETCH = 255;

/** [row, first column, count] runs of cells along rows. */
export type ShelterRuns = [number, number, number][];
/**
 * One atoll's cells at one spacing. Rows run south to north from `south`, columns west to east from `west`. `inner`
 * lists the water cells inside the outline and `outer` those outside it; their bytes sit in `cells` in that order
 * (inner runs, then outer runs), byte-plane by byte-plane (every cell's first byte, then every cell's second ...),
 * each byte stored as its difference from the cell before (neighbours are alike, so this packs small), then brotli
 * and base64. `land` lists island cells and `other` another atoll's water (inside its outline, or nearer to it); they
 * carry no bytes. `blend` lists, by the neighbouring atoll, sea cells near where the two atolls' seas meet, with the
 * percentage of this atoll's sea state they take: 50 on the meeting line, rising to 100 where the cell is
 * SHELTER_BLEND_KM nearer this outline than the other.
 */
export type ShelterLayerGrid = {
  south: number;
  west: number;
  rows: number;
  columns: number;
  inner: ShelterRuns;
  outer: ShelterRuns;
  land: ShelterRuns;
  other: ShelterRuns;
  blend: Record<string, [number, number, number][]>;
  cells: string;
};
export type ShelterAtollGrid = { coarse: ShelterLayerGrid; fine: ShelterLayerGrid };
export type ShelterGridFile = {
  stepDeg: number;
  fineStepDeg: number;
  bandKm: number;
  fineKm: number;
  directions: number;
  atolls: Record<string, ShelterAtollGrid>;
};
export type ShelterLayerName = keyof ShelterAtollGrid;

/**
 * Cells' exposures packed byte-plane by byte-plane, the layout `cells` stores before deflating. Each of the
 * SHELTER_DIRECTIONS bins summarises the rays it spans: the mean of their swell and wind shares (already spread over
 * ±45°, so alike), and the shortest of their fetches, so a wooded island's lee on any one ray in the bin is kept. A
 * bin's fetch is open sea only when every ray in it is.
 */
export function packExposures(exposures: readonly SiteExposure[]): Uint8Array {
  const count = exposures.length;
  const bytes = new Uint8Array(count * SHELTER_CELL_BYTES);
  exposures.forEach((exposure, cell) => {
    const rays = exposure.swell.length;
    const perBin = rays / SHELTER_DIRECTIONS;
    for (let index = 0; index < SHELTER_DIRECTIONS; index += 1) {
      // The bin centred on direction `index`: rays from half a bin before it to half a bin after.
      const bin = Array.from({ length: perBin }, (_, offset) => (index * perBin + offset - Math.floor(perBin / 2) + rays) % rays);
      const mean = (table: readonly number[]) => bin.reduce((sum, ray) => sum + table[ray], 0) / bin.length;
      const sheltered = bin.filter((ray) => exposure.fetchKm[ray] != null);
      const fetches = sheltered.map((ray) => exposure.fetchKm[ray] as number);
      bytes[index * count + cell] = Math.round(mean(exposure.swell) * SHARE_SCALE);
      bytes[(SHELTER_DIRECTIONS + index) * count + cell] = Math.round(mean(exposure.wind) * SHARE_SCALE);
      bytes[(2 * SHELTER_DIRECTIONS + index) * count + cell] =
        fetches.length === 0 ? NO_FETCH : Math.min(NO_FETCH - 1, Math.round(Math.min(...fetches) * FETCH_SCALE));
      // The least open of the rays with a fetch, so a bin is sheltered upwind exactly when one of its rays is.
      bytes[(3 * SHELTER_DIRECTIONS + index) * count + cell] = Math.round(
        Math.min(1, ...sheltered.map((ray) => exposure.rayWind[ray])) * SHARE_SCALE,
      );
    }
  });
  return bytes;
}

/** One cell's exposure from bytes laid out by packExposures for `count` cells. */
export function unpackExposure(bytes: Uint8Array, count: number, cell: number): SiteExposure {
  const swell: number[] = [];
  const wind: number[] = [];
  const rayWind: number[] = [];
  const fetchKm: (number | null)[] = [];
  for (let index = 0; index < SHELTER_DIRECTIONS; index += 1) {
    swell.push(bytes[index * count + cell] / SHARE_SCALE);
    wind.push(bytes[(SHELTER_DIRECTIONS + index) * count + cell] / SHARE_SCALE);
    const fetch = bytes[(2 * SHELTER_DIRECTIONS + index) * count + cell];
    fetchKm.push(fetch === NO_FETCH ? null : fetch / FETCH_SCALE);
    rayWind.push(bytes[(3 * SHELTER_DIRECTIONS + index) * count + cell] / SHARE_SCALE);
  }
  return { swell, wind, rayWind, fetchKm };
}

/** Bytes from packExposures as `cells` stores them. */
export function encodeCells(bytes: Uint8Array): string {
  const count = bytes.length / SHELTER_CELL_BYTES;
  const delta = new Uint8Array(bytes.length);
  for (let at = 0; at < bytes.length; at += 1) delta[at] = (bytes[at] - (at % count === 0 ? 0 : bytes[at - 1])) & 255;
  return zlib.brotliCompressSync(delta).toString("base64");
}

export function decodeCells(cells: string): Uint8Array {
  const bytes = new Uint8Array(zlib.brotliDecompressSync(Buffer.from(cells, "base64")));
  const count = bytes.length / SHELTER_CELL_BYTES;
  for (let at = 0; at < bytes.length; at += 1) if (at % count !== 0) bytes[at] = (bytes[at] + bytes[at - 1]) & 255;
  return bytes;
}

let loadedGrid: ShelterGridFile | null = null;
const decoded = new Map<string, Uint8Array>();

function emptyGrid(): ShelterGridFile {
  return {
    stepDeg: SHELTER_STEP_DEG,
    fineStepDeg: SHELTER_FINE_STEP_DEG,
    bandKm: SHELTER_BAND_KM,
    fineKm: SHELTER_FINE_KM,
    directions: SHELTER_DIRECTIONS,
    atolls: {},
  };
}

/**
 * data/shelter-grid.json. A missing file is no grid: the layer shows nothing. Any other read or parse error, or a
 * grid of the wrong shape, throws and is read again on the next call.
 */
export function readShelterGrid(): ShelterGridFile {
  if (loadedGrid) return loadedGrid;
  const text = readDataFileIfPresent("shelter-grid.json");
  if (text === null) {
    loadedGrid = emptyGrid();
    return loadedGrid;
  }
  loadedGrid = parseShelterGrid(text);
  return loadedGrid;
}

function runCount(runs: unknown): number {
  if (!Array.isArray(runs)) return Number.NaN;
  return runs.reduce<number>(
    (sum, run) => sum + (Array.isArray(run) && run.length === 3 && run.every(Number.isInteger) ? run[2] : Number.NaN),
    0,
  );
}

export function parseShelterGrid(text: string): ShelterGridFile {
  const parsed = JSON.parse(text) as Partial<ShelterGridFile> | null;
  if (!parsed || typeof parsed !== "object") throw new Error("shelter-grid.json: not an object");
  const expected = emptyGrid();
  if ((["stepDeg", "fineStepDeg", "bandKm", "fineKm", "directions"] as const).some((key) => parsed[key] !== expected[key])) {
    throw new Error("shelter-grid.json: built for another grid; run npm run shelter-grid");
  }
  if (!parsed.atolls || typeof parsed.atolls !== "object") throw new Error("shelter-grid.json: atolls is not an object");
  for (const [wayId, atoll] of Object.entries(parsed.atolls)) {
    for (const name of ["coarse", "fine"] as const) {
      const grid = atoll?.[name];
      if (
        !grid ||
        ![grid.south, grid.west].every(Number.isFinite) ||
        ![grid.rows, grid.columns].every(Number.isInteger) ||
        typeof grid.cells !== "string" ||
        !Number.isFinite(runCount(grid.land)) ||
        !Number.isFinite(runCount(grid.other)) ||
        !grid.blend ||
        typeof grid.blend !== "object" ||
        !Object.values(grid.blend).every((cells) => Array.isArray(cells) && cells.every((cell) => Array.isArray(cell) && cell.length === 3))
      ) {
        throw new Error(`shelter-grid.json: atoll ${wayId} has no ${name} grid`);
      }
      const count = runCount(grid.inner) + runCount(grid.outer);
      if (!Number.isInteger(count)) throw new Error(`shelter-grid.json: atoll ${wayId} ${name} runs are not runs`);
      if (decodeCells(grid.cells).length !== count * SHELTER_CELL_BYTES) {
        throw new Error(`shelter-grid.json: atoll ${wayId} ${name} cells do not match their runs`);
      }
    }
  }
  return parsed as ShelterGridFile;
}

/** One layer's cell bytes, decoded once (parseShelterGrid has checked them against the runs). */
function layerBytes(wayId: string, name: ShelterLayerName, grid: ShelterLayerGrid): Uint8Array {
  const key = `${wayId}|${name}`;
  const kept = decoded.get(key);
  if (kept) return kept;
  const bytes = decodeCells(grid.cells);
  decoded.set(key, bytes);
  return bytes;
}

/** Every cell of one layer with its position, which side of the outline it lies, and its exposure (unpacked on call). */
export function* shelterCells(
  wayId: string,
  name: ShelterLayerName = "coarse",
): Generator<{ row: number; column: number; lat: number; lon: number; outside: boolean; exposure: () => SiteExposure }> {
  const grid = readShelterGrid().atolls[wayId]?.[name];
  if (!grid) return;
  const bytes = layerBytes(wayId, name, grid);
  const count = bytes.length / SHELTER_CELL_BYTES;
  const step = name === "fine" ? SHELTER_FINE_STEP_DEG : SHELTER_STEP_DEG;
  let cell = 0;
  for (const [runs, outside] of [[grid.inner, false], [grid.outer, true]] as const) {
    for (const [row, first, length] of runs) {
      for (let column = first; column < first + length; column += 1) {
        const at = cell;
        yield {
          row,
          column,
          lat: grid.south + (row + 0.5) * step,
          lon: grid.west + (column + 0.5) * step,
          outside,
          exposure: () => unpackExposure(bytes, count, at),
        };
        cell += 1;
      }
    }
  }
}

/**
 * One atoll layer's felt height at one hour on a rectangle of its grid, row 0 at the south, one byte per cell as
 * lib/shelter-field.ts sets out.
 */
export type ShelterField = { south: number; west: number; stepDeg: number; rows: number; columns: number; values: Uint8Array };

/**
 * Every cell's felt height at one hour, from the atoll's offshore waves and wind, exactly as a dive site's sea state
 * is worked out (seaStateHours). Sea near a neighbouring atoll's blends with what that atoll's samples give, when
 * `neighbours` has them. `within` crops it to a box (the fine layer is only sent for the map's view); null when the
 * atoll has no grid or none of it is in the box.
 */
export function shelterField(
  wayId: string,
  offshore: Offshore,
  time: string,
  name: ShelterLayerName = "coarse",
  within?: { south: number; west: number; north: number; east: number },
  neighbours: ReadonlyMap<string, Offshore> = new Map(),
): ShelterField | null {
  const grid = readShelterGrid().atolls[wayId]?.[name];
  if (!grid) return null;
  const step = name === "fine" ? SHELTER_FINE_STEP_DEG : SHELTER_STEP_DEG;
  const clamp = (value: number, most: number) => Math.max(0, Math.min(most, value));
  const firstRow = within ? clamp(Math.floor((within.south - grid.south) / step), grid.rows) : 0;
  const lastRow = within ? clamp(Math.ceil((within.north - grid.south) / step), grid.rows) : grid.rows;
  const firstColumn = within ? clamp(Math.floor((within.west - grid.west) / step), grid.columns) : 0;
  const lastColumn = within ? clamp(Math.ceil((within.east - grid.west) / step), grid.columns) : grid.columns;
  const rows = lastRow - firstRow;
  const columns = lastColumn - firstColumn;
  if (rows <= 0 || columns <= 0) return null;
  const values = new Uint8Array(rows * columns).fill(FIELD_NONE);
  const at = (row: number, column: number) =>
    row >= firstRow && row < lastRow && column >= firstColumn && column < lastColumn
      ? (row - firstRow) * columns + (column - firstColumn)
      : -1;
  for (const [runs, value] of [[grid.land, FIELD_LAND], [grid.other, FIELD_OTHER]] as const) {
    for (const [row, first, length] of runs) {
      for (let column = first; column < first + length; column += 1) {
        const index = at(row, column);
        if (index >= 0) values[index] = value;
      }
    }
  }
  const own = samplesAt(offshore, time);
  const blends = new Map<number, { share: number; samples: HourSamples }>();
  for (const [neighbour, cells] of Object.entries(grid.blend)) {
    const source = neighbours.get(neighbour);
    if (!source || source.sides.length === 0) continue;
    const samples = samplesAt(source, time);
    for (const [row, column, percent] of cells) {
      const index = at(row, column);
      if (index >= 0) blends.set(index, { share: percent / 100, samples });
    }
  }
  let any = false;
  for (const cell of shelterCells(wayId, name)) {
    const index = at(cell.row, cell.column);
    if (index < 0) continue;
    const blend = blends.get(index);
    const hour = seaAt(cell.exposure(), own, blend);
    values[index] = fieldByte(hour ? hour.feltM : null, cell.outside);
    any = true;
  }
  if (!any) return null;
  return { south: grid.south + firstRow * step, west: grid.west + firstColumn * step, stepDeg: step, rows, columns, values };
}

/** One hour of an atoll's offshore samples and wind, as seaStateHours takes them. */
type HourSamples = Pick<Parameters<typeof seaStateHours>[0], "sides" | "wind">;

function samplesAt(offshore: Offshore, time: string): HourSamples {
  return {
    sides: offshore.sides.map((side) => ({ sideDeg: side.sideDeg, hours: side.hours.filter((hour) => hour.time === time) })),
    wind: (offshore.wind ?? []).filter((hour) => hour.time === time),
  };
}

/**
 * The sea state at one spot of the layer, from its exposure and its atoll's samples for the hour. Near where two
 * atolls' seas meet, it is the two atolls' seas mixed by the spot's share (blendSeaState). Null when the hour is
 * unknown.
 */
function seaAt(exposure: SiteExposure, own: HourSamples, blend?: { share: number; samples: HourSamples }): SeaStateHour | null {
  const [hour] = seaStateHours({ ...own, exposure });
  if (!blend) return hour ?? null;
  const [other] = seaStateHours({ ...blend.samples, exposure });
  return blendSeaState(hour ?? null, other ?? null, blend.share);
}

/**
 * Who a spot of water belongs to on the layer. Inside an atoll outline: that atoll's lagoon. Outside every outline:
 * the sea of the nearest outline within SHELTER_BAND_KM (plus `slackKm`), blending toward the next-nearest one within
 * the band over SHELTER_BLEND_KM of their difference in distance (`share` is the owner's part, 0.5 to 1). Null past the
 * band. `island` is set on land.
 */
export type SeaOwner = { wayId: string; outside: boolean; island: boolean; blend?: { wayId: string; share: number } };

type OwnerOutline = { wayId: string; ring: RimRing } & RingBox;
let ownerOutlines: OwnerOutline[] | null = null;
let ownerIslands: ({ ring: RimRing } & RingBox)[] | null = null;

export function seaOwner(lat: number, lon: number, slackKm = 0): SeaOwner | null {
  ownerOutlines ??= [...allRims()].map(([wayId, ring]) => ({ wayId, ring, ...ringBox(ring) }));
  ownerIslands ??= readIslands().map(({ ring }) => ({ ring, ...ringBox(ring) }));
  const pad = (SHELTER_BAND_KM + slackKm) / KM_PER_DEG_LAT + 0.01;
  const island = ownerIslands.some((item) => inBox(lat, lon, item, 0) && pointInRing(lat, lon, item.ring));
  const within = ownerOutlines.find((item) => inBox(lat, lon, item, 0) && pointInRing(lat, lon, item.ring));
  if (within) return { wayId: within.wayId, outside: false, island };
  const near = ownerOutlines
    .filter((item) => inBox(lat, lon, item, pad))
    .map((item) => ({ wayId: item.wayId, km: rimEdgeKm({ lat, lon }, item.ring) }))
    .filter(({ km }) => km <= SHELTER_BAND_KM + slackKm)
    .sort((a, b) => a.km - b.km);
  if (near.length === 0) return null;
  const [owner, next] = near;
  const share = next && next.km <= SHELTER_BAND_KM ? Math.min(1, 0.5 + (next.km - owner.km) / (2 * SHELTER_BLEND_KM)) : 1;
  return { wayId: owner.wayId, outside: true, island, ...(next && share < 1 ? { blend: { wayId: next.wayId, share } } : {}) };
}

function inBox(lat: number, lon: number, box: RingBox, pad: number): boolean {
  return lat >= box.south - pad && lat <= box.north + pad && lon >= box.west - pad && lon <= box.east + pad;
}

/** One atoll's felt height on one of its grids for the map, as the getShelter action sends it. */
export type ShelterAtoll = {
  wayId: string;
  layer: ShelterLayerName;
  south: number;
  west: number;
  stepDeg: number;
  rows: number;
  columns: number;
  /** Base64, one byte per cell as lib/shelter-field.ts sets out. */
  values: string;
};
/** The hour shown, the hours that can be picked (from now, as far as the waves go), and the atolls in view. */
export type ShelterView = { time: string; hours: string[]; atolls: ShelterAtoll[]; stale: boolean };
export type ShelterBox = { south: number; west: number; north: number; east: number };

/** Hours the layer offers: from the current one, three days on. */
const SHELTER_HOURS = 72;
/** The fine cells are sent only for a view this small (degrees across): zoom 12 on a laptop, 11 on a phone. */
const SHELTER_FINE_VIEW_DEG = 0.6;
/** The shading fades out over the cell past the band's edge; a tap anywhere it shows still reads. */
const TAP_SLACK_KM = SHELTER_STEP_DEG * KM_PER_DEG_LAT;

/** Each outline with a grid once (two catalog atolls can share one), with the catalog atoll its waves load for. */
function gridAtolls(): { atoll: Atoll; wayId: string; ring: RimRing }[] {
  const grid = readShelterGrid();
  const seen = new Set<string>();
  return readCatalog().atolls.flatMap((atoll) => {
    const ring = rimForAtoll(atoll);
    const wayId = rimWayId(atoll);
    if (!ring || !grid.atolls[wayId] || seen.has(wayId)) return [];
    seen.add(wayId);
    return [{ atoll, wayId, ring }];
  });
}

async function offshoreFor(atoll: Atoll): Promise<Offshore | null> {
  const offshore = await loadOffshore(atoll, { wait: false }).catch(() => null);
  return offshore && offshore.sides.length > 0 ? offshore : null;
}

/**
 * Felt height over the atolls in view and the sea round them, at `time` (a Maldives wall hour) or the current hour,
 * with the 125 m cells near islands once the view is small enough. An atoll whose offshore waves are not loaded yet is
 * left out, and its fetch runs in the background for the next view.
 */
export async function shelterView(view: ShelterBox, time?: string): Promise<ShelterView> {
  const now = `${toMaldivesWall(new Date().toISOString()).slice(0, 13)}:00`;
  const grid = readShelterGrid();
  const band = SHELTER_BAND_KM / KM_PER_DEG_LAT;
  const atolls = gridAtolls();
  const shown = atolls.filter(({ ring }) => boxesOverlap(view, padBox(ringBox(ring), band)));
  // Atolls in view, and their neighbours whose seas they blend with where the two meet.
  const wanted = new Set(shown.map(({ wayId }) => wayId));
  for (const { wayId } of shown) for (const neighbour of Object.keys(grid.atolls[wayId].coarse.blend)) wanted.add(neighbour);
  const loaded = await Promise.all(
    atolls.filter(({ wayId }) => wanted.has(wayId)).map(async ({ atoll, wayId }) => [wayId, await offshoreFor(atoll)] as const),
  );
  const offshores = new Map(loaded.flatMap(([wayId, offshore]) => (offshore ? [[wayId, offshore] as const] : [])));
  const ready = shown.flatMap(({ wayId }) => {
    const offshore = offshores.get(wayId);
    return offshore ? [{ wayId, offshore }] : [];
  });
  const hours = [...new Set(ready.flatMap(({ offshore }) => offshore.sides.flatMap((side) => side.hours.map((hour) => hour.time))))]
    .filter((hour) => hour >= now)
    .sort()
    .slice(0, SHELTER_HOURS);
  const hour = time && hours.includes(time) ? time : now;
  const detail = view.north - view.south <= SHELTER_FINE_VIEW_DEG && view.east - view.west <= SHELTER_FINE_VIEW_DEG;
  const fields: ShelterAtoll[] = [];
  for (const { wayId, offshore } of ready) {
    for (const layer of detail ? (["coarse", "fine"] as const) : (["coarse"] as const)) {
      const field = shelterField(wayId, offshore, hour, layer, layer === "fine" ? view : undefined, offshores);
      if (!field) continue;
      const { values, ...shape } = field;
      fields.push({ wayId, layer, ...shape, values: Buffer.from(values).toString("base64") });
    }
  }
  return { time: hour, hours, atolls: fields, stale: ready.some(({ offshore }) => offshore.stale) };
}

/** An atoll's outline and the islands in and round it, for the map to cut the shading to water. */
export function shelterShapes(wayId: string): { outline: RimRing; islands: RimRing[] } | null {
  const outline = allRims().get(wayId);
  if (!outline) return null;
  const box = padBox(ringBox(outline), SHELTER_BAND_KM / KM_PER_DEG_LAT);
  const islands = readIslands()
    .map((island) => island.ring)
    .filter((ring) => boxesOverlap(ringBox(ring), box));
  return { outline, islands };
}

/**
 * The sea state at one spot of the layer, traced on its own (not read off the grid), for the map's tap readout. It
 * belongs to the atoll seaOwner gives, and blends with the neighbour's as that spot's cell does. Null where the layer
 * shows nothing or on land; "unknown" when the hour is.
 */
export async function shelterPoint(lat: number, lon: number, time: string): Promise<SeaStateHour | "unknown" | null> {
  const owner = seaOwner(lat, lon, TAP_SLACK_KM);
  if (!owner || owner.island) return null;
  const atolls = gridAtolls();
  const atollFor = (wayId: string) => atolls.find((item) => item.wayId === wayId)?.atoll;
  const ownAtoll = atollFor(owner.wayId);
  const offshore = ownAtoll ? await offshoreFor(ownAtoll) : null;
  if (!offshore) return "unknown";
  const neighbourAtoll = owner.blend ? atollFor(owner.blend.wayId) : undefined;
  const neighbour = neighbourAtoll ? await offshoreFor(neighbourAtoll) : null;
  const exposure = siteExposure(
    { lat, lon, kind: "lagoon", inwardBearingDeg: null, ownWayId: owner.wayId },
    exposureRings(),
    readOpenings(),
    exposureIslands(),
    exposureShoals(),
  );
  const blend = owner.blend && neighbour ? { share: owner.blend.share, samples: samplesAt(neighbour, time) } : undefined;
  return seaAt(exposure, samplesAt(offshore, time), blend) ?? "unknown";
}
