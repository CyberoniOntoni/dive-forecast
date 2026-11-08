import fs from "fs";
import path from "path";
import { inFlightPerRequest, perRequest, runInBackground, workerEnv } from "./cloudflare";
import { cacheGet, cachePut } from "./cache-bucket";
import { edgeRead, edgeWrite } from "./edge-cache";
import type { MarineHour } from "./types";

const DEFAULT_CACHE_DIR = path.join(process.cwd(), "data", "marine-cache");
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SERIES_STALE_MS = 12 * 60 * 60 * 1000;
/**
 * How long a data centre keeps its edge copy of a series. Past the 6-hour TTL the copy is still served at once while
 * R2 (or Open-Meteo) is checked behind the response, so a page after a quiet spell does not wait on R2 in the US.
 */
const EDGE_KEEP_MS = 24 * 60 * 60 * 1000;
/** A point is checked again behind a response at most this often per isolate. */
const REVALIDATE_EVERY_MS = 60 * 1000;
const MALDIVES_OFFSET_MS = 5 * 60 * 60 * 1000;
const SEAWARD_KM = 3;
/** Open-Meteo requests running at once. Hundreds of sites must not fire hundreds of requests together. */
const MAX_REQUESTS = 4;
const EARTH_RADIUS_KM = 6371;
/** Where a worker keeps the cache files in its R2 bucket. */
const WORKER_CACHE_PREFIX = "marine-cache/";

/**
 * Fetched Open-Meteo hours on Node. MARINE_CACHE_DIR points tests at a throwaway directory. A worker keeps them in R2
 * under WORKER_CACHE_PREFIX instead.
 */
export function marineCacheDir(): string {
  return process.env.MARINE_CACHE_DIR || DEFAULT_CACHE_DIR;
}

/**
 * A cache file's path on Node. The directory is only known at run time, so the build is told not to trace it: without
 * the ignore comment Turbopack would bundle the whole project into the server output.
 */
function marineCacheFile(name: string): string {
  return path.join(/*turbopackIgnore: true*/ marineCacheDir(), name);
}

/**
 * marine-api.open-meteo.com is the live marine host. api.open-meteo.com/v1/marine
 * returns 404 and is the fallback.
 */
const MARINE_ENDPOINTS = [
  "https://marine-api.open-meteo.com/v1/marine",
  "https://api.open-meteo.com/v1/marine",
];

export type MarineFetch = PointFetch<MarineHour>;

type HourlyColumns = {
  time: unknown[];
  seaLevelM: unknown[];
  velocity: unknown[];
  direction: unknown[];
  velocityUnit: string | undefined;
};

/**
 * Open-Meteo at the seaward point, for both sea level and current.
 * The point is 3 km out unless options.seawardKm steps it further. That step comes from the GEBCO
 * check: a 3 km cell on the reef or on land moves out until the cell is open ocean.
 * A failed or stale seaward fetch uses the fallback point instead.
 * When both fail or their hours are stale, the last cached series is used and marked stale.
 * A seaward point still pending its first fetch (wait: false) is unavailable, not failed: the fallback point's tide
 * and drift would show as the site's own.
 */
export async function siteMarineHours(
  lat: number,
  lon: number,
  inwardBearingDeg: number,
  fallbackLat: number,
  fallbackLon: number,
  options: FetchOptions = {},
): Promise<MarineFetch> {
  const point = seawardPoint(lat, lon, inwardBearingDeg, options.seawardKm);
  const seaward = await fetchMarine(point.lat, point.lon, options);
  if (!seaward.ok && seaward.pending) return seaward;
  if (seaward.ok && !marineSeriesStale(seaward.hours)) return freshMarine(seaward);
  const fallback = await fetchMarine(fallbackLat, fallbackLon, options);
  if (fallback.ok && !marineSeriesStale(fallback.hours)) return freshMarine(fallback);
  const cached = (await readCachedHours(point.lat, point.lon)) ?? (await readCachedHours(fallbackLat, fallbackLon));
  // The fallback point may itself still be on its first fetch: then the site is waiting too, not failed.
  if (!cached) return !fallback.ok && fallback.pending ? fallback : { ok: false, unavailable: true };
  return { ok: true, hours: cached.hours, fetchedAt: cached.fetchedAt, stale: true };
}

