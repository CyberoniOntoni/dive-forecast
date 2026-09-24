import fs from "fs";
import path from "path";
import type { MarineHour } from "./types";

const CACHE_DIR = path.join(process.cwd(), "data", "marine-cache");
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * api.open-meteo.com/v1/marine returns 404. The marine API is served at
 * marine-api.open-meteo.com, so a miss there falls back to the live host.
 */
const MARINE_ENDPOINTS = [
  "https://api.open-meteo.com/v1/marine",
  "https://marine-api.open-meteo.com/v1/marine",
];

export type MarineFetch =
  | { ok: true; hours: MarineHour[]; fetchedAt: number }
  | { ok: false; unavailable: true };

type CacheEnvelope = {
  fetchedAt: number;
  body: unknown;
};

export async function fetchMarine(lat: number, lon: number): Promise<MarineFetch> {
  const cached = readFreshCache(lat, lon);
  if (cached) {
    const hours = marineHoursFromApi(cached.body);
    if (hours && hours.length > 0) return { ok: true, hours, fetchedAt: cached.fetchedAt };
  }

  const body = await requestMarine(lat, lon);
  if (!body) return { ok: false, unavailable: true };
  const hours = marineHoursFromApi(body);
  if (!hours || hours.length === 0) return { ok: false, unavailable: true };
  const fetchedAt = Date.now();
  writeCache(lat, lon, body, fetchedAt);
  return { ok: true, hours, fetchedAt };
}

export function marineHoursFromApi(body: unknown): MarineHour[] | null {
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
  const times = hourly?.time;
  const levels = hourly?.sea_level_height_msl;
  if (!Array.isArray(times) || !Array.isArray(levels)) return null;
  const velocityUnit = record.hourly_units?.ocean_current_velocity;
  const velocity = Array.isArray(hourly?.ocean_current_velocity) ? hourly.ocean_current_velocity : [];
  const direction = Array.isArray(hourly?.ocean_current_direction) ? hourly.ocean_current_direction : [];
  return times.map((time, index) => ({
    time: String(time),
    seaLevelM: asNumber(levels[index]),
    currentVelocityMs: velocityToMs(asNumber(velocity[index]), velocityUnit),
    currentDirectionDeg: asNumber(direction[index]),
  }));
}

async function requestMarine(lat: number, lon: number): Promise<unknown | null> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: "sea_level_height_msl,ocean_current_velocity,ocean_current_direction",
    cell_selection: "sea",
    timezone: "Indian/Maldives",
    past_days: "1",
    forecast_days: "2",
  });
  for (const endpoint of MARINE_ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}?${params.toString()}`, {
        headers: {
          Accept: "application/json",
          "User-Agent": "dive-current/0.1 (Maldives dive-site forecast prototype)",
        },
      });
      if (!response.ok) continue;
      const body: unknown = await response.json();
      if (marineHoursFromApi(body)) return body;
    } catch {
      continue;
    }
  }
  return null;
}

function readFreshCache(lat: number, lon: number): CacheEnvelope | null {
  try {
    const raw = fs.readFileSync(cachePath(lat, lon), "utf8");
    const parsed = JSON.parse(raw) as CacheEnvelope;
    if (typeof parsed.fetchedAt !== "number") return null;
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(lat: number, lon: number, body: unknown, fetchedAt: number) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const envelope: CacheEnvelope = { fetchedAt, body };
  fs.writeFileSync(cachePath(lat, lon), JSON.stringify(envelope));
}

function cachePath(lat: number, lon: number): string {
  const name = `${lat.toFixed(4)}_${lon.toFixed(4)}.json`.replace(/[^0-9.+_-]/g, "");
  return path.join(CACHE_DIR, name);
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function velocityToMs(value: number | null, unit: string | undefined): number | null {
  if (value == null) return null;
  switch (unit) {
    case "m/s":
      return value;
    case "kn":
    case "knots":
      return value * 0.514444;
    case "mph":
      return value * 0.44704;
    case "km/h":
    default:
      return value / 3.6;
  }
}

const SERIES_STALE_MS = 12 * 60 * 60 * 1000;
const MALDIVES_OFFSET_MS = 5 * 60 * 60 * 1000;

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
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(value)) return new Date(value).getTime();
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value);
  if (!match) return Number.NaN;
  return Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]) - MALDIVES_OFFSET_MS;
}

const SEAWARD_KM = 3;

/** About 3 km seaward of the site, opposite its inward bearing. */
export function seawardPoint(
  lat: number,
  lon: number,
  inwardBearingDeg: number,
): { lat: number; lon: number } {
  const outward = ((inwardBearingDeg + 180) % 360 + 360) % 360;
  return destinationKm(lat, lon, outward, SEAWARD_KM);
}

/**
 * Open-Meteo at the 3 km seaward point, for both sea level and current.
 * A failed or stale seaward fetch uses the fallback point instead.
 */
export async function siteMarineHours(
  lat: number,
  lon: number,
  inwardBearingDeg: number,
  fallbackLat: number,
  fallbackLon: number,
): Promise<MarineFetch> {
  const point = seawardPoint(lat, lon, inwardBearingDeg);
  const sampled = await fetchMarine(point.lat, point.lon);
  if (sampled.ok && !marineSeriesStale(sampled.hours)) return sampled;
  return fetchMarine(fallbackLat, fallbackLon);
}

function destinationKm(
  lat: number,
  lon: number,
  bearingDeg: number,
  distanceKm: number,
): { lat: number; lon: number } {
  const angular = distanceKm / 6371;
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: (lat2 * 180) / Math.PI, lon: ((lon2 * 180) / Math.PI + 540) % 360 - 180 };
}

