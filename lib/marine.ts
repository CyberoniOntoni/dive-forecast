import fs from "fs";
import path from "path";
import type { MarineHour } from "./types";

const CACHE_DIR = path.join(process.cwd(), "data", "marine-cache");
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SERIES_STALE_MS = 12 * 60 * 60 * 1000;
const MALDIVES_OFFSET_MS = 5 * 60 * 60 * 1000;
const SEAWARD_KM = 3;
const EARTH_RADIUS_KM = 6371;

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
  | { ok: false; unavailable: true };

type HourlyColumns = {
  time: unknown[];
  seaLevelM: unknown[];
  velocity: unknown[];
  direction: unknown[];
  velocityUnit: string | undefined;
};

/**
 * Open-Meteo at the 3 km seaward point, for both sea level and current.
 * A failed or stale seaward fetch uses the fallback point instead.
 * When both fail or their hours are stale, the cache is used past the 6-hour TTL.
 */
export async function siteMarineHours(
  lat: number,
  lon: number,
  inwardBearingDeg: number,
  fallbackLat: number,
  fallbackLon: number,
): Promise<MarineFetch> {
  const point = seawardPoint(lat, lon, inwardBearingDeg);
  const seaward = await fetchMarine(point.lat, point.lon);
  if (seaward.ok && !marineSeriesStale(seaward.hours)) return freshMarine(seaward);
  const fallback = await fetchMarine(fallbackLat, fallbackLon);
  if (fallback.ok && !marineSeriesStale(fallback.hours)) return freshMarine(fallback);
  const cached = readCachedHours(point.lat, point.lon) ?? readCachedHours(fallbackLat, fallbackLon);
  if (!cached) return { ok: false, unavailable: true };
  return { ok: true, hours: cached.hours, fetchedAt: cached.fetchedAt, stale: true };
}

function freshMarine(fetched: { hours: MarineHour[]; fetchedAt: number }): MarineFetch {
  return { ok: true, hours: fetched.hours, fetchedAt: fetched.fetchedAt, stale: false };
}

/** About 3 km seaward of the site, opposite its inward bearing. */
export function seawardPoint(
  lat: number,
  lon: number,
  inwardBearingDeg: number,
): { lat: number; lon: number } {
  // Opposite the inward bearing. The extra +360 keeps a negative bearing inside 0-360.
  const outwardBearing = ((inwardBearingDeg + 180) % 360 + 360) % 360;
  return destinationKm(lat, lon, outwardBearing, SEAWARD_KM);
}

export async function fetchMarine(lat: number, lon: number): Promise<MarineFetch> {
  const cached = freshCachedFetch(lat, lon);
  if (cached) return cached;

  const hours = await requestMarine(lat, lon);
  if (!hours || hours.length === 0) return { ok: false, unavailable: true };

  const fetchedAt = Date.now();
  writeCache(lat, lon, hours, fetchedAt);
  return { ok: true, hours, fetchedAt, stale: false };
}

function freshCachedFetch(lat: number, lon: number): MarineFetch | null {
  const cached = readFreshCache(lat, lon);
  if (!cached) return null;
  return { ok: true, hours: cached.hours, fetchedAt: cached.fetchedAt, stale: false };
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
    forecast_days: "2",
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

function readFreshCache(lat: number, lon: number): { fetchedAt: number; hours: MarineHour[] } | null {
  const cached = readCachedHours(lat, lon);
  if (!cached || Date.now() - cached.fetchedAt > CACHE_TTL_MS) return null;
  return cached;
}

function cacheName(lat: number, lon: number): string {
  return `${(lat === 0 ? 0 : lat).toFixed(4)}_${(lon === 0 ? 0 : lon).toFixed(4)}.json`.replace(/[^0-9.+_-]/g, "");
}

function readCachedHours(lat: number, lon: number): { fetchedAt: number; hours: MarineHour[] } | null {
  try {
    const raw = fs.readFileSync(path.join(CACHE_DIR, cacheName(lat, lon)), "utf8");
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
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, cacheName(lat, lon)), JSON.stringify({ fetchedAt, hours }));
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