function freshMarine(fetched: { hours: MarineHour[]; fetchedAt: number }): MarineFetch {
  return { ok: true, hours: fetched.hours, fetchedAt: fetched.fetchedAt, stale: false };
}

/** Seaward of the site, opposite its inward bearing. The distance is 3 km unless a GEBCO check stepped it out. */
export function seawardPoint(
  lat: number,
  lon: number,
  inwardBearingDeg: number,
  distanceKm = SEAWARD_KM,
): { lat: number; lon: number } {
  // Opposite the inward bearing. The extra +360 keeps a negative bearing inside 0-360.
  const outwardBearing = ((inwardBearingDeg + 180) % 360 + 360) % 360;
  const km = distanceKm > 0 ? distanceKm : SEAWARD_KM;
  return destinationKm(lat, lon, outwardBearing, km);
}

/**
 * wait: false queues the first fetch for a point with no cache and returns at once as unavailable and pending (or
 * just unavailable when its last fetch failed). The map uses it, so a batch of new sites fills in over the next
 * loads instead of holding the page.
 */
export type FetchOptions = {
  wait?: boolean;
  /** Seaward distance in km. Absent means 3. The GEBCO table sets it when the 3 km cell is not open ocean. */
  seawardKm?: number;
  /**
   * Wait for a refresh of any series older than this (ms), instead of serving it and refreshing behind the response.
   * The scheduled warm-up (lib/warm.ts) sets it a little under the TTL, so visitors find R2 fresh. A point whose
   * refresh already failed in this request is not tried again by it.
   */
  refreshOlderThanMs?: number;
};

/**
 * Hours for one point. A cached series is returned at once; if it is past the 6-hour TTL, it is checked again in the
 * background (R2 first on a worker, then Open-Meteo), so a page never waits on Open-Meteo for a point it has seen
 * before. A point with no cache at all waits for its first fetch, unless the caller asked not to wait.
 */
export function fetchMarine(lat: number, lon: number, options: FetchOptions = {}): Promise<MarineFetch> {
  return marinePoints.fetch(lat, lon, options);
}

export type PointFetch<T> =
  | { ok: true; hours: T[]; fetchedAt: number; stale: boolean }
  | { ok: false; unavailable: true; pending?: true };

/** What differs between the Open-Meteo series cached per point: the series' own edge. */
export type PointSource<T> = {
  /** Put before each cache file name, so two series for the same point never share a file. */
  prefix: string;
  /** Fetches and parses the series. Null or no hours is a failure. */
  request: (lat: number, lon: number) => Promise<T[] | null>;
  /** The hours in a cache file read back as JSON, or null when it holds none. */
  readHours: (parsed: { hours?: unknown; body?: unknown }) => T[] | null;
  /**
   * True: a point whose last fetch failed is not waited on again, even by a caller that would wait; it retries in the
   * background. False: only wait: false skips the wait.
   */
  skipFailedPoints: boolean;
};

/**
 * One cached Open-Meteo series per point: the file cache, the 6-hour background refresh, one shared request per point
 * in flight, the failed-point set and the shared request slots. Every per-point Open-Meteo fetch goes through this,
 * so their cache and failure rules cannot drift apart.
 */
