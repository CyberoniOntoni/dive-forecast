import fs from "fs";
import os from "os";
import path from "path";
import { marineHoursFromApi } from "../lib/marine";
import type { MarineHour } from "../lib/types";

/**
 * About 99 days of ocean data for one point (92 past days and 7 ahead: the longest the marine API gives), for the
 * calibration scripts. Cached under the OS temp directory, so the app's six-hour cache is not touched.
 */
const CACHE_DIR = path.join(os.tmpdir(), "dive-current-strength-calibrate");
const MAX_REQUESTS = 4;

export async function longSeries(lat: number, lon: number): Promise<MarineHour[] | null> {
  const file = path.join(CACHE_DIR, `${lat.toFixed(4)}_${lon.toFixed(4)}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as MarineHour[];
  } catch {
    // Not cached yet.
  }
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: "sea_level_height_msl,ocean_current_velocity,ocean_current_direction",
    cell_selection: "sea",
    timezone: "Indian/Maldives",
    past_days: "92",
    forecast_days: "7",
  });
  const response = await fetch(`https://marine-api.open-meteo.com/v1/marine?${params}`);
  if (!response.ok) return null;
  const hours = marineHoursFromApi(await response.json());
  if (!hours || hours.length === 0) return null;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(hours));
  return hours;
}

/** Runs tasks with at most MAX_REQUESTS at once, keeping their order. */
export async function limited<T>(tasks: (() => Promise<T>)[]): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: MAX_REQUESTS }, async () => {
      while (next < tasks.length) {
        const index = next;
        next += 1;
        results[index] = await tasks[index]();
      }
    }),
  );
  return results;
}

