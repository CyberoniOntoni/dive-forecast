import fs from "fs";
import path from "path";
import { inwardBearingDeg } from "./bearing";
import { forecastHours, residualSlopeWindow } from "./forecast";
import { marineSeriesStale, siteMarineHours } from "./marine";
import type { Atoll, HourForecast, MarineHour, Report, Site } from "./types";

const REPLAY_PATH = path.join(process.cwd(), "data", "replay.json");

export type SiteLoad = {
  bearing: number | null;
  hours: HourForecast[];
  unavailable: boolean;
  fetchedAt: number | null;
};

function unavailableLoad(bearing: number | null): SiteLoad {
  return { bearing, hours: [], unavailable: true, fetchedAt: null };
}

function forecastedLoad(
  bearing: number,
  marineHours: MarineHour[],
  reports: readonly Report[],
  fetchedAt: number,
): SiteLoad {
  const hours = forecastHours({
    hours: marineHours,
    inwardBearingDeg: bearing,
    reports,
    ...(replayAllowsHigh() ? {} : { allowHighConfidence: false }),
  });
  return { bearing, hours, unavailable: false, fetchedAt };
}

/** Missing replay.json or ok true keeps the forecast default. ok false blocks high. */
function replayAllowsHigh(): boolean {
  let raw: string;
  try {
    raw = fs.readFileSync(REPLAY_PATH, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") return true;
  return (parsed as { ok?: unknown }).ok !== false;
}

type CheckedMarine =
  | { ok: true; bearing: number; hours: MarineHour[]; fetchedAt: number }
  | { ok: false; bearing: number | null };

/** Inward bearing and marine fetch. A stale or failed series is not ok. A missing atoll has no bearing. */
async function checkedMarine(
  site: Site,
  mates: readonly Site[],
  atoll: Atoll | undefined,
): Promise<CheckedMarine> {
  if (!atoll) return { ok: false, bearing: null };

  const outside = { lat: atoll.oceanLat, lon: atoll.oceanLon };
  const bearing = inwardBearingDeg(site, mates, outside);
  const marine = await siteMarineHours(site.lat, site.lon, bearing, outside.lat, outside.lon);
  if (!marine.ok || marineSeriesStale(marine.hours)) return { ok: false, bearing };

  return { ok: true, bearing, hours: marine.hours, fetchedAt: marine.fetchedAt };
}

/** Inward bearing, marine fetch, one stale check, and forecast hours. A missing atoll is unavailable. */
export async function loadSite(
  site: Site,
  mates: readonly Site[],
  atoll: Atoll | undefined,
  reports: readonly Report[],
): Promise<SiteLoad> {
  const marine = await checkedMarine(site, mates, atoll);
  if (!marine.ok) return unavailableLoad(marine.bearing);
  return forecastedLoad(marine.bearing, marine.hours, reports, marine.fetchedAt);
}

/** Same fetch and stale check as loadSite. Residual slope window, or null. */
export async function slopeWindowForSite(
  site: Site,
  mates: readonly Site[],
  atoll: Atoll | undefined,
  time: string,
): Promise<(number | null)[] | null> {
  const marine = await checkedMarine(site, mates, atoll);
  if (!marine.ok) return null;
  return residualSlopeWindow(marine.hours, time);
}