export function pointFetcher<T>(source: PointSource<T>) {
  /** Per request on a worker (perRequest). */
  const fetchesInFlight = inFlightPerRequest<{ hours: T[]; fetchedAt: number } | null>();
  /** Points whose last fetch failed, until one succeeds. */
  const failedPoints = new Set<string>();
  const fileName = (lat: number, lon: number) => `${source.prefix}${marineCacheName(lat, lon)}`;

  /** On a worker: series this isolate read or wrote, so a map load reads each point from R2 once per 6 hours. */
  const remembered = new Map<string, { fetchedAt: number; hours: T[] }>();

  async function readCached(lat: number, lon: number): Promise<{ fetchedAt: number; hours: T[] } | null> {
    const name = fileName(lat, lon);
    const env = workerEnv();
    if (!env) {
      try {
        return parsePointCache(fs.readFileSync(/*turbopackIgnore: true*/ marineCacheFile(name), "utf8"), source.readHours);
      } catch {
        return null;
      }
    }
    const known = remembered.get(name);
    if (known && withinTtl(known)) return known;
    // This data centre's copy first: R2 is a long way from the Maldives (lib/edge-cache.ts). A copy past the TTL is
    // still served; fetchPoint checks R2 again behind the response.
    const edgeText = await edgeRead(workerKey(name));
    const local = newest(edgeText ? parsePointCache(edgeText, source.readHours) : null, known);
    if (local) return remember(name, local);
    return readR2(name, null);
  }

  /** The series in R2 (or `local` when R2 has nothing newer), copied to this data centre's edge. */
  async function readR2(
    name: string,
    local: { fetchedAt: number; hours: T[] } | null,
  ): Promise<{ fetchedAt: number; hours: T[] } | null> {
    const env = workerEnv();
    if (!env) return local;
    const key = workerKey(name);
    try {
      const text = await cacheGet(env, key);
      readFromR2().add(name);
      const parsed = text ? parsePointCache(text, source.readHours) : null;
      if (parsed && (!local || parsed.fetchedAt > local.fetchedAt)) edgeWrite(key, text!, edgeSeconds(parsed.fetchedAt));
      return remember(name, newest(parsed, local));
    } catch {
      return remember(name, local);
    }
  }

  /** Points whose refresh failed in this request: the warm-up does not ask Open-Meteo for them again in the same run. */
  const failedThisRequest = perRequest(() => new Set<string>());
  /** Points this request has already read from R2, so a revalidate right after does not read them again. */
  const readFromR2 = perRequest(() => new Set<string>());
  /** Per request on a worker (perRequest), by point and age limit. */
  const revalidationsInFlight = inFlightPerRequest<{ hours: T[]; fetchedAt: number } | null>();
  /** When this isolate last checked each point behind a response: plain times, shared across requests. */
  const lastRevalidated = new Map<string, number>();

  /**
   * A series newer than maxAgeMs if one can be had: on a worker another isolate or the scheduled warm-up may have put
   * one in R2 already, so R2 is read before Open-Meteo is asked. Null when neither has one (the caller keeps what it had).
   */
  function revalidate(lat: number, lon: number, maxAgeMs: number): Promise<{ hours: T[]; fetchedAt: number } | null> {
    const name = fileName(lat, lon);
    // By age limit too: the warm-up's stricter check must not settle for a page's laxer one.
    const flightKey = `${name}|${maxAgeMs}`;
    const inFlight = revalidationsInFlight();
    const running = inFlight.get(flightKey);
    if (running) return running;
    const check = (async () => {
      lastRevalidated.set(name, Date.now());
      const local = remembered.get(name) ?? null;
      const stored = readFromR2().has(name) ? local : await readR2(name, local);
      if (stored && Date.now() - stored.fetchedAt <= maxAgeMs) return stored;
      if (failedThisRequest().has(name)) return stored;
      const fetched = await refresh(lat, lon);
      if (!fetched) failedThisRequest().add(name);
      return fetched ?? stored;
    })().finally(() => inFlight.delete(flightKey));
    inFlight.set(flightKey, check);
    return check;
  }

  /** Keeps the newest series this isolate has seen, so its memory never goes back to an older one. */
  function remember(name: string, series: { fetchedAt: number; hours: T[] } | null) {
    if (series) remembered.set(name, series);
    return series;
  }

  async function writeCached(lat: number, lon: number, hours: T[], fetchedAt: number) {
    const name = fileName(lat, lon);
    const text = JSON.stringify({ fetchedAt, hours });
    try {
      const env = workerEnv();
      if (env) {
        remembered.set(name, { fetchedAt, hours });
        const key = workerKey(name);
        await cachePut(env, key, text);
        edgeWrite(key, text, edgeSeconds(fetchedAt));
        return;
      }
      fs.mkdirSync(marineCacheDir(), { recursive: true });
      fs.writeFileSync(/*turbopackIgnore: true*/ marineCacheFile(name), text);
    } catch (error) {
      console.warn("Failed to write marine cache", error);
    }
  }

  /**
   * Fetches a point and caches it. Callers asking for the same point while it runs share one request, and at most
   * MAX_REQUESTS run at once. A failed fetch leaves the cache as it was.
   */
  function refresh(lat: number, lon: number): Promise<{ hours: T[]; fetchedAt: number } | null> {
    const key = fileName(lat, lon);
    const inFlight = fetchesInFlight();
    const running = inFlight.get(key);
    if (running) return running;
    const request = withRequestSlot(() => source.request(lat, lon))
      .then(async (hours) => {
        if (!hours || hours.length === 0) {
          failedPoints.add(key);
          return null;
        }
        failedPoints.delete(key);
        const fetchedAt = Date.now();
        await writeCached(lat, lon, hours, fetchedAt);
        return { hours, fetchedAt };
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, request);
    return request;
  }

  async function fetchPoint(lat: number, lon: number, options: FetchOptions = {}): Promise<PointFetch<T>> {
    const cached = await readCached(lat, lon);
    if (cached) {
      const name = fileName(lat, lon);
      const age = Date.now() - cached.fetchedAt;
      const due = options.refreshOlderThanMs;
      if (due != null && age > due) {
        const latest = newest(await revalidate(lat, lon, due), cached)!;
        return { ok: true, hours: latest.hours, fetchedAt: latest.fetchedAt, stale: false };
      }
      const checkedLately = Date.now() - (lastRevalidated.get(name) ?? 0) < REVALIDATE_EVERY_MS;
      if (age > CACHE_TTL_MS && !checkedLately) runInBackground(revalidate(lat, lon, CACHE_TTL_MS));
      return { ok: true, hours: cached.hours, fetchedAt: cached.fetchedAt, stale: false };
    }
    const failed = failedPoints.has(fileName(lat, lon));
    if (options.wait === false || (failed && source.skipFailedPoints)) {
      // A point whose last fetch failed is not waiting on anything: the caller falls back as when it waits.
      runInBackground(refresh(lat, lon));
      return failed ? { ok: false, unavailable: true } : { ok: false, unavailable: true, pending: true };
    }
    const fetched = await refresh(lat, lon);
    if (!fetched) return { ok: false, unavailable: true };
    return { ok: true, hours: fetched.hours, fetchedAt: fetched.fetchedAt, stale: false };
  }

  return { fetch: fetchPoint, readCached };
}

/** How long an edge copy of a series is worth keeping: EDGE_KEEP_MS from its fetch (edgeWrite skips one already past it). */
function edgeSeconds(fetchedAt: number): number {
  return (fetchedAt + EDGE_KEEP_MS - Date.now()) / 1000;
}

function withinTtl(series: { fetchedAt: number }): boolean {
  return Date.now() - series.fetchedAt <= CACHE_TTL_MS;
}

/** A cache file's key in the worker's R2 bucket (and its edge copy). */
function workerKey(name: string): string {
  return `${WORKER_CACHE_PREFIX}${name}`;
}

/** The most recently fetched of the series, or null when there are none. */
function newest<S extends { fetchedAt: number }>(...series: (S | null | undefined)[]): S | null {
  let best: S | null = null;
  for (const item of series) if (item && (!best || item.fetchedAt > best.fetchedAt)) best = item;
  return best;
}

/** GETs an Open-Meteo URL and returns its JSON body, or null on an HTTP error, a timeout or bad JSON. */
export async function fetchOpenMeteoJson(url: string, label: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "dive-current/0.1 (Maldives dive-site forecast prototype)",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) console.warn(`${label} fetch HTTP`, response.status);
      return null;
    }
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/**
 * The request slots. Per request on a worker, so each request there has its own MAX_REQUESTS: a request may only wait
 * on its own fetches.
 */
