import fs from "fs";
import path from "path";
import type { MarineHour } from "./types";

const DEFAULT_CACHE_DIR = path.join(process.cwd(), "data", "marine-cache");
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SERIES_STALE_MS = 12 * 60 * 60 * 1000;
const MALDIVES_OFFSET_MS = 5 * 60 * 60 * 1000;
const SEAWARD_KM = 3;
/** Open-Meteo requests running at once. Hundreds of sites must not fire hundreds of requests together. */
const MAX_REQUESTS = 4;
const EARTH_RADIUS_KM = 6371;

/** Fetched Open-Meteo hours. MARINE_CACHE_DIR points tests at a throwaway directory. */
export function marineCacheDir(): string {
  return process.env.MARINE_CACHE_DIR || DEFAULT_CACHE_DIR;
}

/**
 * marine-api.open-meteo.com is the live marine host. api.open-meteo.com/v1/marine
 * returns 404 and is the fallback.
 */
const MARINE_ENDPOINTS = [
  "https://marine-api.open-meteo.com/v1/marine",
  "https://api.open-meteo.com/v1/marine",
];

export type MarineFetch =
  | { ok: true; hours: MarineHour[]; fetchedAt: number; stale: boolean }
  | { ok: false; unavailable: true; pending?: true };

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
  const cached = readCachedHours(point.lat, point.lon) ?? readCachedHours(fallbackLat, fallbackLon);
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
};

/**
 * Hours for one point. A cached series is returned at once; if it is past the 6-hour TTL, a refresh runs in the
 * background, so a page never waits on Open-Meteo for a point it has seen before. A point with no cache at all
 * waits for its first fetch, unless the caller asked not to wait.
 */
export async function fetchMarine(lat: number, lon: number, options: FetchOptions = {}): Promise<MarineFetch> {
  const cached = readCachedHours(lat, lon);
  if (cached) {
    if (Date.now() - cached.fetchedAt > CACHE_TTL_MS) void refreshMarine(lat, lon).catch(() => null);
    return { ok: true, hours: cached.hours, fetchedAt: cached.fetchedAt, stale: false };
  }
  if (options.wait === false) {
    // A point whose last fetch failed is not waiting on anything: the caller falls back as when it waits.
    const failed = failedPoints.has(cacheName(lat, lon));
    void refreshMarine(lat, lon).catch(() => null);
    return failed ? { ok: false, unavailable: true } : { ok: false, unavailable: true, pending: true };
  }
  const fetched = await refreshMarine(lat, lon);
  if (!fetched) return { ok: false, unavailable: true };
  return { ok: true, hours: fetched.hours, fetchedAt: fetched.fetchedAt, stale: false };
}

const inFlight = new Map<string, Promise<{ hours: MarineHour[]; fetchedAt: number } | null>>();
/** Points whose last fetch failed, until one succeeds. */
const failedPoints = new Set<string>();

/**
 * Fetches a point and caches it. Callers asking for the same point while it runs share one request, and at most
 * MAX_REQUESTS run at once. A failed fetch leaves the cache as it was.
 */
function refreshMarine(lat: number, lon: number): Promise<{ hours: MarineHour[]; fetchedAt: number } | null> {
  const key = cacheName(lat, lon);
  const running = inFlight.get(key);
  if (running) return running;
  const request = withRequestSlot(() => requestMarine(lat, lon))
    .then((hours) => {
      if (!hours || hours.length === 0) {
        failedPoints.add(key);
        return null;
      }
      failedPoints.delete(key);
      const fetchedAt = Date.now();
      writeCache(lat, lon, hours, fetchedAt);
      return { hours, fetchedAt };
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

let activeRequests = 0;
const waitingRequests: (() => void)[] = [];

async function withRequestSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeRequests >= MAX_REQUESTS) await new Promise<void>((resolve) => waitingRequests.push(resolve));
  activeRequests += 1;
  try {
    return await task();
  } finally {
    activeRequests -= 1;
    waitingRequests.shift()?.();
  }
}

/** Open-Meteo requests running now. For tests. */
export function marineRequestsInFlight(): number {
  return activeRequests;
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
    const hours = await readMarineEndpoint(`${endpoint}?${query}`);
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

async function readMarineEndpoint(url: string): Promise<MarineHour[] | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "dive-current/0.1 (Maldives dive-site forecast prototype)",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) {
        console.warn("Marine fetch HTTP", response.status);
      }
      return null;
    }
    const body: unknown = await response.json();
    return marineHoursFromApi(body);
  } catch {
    return null;
  }
}

function cacheName(lat: number, lon: number): string {
  return `${(lat === 0 ? 0 : lat).toFixed(4)}_${(lon === 0 ? 0 : lon).toFixed(4)}.json`.replace(/[^0-9.+_-]/g, "");
}

function readCachedHours(lat: number, lon: number): { fetchedAt: number; hours: MarineHour[] } | null {
  try {
    const raw = fs.readFileSync(path.join(marineCacheDir(), cacheName(lat, lon)), "utf8");
    const parsed = JSON.parse(raw) as { fetchedAt?: unknown; hours?: unknown; body?: unknown };
    if (typeof parsed.fetchedAt !== "number") return null;
    // Older cache files still store the Open-Meteo body. Parse that once; stored hours are already parsed.
    const hours = Array.isArray(parsed.hours)
      ? (parsed.hours as MarineHour[])
      : "body" in parsed
        ? marineHoursFromApi(parsed.body)
        : null;
    if (!hours || hours.length === 0) return null;
    return { fetchedAt: parsed.fetchedAt, hours };
  } catch {
    return null;
  }
}

function writeCache(lat: number, lon: number, hours: MarineHour[], fetchedAt: number) {
  try {
    fs.mkdirSync(marineCacheDir(), { recursive: true });
    fs.writeFileSync(path.join(marineCacheDir(), cacheName(lat, lon)), JSON.stringify({ fetchedAt, hours }));
  } catch (error) {
    console.warn("Failed to write marine cache", error);
  }
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
export function marineSeriesStale(hours: readonly MarineHour[], now = Date.now()): boolean {
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

function destinationKm(
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
