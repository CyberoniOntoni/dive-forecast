import { fetchOpenMeteoJson, marineSeriesStale, pointFetcher, type FetchOptions, type PointFetch } from "./marine";

const WAVE_ENDPOINT = "https://marine-api.open-meteo.com/v1/marine";

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

export type WaveFetch = PointFetch<WaveHour>;

/** Wave cache files start with "waves_", so they never collide with a sea-level and current file for the same point. */
const wavePoints = pointFetcher<WaveHour>({
  prefix: "waves_",
  request: requestWaves,
  readHours: (parsed) => (Array.isArray(parsed.hours) ? (parsed.hours as WaveHour[]) : null),
  // The sea state is extra on the site page: while the wave host is down a page must not sit through the timeout on
  // every view, so a failed point retries in the background instead of being waited on.
  skipFailedPoints: true,
});

/**
 * Wave hours for one point, through the same cache and refresh as the sea-level series (pointFetcher in marine.ts),
 * except that a point whose last fetch failed is not waited on again. Stale once the newest hour is twelve hours old.
 */
export async function fetchWaves(lat: number, lon: number, options: FetchOptions = {}): Promise<WaveFetch> {
  const fetched = await wavePoints.fetch(lat, lon, options);
  return fetched.ok ? { ...fetched, stale: marineSeriesStale(fetched.hours) } : fetched;
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
  const body = await fetchOpenMeteoJson(`${WAVE_ENDPOINT}?${params.toString()}`, "Wave");
  return body == null ? null : waveHoursFromApi(body);
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

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