const requestSlots = perRequest(() => ({ active: 0, waiting: [] as (() => void)[] }));

/** Runs an Open-Meteo request once one of the MAX_REQUESTS slots is free. Shared by every pointFetcher. */
async function withRequestSlot<T>(task: () => Promise<T>): Promise<T> {
  const slots = requestSlots();
  if (slots.active >= MAX_REQUESTS) await new Promise<void>((resolve) => slots.waiting.push(resolve));
  slots.active += 1;
  try {
    return await task();
  } finally {
    slots.active -= 1;
    slots.waiting.shift()?.();
  }
}

/** Open-Meteo requests running now. For tests. */
export function marineRequestsInFlight(): number {
  return requestSlots().active;
}

export function marineHoursFromApi(body: unknown): MarineHour[] | null {
  const hourly = readHourly(body);
  if (!hourly) return null;
  return hourly.time.map((time, index) => ({
    time: String(time),
    seaLevelM: asNumber(hourly.seaLevelM[index]),
    currentVelocityMs: velocityToMs(asNumber(hourly.velocity[index]), hourly.velocityUnit),
    currentDirectionDeg: asNumber(hourly.direction[index]),
  }));
}

function readHourly(body: unknown): HourlyColumns | null {
  if (!body || typeof body !== "object") return null;
  const record = body as {
    error?: boolean;
    hourly_units?: { ocean_current_velocity?: string };
    hourly?: {
      time?: unknown;
      sea_level_height_msl?: unknown;
      ocean_current_velocity?: unknown;
      ocean_current_direction?: unknown;
    };
  };
  if (record.error) return null;

  const hourly = record.hourly;
  const time = hourly?.time;
  const seaLevelM = hourly?.sea_level_height_msl;
  if (!Array.isArray(time) || !Array.isArray(seaLevelM)) return null;

  const velocity = Array.isArray(hourly?.ocean_current_velocity) ? hourly.ocean_current_velocity : [];
  const direction = Array.isArray(hourly?.ocean_current_direction) ? hourly.ocean_current_direction : [];
  return {
    time,
    seaLevelM,
    velocity,
    direction,
    velocityUnit: record.hourly_units?.ocean_current_velocity,
  };
}

