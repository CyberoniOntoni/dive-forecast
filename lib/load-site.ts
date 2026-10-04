import fs from "fs";
import path from "path";
import { resolveBearing } from "./bearing";
import { rimForAtoll } from "./rim";
import { atollRing, atollRingLevel } from "./atoll-ring";
import {
  alongReefHours,
  straitHours,
  forecastHours,
  headWindowAt,
  residualLevels,
  residualRangeAt,
  residualSlopeWindow,
  sectionInput,
  throughflowAt,
} from "./forecast";
import { channelSource, lagoonHours, lagoonSink, rimSources, type LagoonSink, type LagoonSource } from "./lagoon-flow";
import { alongReefHeading, crossesRim, flowsAlongReef, straitHeading } from "./site-type";
import { marineSeriesStale, siteMarineHours, type FetchOptions } from "./marine";
import { seawardKmFor } from "./seaward-floor";
import type { Atoll, BearingSource, HourForecast, MarineHour, Report, RingLevel, Site, SiteType } from "./types";

const REPLAY_PATH = path.join(process.cwd(), "data", "replay.json");

export type SiteLoad = {
  bearing: number | null;
  bearingSource: BearingSource | null;
  /** Where the site sits, when classified. A lagoon site never shows high confidence. */
  siteType: SiteType | null;
  /**
   * Set for a site forecast along a compass axis: a wall whose current runs along the reef, or a lagoon site (the
   * main axis of its lagoon flow). The heading its "incoming" means. Null for a site whose current crosses the rim,
   * where incoming follows the inward bearing.
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
    ...sectionInput(site),
    ...(allowHigh ? {} : { allowHighConfidence: false }),
  });
  return { bearing, bearingSource, siteType, alongHeadingDeg, hours, unavailable: false, stale, fetchedAt };
}

const LAGOON_MEMO_MS = 10 * 60 * 1000;
const lagoonMemo = new Map<string, { at: number; sources: LagoonSource[] }>();
const lagoonLoading = new Map<string, Promise<LagoonSource[]>>();
const sinkMemo = new Map<string, LagoonSink>();

/**
 * The openings of an atoll's lagoon: its porous rim from the ring points, and each channel dive site (pass, channel
 * thila, corner) with its own net flow. Empty when the atoll has no ring level yet. Kept ten minutes per atoll and
 * shared by every lagoon site asking at once.
 */
async function lagoonSources(atoll: Atoll, mates: readonly Site[], options: FetchOptions): Promise<LagoonSource[]> {
  const kept = lagoonMemo.get(atoll.id);
  if (kept && Date.now() - kept.at < LAGOON_MEMO_MS && kept.sources.length > 0) return kept.sources;
  const running = lagoonLoading.get(atoll.id);
  if (running) return running;
  const load = (async () => {
    const ring = await atollRing(atoll, options);
    if (ring.level.length === 0) return [];
    const rim = rimForAtoll(atoll);
    const outside = { lat: atoll.oceanLat, lon: atoll.oceanLon };
    const channels = mates.filter(
      (mate) => mate.atollId === atoll.id && crossesRim(mate, mates),
    );
    const fetched = await Promise.all(
      channels.map(async (channel) => {
        const { deg } = resolveBearing(channel, mates, outside, rim);
        const marine = await siteMarineHours(channel.lat, channel.lon, deg, outside.lat, outside.lon, {
          ...options,
          seawardKm: seawardKmFor(channel.id),
        });
        return marine.ok ? channelSource(channel, marine.hours, deg, ring.level) : null;
      }),
    );
    const sources = [...rimSources(ring), ...fetched.filter((source): source is LagoonSource => source != null)];
    lagoonMemo.set(atoll.id, { at: Date.now(), sources });
    return sources;
  })().finally(() => lagoonLoading.delete(atoll.id));
  lagoonLoading.set(atoll.id, load);
  return load;
}

/**
 * A lagoon site's hours from the flow between the rim's openings, or null when the atoll has no outline or ring
 * yet, so the site keeps the channel model until it has one.
 */
async function lagoonLoad(
  site: Site,
  mates: readonly Site[],
  atoll: Atoll,
  marineHours: readonly MarineHour[],
  options: FetchOptions,
): Promise<{ hours: HourForecast[]; axisDeg: number } | null> {
  const rim = rimForAtoll(atoll);
  if (!rim) return null;
  const sources = await lagoonSources(atoll, mates, options);
  if (sources.length === 0) return null;
  const sinkKey = `${atoll.rimSourceUrl}|${site.id}|${site.lat}|${site.lon}`;
  let sink = sinkMemo.get(sinkKey);
  if (!sink) {
    sink = lagoonSink(site, rim);
    sinkMemo.set(sinkKey, sink);
  }
  const residual = residualLevels(marineHours);
  const levels = marineHours.flatMap((hour, index) => {
    const level = residual[index];
    return level == null ? [] : [{ time: hour.time, levelM: level }];
  });
  const forecast = lagoonHours(site, sources, levels, sink);
  return forecast.axisDeg == null || forecast.hours.length === 0 ? null : { hours: forecast.hours, axisDeg: forecast.axisDeg };
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
  if (!atoll || alongHeadingDeg != null || site.siteType === "lagoon" || site.siteType === "strait-wall") return undefined;
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
  const marine = await siteMarineHours(site.lat, site.lon, bearing, outside.lat, outside.lon, {
    ...options,
    seawardKm: seawardKmFor(site.id),
  });
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
  if (!atoll) return null;
  const strait = site.siteType === "strait-wall";
  if (!strait && !flowsAlongReef(site, mates)) return null;
  const outside = { lat: atoll.oceanLat, lon: atoll.oceanLon };
  const deg = resolveBearing(site, mates, outside, rimForAtoll(atoll)).deg;
  return strait ? straitHeading(deg) : alongReefHeading(deg);
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
  if (site.siteType === "strait-wall" && marine.bearing != null) {
    const axis = straitHeading(marine.bearing);
    return {
      bearing: marine.bearing,
      bearingSource: marine.bearingSource,
      siteType: "strait-wall",
      alongHeadingDeg: axis,
      hours: straitHours({ hours: marine.hours, axisDeg: axis }),
      unavailable: false,
      stale: marine.stale,
      fetchedAt: marine.fetchedAt,
    };
  }
  if (site.siteType === "lagoon" && atoll) {
    const lagoon = await lagoonLoad(site, mates, atoll, marine.hours, options);
    if (lagoon) {
      return {
        bearing: marine.bearing,
        bearingSource: marine.bearingSource,
        siteType: "lagoon",
        alongHeadingDeg: lagoon.axisDeg,
        hours: lagoon.hours,
        unavailable: false,
        stale: marine.stale,
        fetchedAt: marine.fetchedAt,
      };
    }
  }
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
