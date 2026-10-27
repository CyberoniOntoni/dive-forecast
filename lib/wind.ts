import { fetchOpenMeteoJson, marineSeriesStale, pointFetcher, type FetchOptions, type PointFetch } from "./marine";

const WIND_ENDPOINT = "https://api.open-meteo.com/v1/forecast";

/** One hour of Open-Meteo's 10 m wind at a point: speed in m/s and the direction it blows from (0 = from the north). */
export type WindHour = { time: string; speedMs: number; fromDeg: number };

export type WindFetch = PointFetch<WindHour>;

/** Wind cache files start with "wind_", beside the sea-level and wave files for the same point. */
const windPoints = pointFetcher<WindHour>({
  prefix: "wind_",
  request: requestWind,
  readHours: (parsed) => (Array.isArray(parsed.hours) ? (parsed.hours as WindHour[]) : null),
  // Extra on the site page, like the waves: a failed point retries in the background rather than being waited on.
  skipFailedPoints: true,
});

/** Wind hours for one point, through the shared per-point cache (pointFetcher in marine.ts). */
export async function fetchWind(lat: number, lon: number, options: FetchOptions = {}): Promise<WindFetch> {
  const fetched = await windPoints.fetch(lat, lon, options);
  return fetched.ok ? { ...fetched, stale: marineSeriesStale(fetched.hours) } : fetched;
}

async function requestWind(lat: number, lon: number): Promise<WindHour[] | null> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: "wind_speed_10m,wind_direction_10m",
    wind_speed_unit: "ms",
    timezone: "Indian/Maldives",
    // The same days as the current and wave series.
    past_days: "1",
    forecast_days: "7",
  });
  const body = await fetchOpenMeteoJson(`${WIND_ENDPOINT}?${params.toString()}`, "Wind");
  return body == null ? null : windHoursFromApi(body);
}

/** Open-Meteo's hourly wind columns as hours, leaving out hours with no speed or direction. Null on an error body. */
export function windHoursFromApi(body: unknown): WindHour[] | null {
  if (!body || typeof body !== "object") return null;
  const record = body as { error?: boolean; hourly?: Record<string, unknown> };
  if (record.error) return null;
  const hourly = record.hourly;
  if (!hourly || !Array.isArray(hourly.time)) return null;
  const column = (name: string): unknown[] => (Array.isArray(hourly[name]) ? (hourly[name] as unknown[]) : []);
  const speeds = column("wind_speed_10m");
  const directions = column("wind_direction_10m");
  return hourly.time.flatMap((time, index) => {
    const speedMs = speeds[index];
    const fromDeg = directions[index];
    if (typeof speedMs !== "number" || !Number.isFinite(speedMs) || typeof fromDeg !== "number" || !Number.isFinite(fromDeg)) {
      return [];
    }
    return [{ time: String(time), speedMs, fromDeg }];
  });
}
