import fs from "fs";
import path from "path";
import { cacheName, marineCacheDir, marineSeriesStale, withRequestSlot, type FetchOptions } from "./marine";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const WAVE_ENDPOINT = "https://marine-api.open-meteo.com/v1/marine";
/** Every wave cache file starts with this, so it never collides with a sea-level and current file for the same point. */
const CACHE_PREFIX = "waves_";

/** One wave component: significant height in metres, the direction it comes from (0 = from the north), period in seconds. */
export type WaveComponent = { heightM: number; fromDeg: number; periodS: number | null };

/**
 * One hour of Open-Meteo's wave model at a point. Open-Meteo's best match around the Maldives is Météo-France MFWAM,
 * about 9 km. Each component is null when the model has no value for that hour.
 */
export type WaveHour = {
  time: string;
  swell: WaveComponent | null;
  secondarySwell: WaveComponent | null;
  windWave: WaveComponent | null;
};

export type WaveFetch =
  | { ok: true; hours: WaveHour[]; fetchedAt: number; stale: boolean }
  | { ok: false; unavailable: true; pending?: true };

/**
 * Wave hours for one point, cached like fetchMarine: a cached series returns at once and refreshes in the background
 * past six hours; a point with no cache waits for its first fetch unless the caller passes wait: false or that
 * point's last fetch failed.
 * A failed refresh keeps the cached series and marks it stale once its newest hour is twelve hours old.
 */
export async function fetchWaves(lat: number, lon: number, options: FetchOptions = {}): Promise<WaveFetch> {
  const cached = readCachedWaves(lat, lon);
  if (cached) {
    if (Date.now() - cached.fetchedAt > CACHE_TTL_MS) void refreshWaves(lat, lon).catch(() => null);
    return { ok: true, hours: cached.hours, fetchedAt: cached.fetchedAt, stale: marineSeriesStale(cached.hours) };
  }
  // A point whose last fetch failed is not waited on again: the page would sit through the timeout on every view
  // while the wave host is down. It retries in the background instead.
  if (options.wait === false || failedPoints.has(waveCacheName(lat, lon))) {
    const failed = failedPoints.has(waveCacheName(lat, lon));
    void refreshWaves(lat, lon).catch(() => null);
    return failed ? { ok: false, unavailable: true } : { ok: false, unavailable: true, pending: true };
  }
  const fetched = await refreshWaves(lat, lon);
  if (!fetched) return { ok: false, unavailable: true };
  return { ok: true, hours: fetched.hours, fetchedAt: fetched.fetchedAt, stale: false };
}

const inFlight = new Map<string, Promise<{ hours: WaveHour[]; fetchedAt: number } | null>>();
const failedPoints = new Set<string>();

function refreshWaves(lat: number, lon: number): Promise<{ hours: WaveHour[]; fetchedAt: number } | null> {
  const key = waveCacheName(lat, lon);
  const running = inFlight.get(key);
  if (running) return running;
  const request = withRequestSlot(() => requestWaves(lat, lon))
    .then((hours) => {
      if (!hours || hours.length === 0) {
        failedPoints.add(key);
        return null;
      }
      failedPoints.delete(key);
      const fetchedAt = Date.now();
      writeCachedWaves(lat, lon, hours, fetchedAt);
      return { hours, fetchedAt };
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

async function requestWaves(lat: number, lon: number): Promise<WaveHour[] | null> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: [
      "swell_wave_height",
      "swell_wave_direction",
      "swell_wave_period",
      "secondary_swell_wave_height",
      "secondary_swell_wave_direction",
      "secondary_swell_wave_period",
      "wind_wave_height",
      "wind_wave_direction",
      "wind_wave_period",
    ].join(","),
    cell_selection: "sea",
    timezone: "Indian/Maldives",
    // The same days as the current series, so every forecast hour has its sea state.
    past_days: "1",
    forecast_days: "7",
  });
  try {
    const response = await fetch(`${WAVE_ENDPOINT}?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "dive-current/0.1 (Maldives dive-site forecast prototype)",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) console.warn("Wave fetch HTTP", response.status);
      return null;
    }
    return waveHoursFromApi(await response.json());
  } catch {
    return null;
  }
}

/** Open-Meteo's hourly wave columns as hours, or null when the body is an error or has no time column. */
export function waveHoursFromApi(body: unknown): WaveHour[] | null {
  if (!body || typeof body !== "object") return null;
  const record = body as { error?: boolean; hourly?: Record<string, unknown> };
  if (record.error) return null;
  const hourly = record.hourly;
  if (!hourly || !Array.isArray(hourly.time)) return null;
  const column = (name: string): unknown[] => (Array.isArray(hourly[name]) ? (hourly[name] as unknown[]) : []);
  const component = (prefix: string, index: number): WaveComponent | null => {
    const heightM = asNumber(column(`${prefix}_height`)[index]);
    const fromDeg = asNumber(column(`${prefix}_direction`)[index]);
    if (heightM == null || fromDeg == null) return null;
    return { heightM, fromDeg, periodS: asNumber(column(`${prefix}_period`)[index]) };
  };
  return hourly.time.map((time, index) => ({
    time: String(time),
    swell: component("swell_wave", index),
    secondarySwell: component("secondary_swell_wave", index),
    windWave: component("wind_wave", index),
  }));
}

function waveCacheName(lat: number, lon: number): string {
  return `${CACHE_PREFIX}${cacheName(lat, lon)}`;
}

function readCachedWaves(lat: number, lon: number): { fetchedAt: number; hours: WaveHour[] } | null {
  try {
    const raw = fs.readFileSync(path.join(marineCacheDir(), waveCacheName(lat, lon)), "utf8");
    const parsed = JSON.parse(raw) as { fetchedAt?: unknown; hours?: unknown };
    if (typeof parsed.fetchedAt !== "number" || !Array.isArray(parsed.hours) || parsed.hours.length === 0) return null;
    return { fetchedAt: parsed.fetchedAt, hours: parsed.hours as WaveHour[] };
  } catch {
    return null;
  }
}

function writeCachedWaves(lat: number, lon: number, hours: WaveHour[], fetchedAt: number) {
  try {
    fs.mkdirSync(marineCacheDir(), { recursive: true });
    fs.writeFileSync(path.join(marineCacheDir(), waveCacheName(lat, lon)), JSON.stringify({ fetchedAt, hours }));
  } catch (error) {
    console.warn("Failed to write wave cache", error);
  }
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
