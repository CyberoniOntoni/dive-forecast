import fs from "fs";
import path from "path";
import zlib from "zlib";
import { seaStateHours, type Offshore } from "./sea-state";
import type { SiteExposure } from "./wave-exposure";
import { FIELD_LAND, FIELD_NONE, FIELD_OTHER, fieldByte } from "./shelter-field";

/**
 * The sheltered-water map layer: every atoll's lagoon and the sea for SHELTER_BAND_KM outside its outline, each cell
 * with its exposure to seas from each direction (worked out once by npm run shelter-grid with the same ray tracing as
 * the dive sites, islands and reef gaps included), banded for one hour from the atoll's offshore waves and wind exactly
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
/** Bytes per cell: swell share, wind share and fetch for each direction. */
export const SHELTER_CELL_BYTES = SHELTER_DIRECTIONS * 3;
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

/** Cells' exposures packed byte-plane by byte-plane, the layout `cells` stores before deflating. */
export function packExposures(exposures: readonly SiteExposure[]): Uint8Array {
  const count = exposures.length;
  const bytes = new Uint8Array(count * SHELTER_CELL_BYTES);
  exposures.forEach((exposure, cell) => {
    const step = exposure.swell.length / SHELTER_DIRECTIONS;
    for (let index = 0; index < SHELTER_DIRECTIONS; index += 1) {
      const ray = Math.round(index * step);
      const fetchKm = exposure.fetchKm[ray];
      bytes[index * count + cell] = Math.round(exposure.swell[ray] * SHARE_SCALE);
      bytes[(SHELTER_DIRECTIONS + index) * count + cell] = Math.round(exposure.wind[ray] * SHARE_SCALE);
      bytes[(2 * SHELTER_DIRECTIONS + index) * count + cell] =
        fetchKm == null ? NO_FETCH : Math.min(NO_FETCH - 1, Math.round(fetchKm * FETCH_SCALE));
    }
  });
  return bytes;
}

/** One cell's exposure from bytes laid out by packExposures for `count` cells. */
export function unpackExposure(bytes: Uint8Array, count: number, cell: number): SiteExposure {
  const swell: number[] = [];
  const wind: number[] = [];
  const fetchKm: (number | null)[] = [];
  for (let index = 0; index < SHELTER_DIRECTIONS; index += 1) {
    swell.push(bytes[index * count + cell] / SHARE_SCALE);
    wind.push(bytes[(SHELTER_DIRECTIONS + index) * count + cell] / SHARE_SCALE);
    const fetch = bytes[(2 * SHELTER_DIRECTIONS + index) * count + cell];
    fetchKm.push(fetch === NO_FETCH ? null : fetch / FETCH_SCALE);
  }
  return { swell, wind, fetchKm };
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

const GRID_PATH = path.join(process.cwd(), "data", "shelter-grid.json");
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
  let text: string;
  try {
    text = fs.readFileSync(GRID_PATH, "utf8");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT")) throw error;
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
  const atHour = (source: Offshore) => ({
    sides: source.sides.map((side) => ({ sideDeg: side.sideDeg, hours: side.hours.filter((hour) => hour.time === time) })),
    wind: (source.wind ?? []).filter((hour) => hour.time === time),
  });
  const own = atHour(offshore);
  const blends = new Map<number, { share: number; samples: ReturnType<typeof atHour> }>();
  for (const [neighbour, cells] of Object.entries(grid.blend)) {
    const source = neighbours.get(neighbour);
    if (!source || source.sides.length === 0) continue;
    const samples = atHour(source);
    for (const [row, column, percent] of cells) {
      const index = at(row, column);
      if (index >= 0) blends.set(index, { share: percent / 100, samples });
    }
  }
  let any = false;
  for (const cell of shelterCells(wayId, name)) {
    const index = at(cell.row, cell.column);
    if (index < 0) continue;
    const exposure = cell.exposure();
    const [hour] = seaStateHours({ ...own, exposure });
    let feltM = hour ? hour.feltM : null;
    const blend = blends.get(index);
    if (blend && feltM != null) {
      const [other] = seaStateHours({ ...blend.samples, exposure });
      if (other) feltM = blend.share * feltM + (1 - blend.share) * other.feltM;
    }
    values[index] = fieldByte(feltM, cell.outside);
    any = true;
  }
  if (!any) return null;
  return { south: grid.south + firstRow * step, west: grid.west + firstColumn * step, stepDeg: step, rows, columns, values };
}
