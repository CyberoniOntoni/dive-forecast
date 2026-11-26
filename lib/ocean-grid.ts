/**
 * The open sea between the atolls for the map's current-flow animation: Open-Meteo's surface current on a regular grid
 * over the Maldives, fetched for all points in a few multi-location requests and cached as one object (a file in the
 * marine cache dir on Node, R2 on a worker), refreshed like the per-point series (6-hour TTL, the warm-up a little
 * before). Display only: no forecast reads it.
 */
import fs from "fs";
import path from "path";
import { cacheGet, cachePut } from "./cache-bucket";
import { inFlightPerRequest, runInBackground, workerEnv } from "./cloudflare";
import { encodeVectors, KNOTS_PER_MS, type FlowOcean } from "./flow-wire";
import { fetchOpenMeteoJson, marineCacheDir, MARINE_CACHE_TTL_MS, type FetchOptions } from "./marine";
import { allRims, pointInRing } from "./rim";

/** The grid: the Maldives with a margin, every GRID_STEP degrees. Open-Meteo's current is on about 1/12° cells. */
export const GRID_BOX = { south: -0.75, north: 7.5, west: 72.375, east: 74.125 };
export const GRID_STEP = 0.25;
/** Points per Open-Meteo request (each location counts as a call either way; this keeps the URL short). */
const CHUNK = 80;
const CACHE_NAME = "ocean-grid.json";
const WORKER_KEY = `marine-cache/${CACHE_NAME}`;
const MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";

/** The cached grid: per point, each hour's current as east and north m/s (two decimals), null where the model has none. */
type GridCache = {
  fetchedAt: number;
  rows: number;
  columns: number;
  times: string[];
  /** Per hour, per point (row-major from the south-west): [east, north] or null. */
  hours: ([number, number] | null)[][];
};

let memo: GridCache | null = null;
/** When this isolate's last grid fetch failed: another is not tried for RETRY_AFTER_MS. */
let failedAt = 0;
const RETRY_AFTER_MS = 10 * 60 * 1000;
const loading = inFlightPerRequest<GridCache | null>();

export function gridSize(): { rows: number; columns: number } {
  return {
    rows: Math.round((GRID_BOX.north - GRID_BOX.south) / GRID_STEP) + 1,
    columns: Math.round((GRID_BOX.east - GRID_BOX.west) / GRID_STEP) + 1,
  };
}

/** The grid points, row-major from the south-west, and whether each is open sea (not inside an atoll outline). */
export function gridPoints(): { lat: number; lon: number; sea: boolean }[] {
  const { rows, columns } = gridSize();
  const rims = [...allRims().values()];
  const points: { lat: number; lon: number; sea: boolean }[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const lat = Math.round((GRID_BOX.south + row * GRID_STEP) * 1000) / 1000;
      const lon = Math.round((GRID_BOX.west + column * GRID_STEP) * 1000) / 1000;
      points.push({ lat, lon, sea: !rims.some((rim) => pointInRing(lat, lon, rim)) });
    }
  }
  return points;
}

/** Open-Meteo's answer for one location: its hours as [east, north] m/s, or null when the body has none. */
function locationHours(body: unknown): { times: string[]; values: ([number, number] | null)[] } | null {
  if (!body || typeof body !== "object") return null;
  const hourly = (body as { hourly?: { time?: unknown; ocean_current_velocity?: unknown; ocean_current_direction?: unknown } }).hourly;
  const unit = (body as { hourly_units?: { ocean_current_velocity?: string } }).hourly_units?.ocean_current_velocity;
  if (!hourly || !Array.isArray(hourly.time)) return null;
  const velocity = Array.isArray(hourly.ocean_current_velocity) ? hourly.ocean_current_velocity : [];
  const direction = Array.isArray(hourly.ocean_current_direction) ? hourly.ocean_current_direction : [];
  // Open-Meteo gives the marine current in km/h unless asked otherwise.
  const toMs = unit === "m/s" ? 1 : unit === "kn" ? 1 / KNOTS_PER_MS : 1 / 3.6;
  const values = hourly.time.map((_, index) => {
    const speed = velocity[index];
    const heading = direction[index];
    if (typeof speed !== "number" || typeof heading !== "number" || !Number.isFinite(speed) || !Number.isFinite(heading)) return null;
    const ms = speed * toMs;
    const radians = (heading * Math.PI) / 180;
    return [Math.round(ms * Math.sin(radians) * 100) / 100, Math.round(ms * Math.cos(radians) * 100) / 100] as [number, number];
  });
  return { times: hourly.time.map(String), values };
}

/** Fetches the whole grid. Null when any request fails, so a partial grid never replaces a whole one. */
export async function fetchGrid(): Promise<GridCache | null> {
  const points = gridPoints();
  const sea = points.flatMap((point, index) => (point.sea ? [{ ...point, index }] : []));
  const { rows, columns } = gridSize();
  let times: string[] | null = null;
  const byPoint = new Map<number, ([number, number] | null)[]>();
  for (let start = 0; start < sea.length; start += CHUNK) {
    const chunk = sea.slice(start, start + CHUNK);
    const params = new URLSearchParams({
      latitude: chunk.map((point) => point.lat).join(","),
      longitude: chunk.map((point) => point.lon).join(","),
      hourly: "ocean_current_velocity,ocean_current_direction",
      cell_selection: "sea",
      timezone: "Indian/Maldives",
      past_days: "1",
      forecast_days: "7",
    });
    const body = await fetchOpenMeteoJson(`${MARINE_URL}?${params}`, "Ocean grid");
    const list = Array.isArray(body) ? body : body ? [body] : [];
    if (list.length !== chunk.length) return null;
    for (let index = 0; index < chunk.length; index += 1) {
      const location = locationHours(list[index]);
      if (!location) continue;
      times ??= location.times;
      byPoint.set(chunk[index].index, location.values);
    }
  }
  if (!times) return null;
  const hours = times.map((_, hourIndex) =>
    points.map((_, pointIndex) => byPoint.get(pointIndex)?.[hourIndex] ?? null),
  );
  return { fetchedAt: Date.now(), rows, columns, times, hours };
}

