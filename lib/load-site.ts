import fs from "fs";
import path from "path";
import { resolveBearing } from "./bearing";
import { rimForAtoll } from "./rim";
import { atollRingLevel } from "./atoll-ring";
import { alongReefHours, forecastHours, headWindowAt, residualRangeAt, residualSlopeWindow, throughflowAt } from "./forecast";
import { alongReefHeading, flowsAlongReef } from "./site-type";
import { marineSeriesStale, siteMarineHours, type FetchOptions } from "./marine";
import type { Atoll, BearingSource, HourForecast, MarineHour, Report, RingLevel, Site, SiteType } from "./types";

const REPLAY_PATH = path.join(process.cwd(), "data", "replay.json");

export type SiteLoad = {
  bearing: number | null;
  bearingSource: BearingSource | null;
  /** Where the site sits, when classified. A lagoon site never shows high confidence. */
  siteType: SiteType | null;
  /**
   * Set for a wall whose current runs along the reef: the compass heading its "incoming" means. Null for a site
   * whose current crosses the rim, where incoming follows the inward bearing.
   */
  alongHeadingDeg: number | null;
  hours: HourForecast[];
  unavailable: boolean;
  stale: boolean;
  fetchedAt: number | null;
};

function unavailableLoad(
  bearing: number | null,
  bearingSource: BearingSource | null,
  siteType: SiteType | null,
  alongHeadingDeg: number | null,
): SiteLoad {
  return { bearing, bearingSource, siteType, alongHeadingDeg, hours: [], unavailable: true, stale: false, fetchedAt: null };
}

function forecastedLoad(
  bearing: number,
  bearingSource: BearingSource,
  marineHours: MarineHour[],
  reports: readonly Report[],
  fetchedAt: number,
  stale: boolean,
  site: Site,
  alongHeadingDeg: number | null,
  ringLevel: readonly RingLevel[] | undefined,
): SiteLoad {
  const siteType = site.siteType ?? null;
  if (alongHeadingDeg != null) {
    const hours = alongReefHours({ hours: marineHours, alongHeadingDeg });
    return { bearing, bearingSource, siteType, alongHeadingDeg, hours, unavailable: false, stale, fetchedAt };
  }
  // The model follows the ocean tide through the passes. Inside the lagoon it is never that sure.
  const allowHigh = replayAllowsHigh() && siteType !== "lagoon";
  const hours = forecastHours({
    hours: marineHours,
    inwardBearingDeg: bearing,
    reports,
    ringLevel,
    channelWidthM: site.channelWidthM,
    channelDepthM: site.channelDepthM,
    ...(allowHigh ? {} : { allowHighConfidence: false }),
  });
  return { bearing, bearingSource, siteType, alongHeadingDeg, hours, unavailable: false, stale, fetchedAt };
}

/**
 * The atoll's ring level for a site whose current crosses the rim, so the head across the atoll drives it.
 * None for a wall running along the reef or a lagoon site, where there is no channel between ocean and lagoon.
 */
async function ringLevelFor(
  site: Site,
  atoll: Atoll | undefined,
  alongHeadingDeg: number | null,
  options: FetchOptions = {},
): Promise<RingLevel[] | undefined> {
  if (!atoll || alongHeadingDeg != null || site.siteType === "lagoon") return undefined;
  const level = await atollRingLevel(atoll, options);
  return level.length > 0 ? level : undefined;
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
  options: FetchOptions = {},
): Promise<CheckedMarine> {
  if (!atoll) return { ok: false, bearing: null, bearingSource: null };

  const outside = { lat: atoll.oceanLat, lon: atoll.oceanLon };
  const { deg: bearing, source: bearingSource } = resolveBearing(site, mates, outside, rimForAtoll(atoll));
  const marine = await siteMarineHours(site.lat, site.lon, bearing, outside.lat, outside.lon, options);
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

/** The reef heading "incoming" means at a wall whose current runs along the reef; null elsewhere or with no atoll. */
export function alongHeadingFor(site: Site, mates: readonly Site[], atoll: Atoll | undefined): number | null {
  if (!atoll || !flowsAlongReef(site, mates)) return null;
  const outside = { lat: atoll.oceanLat, lon: atoll.oceanLon };
  return alongReefHeading(resolveBearing(site, mates, outside, rimForAtoll(atoll)).deg);
}

/** Inward bearing, marine fetch, and forecast hours. A missing atoll or cache is unavailable. */
export async function loadSite(
  site: Site,
  mates: readonly Site[],
  atoll: Atoll | undefined,
  reports: readonly Report[],
  options: FetchOptions = {},
): Promise<SiteLoad> {
  const marine = await checkedMarine(site, mates, atoll, options);
  const along = marine.bearing != null && flowsAlongReef(site, mates) ? alongReefHeading(marine.bearing) : null;
  if (!marine.ok) return unavailableLoad(marine.bearing, marine.bearingSource, site.siteType ?? null, along);
  return forecastedLoad(
    marine.bearing,
    marine.bearingSource,
    marine.hours,
    reports,
    marine.fetchedAt,
    marine.stale,
    site,
    along,
    await ringLevelFor(site, atoll, along, options),
  );
}

export type ReportTide = {
  slopeWindowM: (number | null)[];
  /** Residual range over the 25 hours around the report hour. Null when that hour has no full window. */
  rangeM: number | null;
  /** Through-flow at the report hour, residual metres per hour. Null when that hour is missing. */
  throughflowM: number | null;
  /** Head drive round the report hour, aligned with slopeWindowM. Null where the site has no ring level. */
  headWindowM: number[] | null;
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
  const along = flowsAlongReef(site, mates) ? alongReefHeading(marine.bearing) : null;
  const ring = await ringLevelFor(site, atoll, along);
  return {
    headWindowM: headWindowAt(marine.hours, time, ring),
    slopeWindowM,
    rangeM: residualRangeAt(marine.hours, time),
    throughflowM: throughflowAt(marine.hours, time, marine.bearing),
  };
}
