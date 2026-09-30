import fs from "fs";
import path from "path";
import { resolveBearing } from "./bearing";
import { rimForAtoll } from "./rim";
import { forecastHours, residualRangeAt, residualSlopeWindow } from "./forecast";
import { marineSeriesStale, siteMarineHours } from "./marine";
import type { Atoll, BearingSource, HourForecast, MarineHour, Report, Site, SiteType } from "./types";

const REPLAY_PATH = path.join(process.cwd(), "data", "replay.json");

export type SiteLoad = {
  bearing: number | null;
  bearingSource: BearingSource | null;
  /** Where the site sits, when classified. A lagoon site never shows high confidence. */
  siteType: SiteType | null;
  hours: HourForecast[];
  unavailable: boolean;
  stale: boolean;
  fetchedAt: number | null;
};

function unavailableLoad(
  bearing: number | null,
  bearingSource: BearingSource | null,
  siteType: SiteType | null,
): SiteLoad {
  return { bearing, bearingSource, siteType, hours: [], unavailable: true, stale: false, fetchedAt: null };
}

function forecastedLoad(
  bearing: number,
  bearingSource: BearingSource,
  marineHours: MarineHour[],
  reports: readonly Report[],
  fetchedAt: number,
  stale: boolean,
  site: Site,
): SiteLoad {
  const siteType = site.siteType ?? null;
  // The model follows the ocean tide through the passes. Inside the lagoon it is never that sure.
  const allowHigh = replayAllowsHigh() && siteType !== "lagoon";
  const hours = forecastHours({
    hours: marineHours,
    inwardBearingDeg: bearing,
    reports,
    channelWidthM: site.channelWidthM,
    channelDepthM: site.channelDepthM,
    ...(allowHigh ? {} : { allowHighConfidence: false }),
  });
  return { bearing, bearingSource, siteType, hours, unavailable: false, stale, fetchedAt };
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
  | { ok: true; bearing: number; bearingSource: BearingSource; hours: MarineHour[]; fetchedAt: number; stale: boolean }
  | { ok: false; bearing: number | null; bearingSource: BearingSource | null };

/** Inward bearing and marine fetch. No cache is not ok. A stale series still has hours. A missing atoll has no bearing. */
async function checkedMarine(
  site: Site,
  mates: readonly Site[],
  atoll: Atoll | undefined,
): Promise<CheckedMarine> {
  if (!atoll) return { ok: false, bearing: null, bearingSource: null };

  const outside = { lat: atoll.oceanLat, lon: atoll.oceanLon };
  const { deg: bearing, source: bearingSource } = resolveBearing(site, mates, outside, rimForAtoll(atoll));
  const marine = await siteMarineHours(site.lat, site.lon, bearing, outside.lat, outside.lon);
  if (!marine.ok) return { ok: false, bearing, bearingSource };

  return {
    ok: true,
    bearing,
    bearingSource,
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
  if (!marine.ok) return unavailableLoad(marine.bearing, marine.bearingSource, site.siteType ?? null);
  return forecastedLoad(
    marine.bearing,
    marine.bearingSource,
    marine.hours,
    reports,
    marine.fetchedAt,
    marine.stale,
    site,
  );
}

export type ReportTide = {
  slopeWindowM: (number | null)[];
  /** Residual range over the 25 hours around the report hour. Null when that hour has no full window. */
  rangeM: number | null;
};

/** Same fetch as loadSite. The tide saved with a report, or null when there is no series. */
export async function reportTideForSite(
  site: Site,
  mates: readonly Site[],
  atoll: Atoll | undefined,
  time: string,
): Promise<ReportTide | null> {
  const marine = await checkedMarine(site, mates, atoll);
  if (!marine.ok) return null;
  const slopeWindowM = residualSlopeWindow(marine.hours, time);
  if (!slopeWindowM) return null;
  return { slopeWindowM, rangeM: residualRangeAt(marine.hours, time) };
}
