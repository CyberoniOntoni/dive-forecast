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
  stale: boolean;
  fetchedAt: number | null;
};

function unavailableLoad(bearing: number | null): SiteLoad {
  return { bearing, hours: [], unavailable: true, stale: false, fetchedAt: null };
}

function forecastedLoad(
  bearing: number,
  marineHours: MarineHour[],
  reports: readonly Report[],
  fetchedAt: number,
  stale: boolean,
): SiteLoad {
  const hours = forecastHours({
    hours: marineHours,
    inwardBearingDeg: bearing,
    reports,
    ...(replayAllowsHigh() ? {} : { allowHighConfidence: false }),
  });
  return { bearing, hours, unavailable: false, stale, fetchedAt };
}

/** Missing, unreadable, or unparseable replay.json or ok true keeps the forecast default. ok false blocks high. */
function replayAllowsHigh(): boolean {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(REPLAY_PATH, "utf8"));
    if (!parsed || typeof parsed !== "object") return true;
    return (parsed as { ok?: unknown }).ok !== false;
  } catch {
    return true;
  }
}

type CheckedMarine =
  | { ok: true; bearing: number; hours: MarineHour[]; fetchedAt: number; stale: boolean }
  | { ok: false; bearing: number | null };

/** Inward bearing and marine fetch. No cache is not ok. A stale series still has hours. A missing atoll has no bearing. */
async function checkedMarine(
  site: Site,
  mates: readonly Site[],
  atoll: Atoll | undefined,
): Promise<CheckedMarine> {
  if (!atoll) return { ok: false, bearing: null };

  const outside = { lat: atoll.oceanLat, lon: atoll.oceanLon };
  const bearing = inwardBearingDeg(site, mates, outside);
  const marine = await siteMarineHours(site.lat, site.lon, bearing, outside.lat, outside.lon);
  if (!marine.ok) return { ok: false, bearing };

  return {
    ok: true,
    bearing,
    hours: marine.hours,
    fetchedAt: marine.fetchedAt,
    stale: marine.stale || marineSeriesStale(marine.hours),
  };
}

/** Inward bearing, marine fetch, and forecast hours. A missing atoll or cache is unavailable. */
export async function loadSite(
  site: Site,
  mates: readonly Site[],
  atoll: Atoll | undefined,
  reports: readonly Report[],
): Promise<SiteLoad> {
  const marine = await checkedMarine(site, mates, atoll);
  if (!marine.ok) return unavailableLoad(marine.bearing);
  return forecastedLoad(marine.bearing, marine.hours, reports, marine.fetchedAt, marine.stale);
}

/** Same fetch as loadSite. Residual slope window, or null when no cache exists. */
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