async function requestMarine(lat: number, lon: number): Promise<MarineHour[] | null> {
  const query = marineQuery(lat, lon);
  for (const endpoint of MARINE_ENDPOINTS) {
    const body = await fetchOpenMeteoJson(`${endpoint}?${query}`, "Marine");
    const hours = body == null ? null : marineHoursFromApi(body);
    if (hours) return hours;
  }
  return null;
}

function marineQuery(lat: number, lon: number): string {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: "sea_level_height_msl,ocean_current_velocity,ocean_current_direction",
    cell_selection: "sea",
    timezone: "Indian/Maldives",
    past_days: "1",
    // The residual needs 12 hours on each side, so the last 12 fetched hours are never shown.
    // Seven days shows about six and a half ahead, for planning a trip. The current runs to the end of it.
    forecast_days: "7",
  });
  return params.toString();
}

/** A point to four decimals, -0 folded to 0. */
function pointKey(lat: number, lon: number): string {
  return `${(lat === 0 ? 0 : lat).toFixed(4)}_${(lon === 0 ? 0 : lon).toFixed(4)}`;
}

/**
 * A point's marine cache file name. Other series put their prefix before it. The character filter also strips the
 * letters of ".json", so names end in "."; renaming would orphan every cached file.
 */
export function marineCacheName(lat: number, lon: number): string {
  return `${pointKey(lat, lon)}.json`.replace(/[^0-9.+_-]/g, "");
}

/** The pinned benchmark fixtures' name for a point: the same key, ending in ".json". */
export function marineFixtureName(lat: number, lon: number): string {
  return `${pointKey(lat, lon)}.json`;
}

/** A cache file's text read back: null without a numeric fetch time or without hours. */
function parsePointCache<T>(
  raw: string,
  readHours: PointSource<T>["readHours"],
): { fetchedAt: number; hours: T[] } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as { fetchedAt?: unknown; hours?: unknown; body?: unknown };
  if (typeof record.fetchedAt !== "number") return null;
  const hours = readHours(record);
  if (!hours || hours.length === 0) return null;
  return { fetchedAt: record.fetchedAt, hours };
}

/**
 * The hours in a marine cache file. Stored hours are checked one by one (string time, finite-or-null numbers); older
 * files still store the Open-Meteo body, parsed once here.
 */