async function readCache(): Promise<GridCache | null> {
  const env = workerEnv();
  try {
    const text = env ? await cacheGet(env, WORKER_KEY) : await fs.promises.readFile(path.join(/*turbopackIgnore: true*/ marineCacheDir(), CACHE_NAME), "utf8");
    if (!text) return null;
    const parsed = JSON.parse(text) as Partial<GridCache>;
    if (typeof parsed.fetchedAt !== "number" || !Array.isArray(parsed.times) || !Array.isArray(parsed.hours)) return null;
    return parsed as GridCache;
  } catch {
    return null;
  }
}

async function writeCache(grid: GridCache): Promise<void> {
  const text = JSON.stringify(grid);
  const env = workerEnv();
  if (env) return cachePut(env, WORKER_KEY, text);
  const dir = marineCacheDir();
  await fs.promises.mkdir(dir, { recursive: true });
  const file = path.join(/*turbopackIgnore: true*/ dir, CACHE_NAME);
  await fs.promises.writeFile(`${file}.tmp`, text);
  await fs.promises.rename(`${file}.tmp`, file);
}

/** Fetches and saves the grid, sharing one fetch per request. Null when it failed (the old cache stays). */
function refresh(): Promise<GridCache | null> {
  if (Date.now() - failedAt < RETRY_AFTER_MS) return Promise.resolve(null);
  const inFlight = loading();
  const running = inFlight.get("grid");
  if (running) return running;
  const load = fetchGrid()
    .then(async (grid) => {
      if (!grid) {
        failedAt = Date.now();
        return null;
      }
      memo = grid;
      await writeCache(grid).catch((error: unknown) => console.warn("Failed to save the ocean grid", error));
      return grid;
    })
    .finally(() => inFlight.delete("grid"));
  inFlight.set("grid", load);
  return load;
}

/**
 * The cached grid, refreshed past MARINE_CACHE_TTL_MS behind the caller (or waited for past refreshOlderThanMs, as the
 * warm-up asks). With no cache at all it waits for the first fetch unless told not to wait.
 */
async function loadGrid(options: FetchOptions): Promise<GridCache | null> {
  let grid = memo;
  if (!grid || Date.now() - grid.fetchedAt > MARINE_CACHE_TTL_MS) {
    const stored = await readCache();
    if (stored && (!grid || stored.fetchedAt > grid.fetchedAt)) grid = memo = stored;
  }
  const age = grid ? Date.now() - grid.fetchedAt : Infinity;
  if (options.refreshOlderThanMs != null && age > options.refreshOlderThanMs) return (await refresh()) ?? grid;
  if (!grid) {
    if (options.wait === false) {
      runInBackground(refresh());
      return null;
    }
    return refresh();
  }
  if (age > MARINE_CACHE_TTL_MS) runInBackground(refresh());
  return grid;
}

/**
 * The open sea's current at `time` for the map: knots on the grid, cells with no value (inside an outline, or masked
 * by the model) filled from their neighbours. Null when there is no grid yet or it lacks the hour.
 */
export async function oceanGridAt(time: string, options: FetchOptions = { wait: false }): Promise<FlowOcean | null> {
  const grid = await loadGrid(options);
  if (!grid) return null;
  const hourIndex = grid.times.indexOf(time);
  if (hourIndex < 0) return null;
  const values = grid.hours[hourIndex];
  const filled = fillGaps(values, grid.rows, grid.columns);
  if (!filled) return null;
  return {
    south: GRID_BOX.south,
    west: GRID_BOX.west,
    step: GRID_STEP,
    rows: grid.rows,
    columns: grid.columns,
    vectors: encodeVectors(
      filled.map((value) => value[0] * KNOTS_PER_MS),
      filled.map((value) => value[1] * KNOTS_PER_MS),
    ),
  };
}

/** Every null cell set to the mean of its set neighbours, spreading outward until all are set. Null when none is set. */
export function fillGaps(values: readonly ([number, number] | null)[], rows: number, columns: number): [number, number][] | null {
  const cells = values.map((value) => (value ? [value[0], value[1]] as [number, number] : null));
  if (!cells.some((value) => value != null)) return null;
  while (cells.some((value) => value == null)) {
    const next = cells.slice();
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;
        if (cells[index]) continue;
        let east = 0;
        let north = 0;
        let count = 0;
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const r = row + dr;
          const c = column + dc;
          if (r < 0 || r >= rows || c < 0 || c >= columns) continue;
          const value = cells[r * columns + c];
          if (!value) continue;
          east += value[0];
          north += value[1];
          count += 1;
        }
        if (count > 0) next[index] = [east / count, north / count];
      }
    }
    for (let index = 0; index < cells.length; index += 1) cells[index] = next[index];
  }
  return cells as [number, number][];
}

/** For tests. */
export function clearOceanGridMemo(): void {
  memo = null;
  failedAt = 0;
}
