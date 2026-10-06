import fs from "fs";
import path from "path";
import { resolveBearing } from "./bearing";
import { rimForAtoll } from "./rim";
import { atollRing, atollRingLevel } from "./atoll-ring";
import {
  alongReefHours,
  alongReportDirection,
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
import { crossesRim, siteRoute } from "./site-type";
import { marineSeriesStale, siteMarineHours, type FetchOptions } from "./marine";
import { seawardKmFor } from "./seaward-floor";
import type {
  Atoll,
  BearingSource,
  ForecastRoute,
  HourForecast,
  MarineHour,
  Report,
  RingLevel,
  Site,
  SiteType,
} from "./types";

const REPLAY_PATH = path.join(process.cwd(), "data", "replay.json");

export type SiteLoad = {
  bearing: number | null;
  bearingSource: BearingSource | null;
  /** Where the site sits, when classified. A lagoon site never shows high confidence. */
  siteType: SiteType | null;
  /** Which model made the hours. A lagoon site whose atoll has no outline or ring falls back to "channel". */
  forecastRoute: ForecastRoute;
  /**
   * Set on every route but "channel": the reef heading at a wall, the strait axis, or the main axis of a lagoon
   * site's flow. The heading its "incoming" means. Null for a channel, where incoming follows the inward bearing.
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
  route: { route: ForecastRoute; axisDeg: number | null },
): SiteLoad {
  return {
    bearing,
    bearingSource,
    siteType,
    forecastRoute: route.route,
    alongHeadingDeg: route.axisDeg,
    hours: [],
    unavailable: true,
    stale: false,
    fetchedAt: null,
  };
}

const LAGOON_MEMO_MS = 10 * 60 * 1000;
const lagoonMemo = new Map<string, { at: number; sources: LagoonSource[] }>();
const lagoonLoading = new Map<string, Promise<LagoonSource[]>>();
const sinkMemo = new Map<string, LagoonSink>();

/**
 * The openings of an atoll's lagoon: its porous rim from the ring points, and each channel dive site (pass, channel
 * thila, corner) with its own net flow. Empty when the atoll has no ring level yet, or while a ring point or channel
 * still waits on its first fetch: an opening left out exchanges nothing, so that side of the lagoon would be wrong.
 * Kept ten minutes per atoll once complete, and shared by every lagoon site asking at once.
 */
async function lagoonSources(atoll: Atoll, mates: readonly Site[], options: FetchOptions): Promise<LagoonSource[]> {
  const kept = lagoonMemo.get(atoll.id);
  if (kept && Date.now() - kept.at < LAGOON_MEMO_MS && kept.sources.length > 0) return kept.sources;
  const running = lagoonLoading.get(atoll.id);
  if (running) return running;
  const load = (async () => {
    const ring = await atollRing(atoll, options);
    if (ring.level.length === 0 || (ring.pending ?? 0) > 0) return [];
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
        if (marine.ok) return channelSource(channel, marine.hours, deg, ring.level);
        return marine.pending ? "pending" : null;
      }),
    );
    if (fetched.includes("pending")) return [];
    const sources = [
      ...rimSources(ring),
      ...fetched.filter((source): source is LagoonSource => source != null && source !== "pending"),
    ];
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
 * The atoll's ring level on the channel route, so the head across the atoll drives it. None on any other route (a
 * wall, a strait, or a lagoon site even when it falls back to channel hours): no channel joins ocean and lagoon there.
 */
async function ringLevelFor(
  route: ForecastRoute,
  atoll: Atoll | undefined,
  options: FetchOptions = {},
): Promise<RingLevel[] | undefined> {
  if (!atoll || route !== "channel") return undefined;
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

/** The axis "incoming" means at a strait wall or a wall whose current runs along the reef; null elsewhere or with no atoll. */
export function alongHeadingFor(site: Site, mates: readonly Site[], atoll: Atoll | undefined): number | null {
  if (!atoll) return null;
  const outside = { lat: atoll.oceanLat, lon: atoll.oceanLon };
  const deg = resolveBearing(site, mates, outside, rimForAtoll(atoll)).deg;
  return siteRoute(site, mates, deg).axisDeg;
}

/** Inward bearing, marine fetch, and forecast hours, by the site's route. A missing atoll or cache is unavailable. */
export async function loadSite(
  site: Site,
  mates: readonly Site[],
  atoll: Atoll | undefined,
  reports: readonly Report[],
  options: FetchOptions = {},
): Promise<SiteLoad> {
  const marine = await checkedMarine(site, mates, atoll, options);
  const route = siteRoute(site, mates, marine.bearing);
  const siteType = site.siteType ?? null;
  if (!marine.ok) return unavailableLoad(marine.bearing, marine.bearingSource, siteType, route);
  const loaded = (forecastRoute: ForecastRoute, alongHeadingDeg: number | null, hours: HourForecast[]): SiteLoad => ({
    bearing: marine.bearing,
    bearingSource: marine.bearingSource,
    siteType,
    forecastRoute,
    alongHeadingDeg,
    hours,
    unavailable: false,
    stale: marine.stale,
    fetchedAt: marine.fetchedAt,
  });
  const axis = route.axisDeg;
  if (route.route === "strait" && axis != null) {
    return loaded("strait", axis, straitHours({ hours: marine.hours, axisDeg: axis }));
  }
  // Along the reef the stream comes from the ocean model alone: no reports, no channel section.
  if (route.route === "along-reef" && axis != null) {
    return loaded("along-reef", axis, alongReefHours({ hours: marine.hours, alongHeadingDeg: axis }));
  }
  if (route.route === "lagoon" && atoll) {
    const lagoon = await lagoonLoad(site, mates, atoll, marine.hours, options);
    if (lagoon) return loaded("lagoon", lagoon.axisDeg, lagoon.hours);
  }
  // A channel, or a lagoon site whose atoll has no outline or ring yet. Inside the lagoon it is never that sure.
  const allowHigh = replayAllowsHigh() && route.route !== "lagoon";
  const hours = forecastHours({
    hours: marine.hours,
    inwardBearingDeg: marine.bearing,
    reports: route.route === "lagoon" ? lagoonReportsOnBearing(reports, marine.bearing) : reports,
    ringLevel: await ringLevelFor(route.route, atoll, options),
    ...sectionInput(site),
    ...(allowHigh ? {} : { allowHighConfidence: false }),
  });
  return loaded("channel", null, hours);
}

/** Saved lagoon axes within this many degrees of square to the inward bearing say nothing about in or out. */
const LAGOON_REPORT_SQUARE_DEG = 30;

/**
 * A lagoon site's reports for the channel model it falls back to. A report filed while the lagoon model ran says
 * "incoming" toward its saved lagoon axis, not along the inward bearing, so it is read against the bearing: kept,
 * flipped, or dropped when the axis was near square to it. A report with no saved axis was filed on the channel model.
 */
function lagoonReportsOnBearing(reports: readonly Report[], inwardBearingDeg: number): Report[] {
  return reports.flatMap((report) => {
    const saved = report.alongHeadingDeg;
    if (typeof saved !== "number" || !Number.isFinite(saved)) return [report];
    const apart = Math.abs(((saved - inwardBearingDeg + 540) % 360) - 180);
    if (Math.abs(apart - 90) < LAGOON_REPORT_SQUARE_DEG) return [];
    const direction = alongReportDirection(report, inwardBearingDeg, "lagoon");
    return direction ? [{ ...report, direction }] : [];
  });
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
  const ring = await ringLevelFor(siteRoute(site, mates, marine.bearing).route, atoll);
  return {
    headWindowM: headWindowAt(marine.hours, time, ring),
    slopeWindowM,
    rangeM: residualRangeAt(marine.hours, time),
    throughflowM: throughflowAt(marine.hours, time, marine.bearing),
  };
}