function marineCacheHours(parsed: { hours?: unknown; body?: unknown }): MarineHour[] | null {
  return storedMarineHours(parsed.hours) ?? ("body" in parsed ? marineHoursFromApi(parsed.body) : null);
}

function storedMarineHours(value: unknown): MarineHour[] | null {
  if (!Array.isArray(value)) return null;
  const hours: MarineHour[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const hour = item as Partial<MarineHour>;
    if (typeof hour.time !== "string") return null;
    hours.push({
      time: hour.time,
      seaLevelM: asNumber(hour.seaLevelM),
      currentVelocityMs: asNumber(hour.currentVelocityMs),
      currentDirectionDeg: asNumber(hour.currentDirectionDeg),
    });
  }
  return hours.length > 0 ? hours : null;
}

/** A marine cache file's text, read exactly as the app reads it. For scripts that read the cache directly. */
export function parseMarineCache(raw: string): { fetchedAt: number; hours: MarineHour[] } | null {
  return parsePointCache(raw, marineCacheHours);
}

const marinePoints = pointFetcher<MarineHour>({
  prefix: "",
  request: requestMarine,
  readHours: marineCacheHours,
  skipFailedPoints: false,
});

/** A point's series from the app's marine cache, read as the app reads it; null when there is none. */
export function readCachedHours(lat: number, lon: number): Promise<{ fetchedAt: number; hours: MarineHour[] } | null> {
  return marinePoints.readCached(lat, lon);
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function velocityToMs(value: number | null, unit: string | undefined): number | null {
  if (value == null) return null;
  if (unit === "m/s") return value;
  if (unit === "kn" || unit === "knots") return value * 0.514444;
  if (unit === "mph") return value * 0.44704;
  // Open-Meteo sends km/h, including when the unit field is missing.
  return value / 3.6;
}

/** Naive times are Maldives wall time. Stale when the newest hour is more than 12 hours before now. */
export function marineSeriesStale(hours: readonly { time: string }[], now = Date.now()): boolean {
  let newest = Number.NEGATIVE_INFINITY;
  for (const hour of hours) {
    const ms = marineHourUtcMs(hour.time);
    if (!Number.isFinite(ms)) continue;
    if (ms > newest) newest = ms;
  }
  if (!Number.isFinite(newest)) return true;
  return now - newest > SERIES_STALE_MS;
}

function marineHourUtcMs(value: string): number {
  if (hasExplicitTimeZone(value)) return new Date(value).getTime();
  const wall = maldivesWallParts(value);
  if (!wall) return Number.NaN;
  const utcMs = Date.UTC(wall.year, wall.monthIndex, wall.day, wall.hour, wall.minute);
  return utcMs - MALDIVES_OFFSET_MS;
}

function hasExplicitTimeZone(value: string): boolean {
  return /[zZ]$|[+-]\d{2}:\d{2}$/.test(value);
}

function maldivesWallParts(
  value: string,
): { year: number; monthIndex: number; day: number; hour: number; minute: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  return {
    year: Number(match[1]),
    monthIndex: Number(match[2]) - 1,
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
}

export function destinationKm(
  lat: number,
  lon: number,
  bearingDeg: number,
  distanceKm: number,
): { lat: number; lon: number } {
  const angular = distanceKm / EARTH_RADIUS_KM;
  const bearing = toRadians(bearingDeg);
  const lat1 = toRadians(lat);
  const lon1 = toRadians(lon);
  const sinLat = Math.sin(lat1);
  const cosLat = Math.cos(lat1);
  const sinAngular = Math.sin(angular);
  const cosAngular = Math.cos(angular);
  const lat2 = Math.asin(sinLat * cosAngular + cosLat * sinAngular * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(Math.sin(bearing) * sinAngular * cosLat, cosAngular - sinLat * Math.sin(lat2));
  return { lat: toDegrees(lat2), lon: wrapLongitude(toDegrees(lon2)) };
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/** Keeps a longitude inside -180 to 180, which is the range the marine request uses. */
export function wrapLongitude(degrees: number): number {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}
