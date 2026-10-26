import fs from "fs";
import path from "path";
import { seaStateHours, type Offshore } from "./sea-state";
import type { SiteExposure } from "./wave-exposure";
import type { SeaBand } from "./types";

/**
 * The sheltered-water map layer: a 500 m grid over every atoll's lagoon, each cell with its exposure to seas from
 * each direction (worked out once by npm run shelter-grid with the same ray tracing as the dive sites, islands and
 * reef gaps included), banded for one hour from the atoll's offshore waves and wind exactly as a site's sea state is.
 */

/** Grid spacing, degrees: about 500 m. */
export const SHELTER_STEP_DEG = 1 / 222;
/** Directions kept per cell, evenly round the compass. The tables are already spread over ±45°, so 15° loses little. */
export const SHELTER_DIRECTIONS = 24;
/** Bytes per cell: swell share, wind share and fetch for each direction. */
export const SHELTER_CELL_BYTES = SHELTER_DIRECTIONS * 3;
/** Share quantum: 0 to 250 is 0 to 1. Fetch quantum: 0.25 km, with NO_FETCH for a ray that runs out to sea. */
const SHARE_SCALE = 250;
const FETCH_SCALE = 4;
const NO_FETCH = 255;

/**
 * One atoll's cells. Rows run south to north from `south`, columns west to east from `west`, both in steps of
 * SHELTER_STEP_DEG; `runs` lists [row, first column, count] for the cells that exist (water inside the outline), in
 * the order their bytes sit in `cells`.
 */
export type ShelterAtollGrid = { south: number; west: number; runs: [number, number, number][]; cells: string };
export type ShelterGridFile = { stepDeg: number; directions: number; atolls: Record<string, ShelterAtollGrid> };

/** One cell's exposure packed into its bytes. */
export function packExposure(exposure: SiteExposure, into: Uint8Array, at: number): void {
  const step = exposure.swell.length / SHELTER_DIRECTIONS;
  for (let index = 0; index < SHELTER_DIRECTIONS; index += 1) {
    const ray = Math.round(index * step);
    const fetchKm = exposure.fetchKm[ray];
    into[at + index] = Math.round(exposure.swell[ray] * SHARE_SCALE);
    into[at + SHELTER_DIRECTIONS + index] = Math.round(exposure.wind[ray] * SHARE_SCALE);
    into[at + 2 * SHELTER_DIRECTIONS + index] = fetchKm == null ? NO_FETCH : Math.min(NO_FETCH - 1, Math.round(fetchKm * FETCH_SCALE));
  }
}

export function unpackExposure(bytes: Uint8Array, at: number): SiteExposure {
  const swell: number[] = [];
  const wind: number[] = [];
  const fetchKm: (number | null)[] = [];
  for (let index = 0; index < SHELTER_DIRECTIONS; index += 1) {
    swell.push(bytes[at + index] / SHARE_SCALE);
    wind.push(bytes[at + SHELTER_DIRECTIONS + index] / SHARE_SCALE);
    const fetch = bytes[at + 2 * SHELTER_DIRECTIONS + index];
    fetchKm.push(fetch === NO_FETCH ? null : fetch / FETCH_SCALE);
  }
  return { swell, wind, fetchKm };
}

const GRID_PATH = path.join(process.cwd(), "data", "shelter-grid.json");
let loadedGrid: ShelterGridFile | null = null;
const decoded = new Map<string, { lat: number; lon: number; exposure: SiteExposure }[]>();

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
    loadedGrid = { stepDeg: SHELTER_STEP_DEG, directions: SHELTER_DIRECTIONS, atolls: {} };
    return loadedGrid;
  }
  loadedGrid = parseShelterGrid(text);
  return loadedGrid;
}

export function parseShelterGrid(text: string): ShelterGridFile {
  const parsed = JSON.parse(text) as Partial<ShelterGridFile> | null;
  if (!parsed || typeof parsed !== "object") throw new Error("shelter-grid.json: not an object");
  if (parsed.stepDeg !== SHELTER_STEP_DEG || parsed.directions !== SHELTER_DIRECTIONS) {
    throw new Error("shelter-grid.json: built for another grid; run npm run shelter-grid");
  }
  if (!parsed.atolls || typeof parsed.atolls !== "object") throw new Error("shelter-grid.json: atolls is not an object");
  for (const [wayId, grid] of Object.entries(parsed.atolls)) {
    if (!Number.isFinite(grid?.south) || !Number.isFinite(grid?.west) || !Array.isArray(grid?.runs) || typeof grid?.cells !== "string") {
      throw new Error(`shelter-grid.json: atoll ${wayId} is not a grid`);
    }
    const count = grid.runs.reduce((sum, run) => sum + (Array.isArray(run) && run.length === 3 ? run[2] : Number.NaN), 0);
    if (!Number.isInteger(count) || Buffer.from(grid.cells, "base64").length !== count * SHELTER_CELL_BYTES) {
      throw new Error(`shelter-grid.json: atoll ${wayId} has cells that do not match its runs`);
    }
  }
  return parsed as ShelterGridFile;
}

/** One atoll's cells with their positions and exposure, decoded once. */
export function shelterCells(wayId: string): { lat: number; lon: number; exposure: SiteExposure }[] {
  const kept = decoded.get(wayId);
  if (kept) return kept;
  const grid = readShelterGrid().atolls[wayId];
  if (!grid) return [];
  const bytes = new Uint8Array(Buffer.from(grid.cells, "base64"));
  const cells: { lat: number; lon: number; exposure: SiteExposure }[] = [];
  for (const [row, firstColumn, count] of grid.runs) {
    for (let column = firstColumn; column < firstColumn + count; column += 1) {
      cells.push({
        lat: grid.south + (row + 0.5) * SHELTER_STEP_DEG,
        lon: grid.west + (column + 0.5) * SHELTER_STEP_DEG,
        exposure: unpackExposure(bytes, cells.length * SHELTER_CELL_BYTES),
      });
    }
  }
  decoded.set(wayId, cells);
  return cells;
}

/** Band letters for the client, one per cell in run order: c calm, m moderate, h choppy, r rough, ? unknown. */
const BAND_LETTER: Record<SeaBand, string> = { calm: "c", moderate: "m", choppy: "h", rough: "r" };

/**
 * Every cell's sea band at one hour, as a string of BAND_LETTER in the grid's run order. A cell the sea-state rules
 * leave out (a missing upwind sample or no wind that hour, and not already rough) is "?".
 */
export function shelterBands(wayId: string, offshore: Offshore, time: string): string {
  const sides = offshore.sides.map((side) => ({ sideDeg: side.sideDeg, hours: side.hours.filter((hour) => hour.time === time) }));
  const wind = (offshore.wind ?? []).filter((hour) => hour.time === time);
  return shelterCells(wayId)
    .map(({ exposure }) => {
      const [hour] = seaStateHours({ sides, exposure, wind });
      return hour ? BAND_LETTER[hour.band] : "?";
    })
    .join("");
}
