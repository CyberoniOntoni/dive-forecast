import { resolveBearing } from "./bearing";
import { rimForAtoll } from "./rim";
import { inFlightPerRequest } from "./cloudflare";
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
import { applyAxisReports } from "./axis-reports";
import { channelSource, channelWeights, lagoonHours, lagoonSink, rimSources, type LagoonSink, type LagoonSource } from "./lagoon-flow";
import { crossesRim, siteRoute } from "./site-type";
import { fetchMarine, marineSeriesStale, seawardPoint, siteMarineHours, type FetchOptions, type MarineFetch } from "./marine";
import { SEAWARD_STEPS_KM } from "./floor-sample";
import { DRIFT_SMOOTHING_MAX_KM, smoothedDriftHours, type DriftSample } from "./drift-smoothing";
import { distanceKm } from "./geometry";
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
import { readDataFile } from "./data-files";


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
/** Per request on a worker (perRequest); the memo above holds plain data and is shared. */
const lagoonLoadsInFlight = inFlightPerRequest<LagoonSource[]>();
const sinkMemo = new Map<string, LagoonSink>();

/** Forgets every atoll's lagoon openings and every site's drift lenders, so the next load builds them again. The warm-up starts with it. */
export function clearLagoonMemo(): void {
  lagoonMemo.clear();
  lenderMemo.clear();
}

/**
 * The openings of an atoll's lagoon: its porous rim from the ring points, and each channel dive site (pass, channel
 * thila, corner) with its own net flow. Empty when the atoll has no ring level yet. Kept ten minutes per atoll and
 * shared by every lagoon site asking at once, unless a ring point or channel was still waiting on its first fetch:
 * then the next load builds them again with whatever has arrived.
 */
async function lagoonSources(atoll: Atoll, mates: readonly Site[], options: FetchOptions): Promise<LagoonSource[]> {
  const kept = lagoonMemo.get(atoll.id);
  if (kept && Date.now() - kept.at < LAGOON_MEMO_MS && kept.sources.length > 0) return kept.sources;
  const lagoonLoading = lagoonLoadsInFlight();
  const running = lagoonLoading.get(atoll.id);
  if (running) return running;
  const load = (async () => {
    const ring = await atollRing(atoll, options);
    if (ring.level.length === 0) return [];
    let pending = (ring.pending ?? 0) > 0;
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
        if (!marine.ok) {
          if (marine.pending) pending = true;
          return null;
        }
        // The same shared drift the channel's own forecast uses (checkedMarine).
        if (marine.fromFallback) return { channel, hours: marine.hours, deg };
        const shared = await sharedDriftHours(channel, mates, atoll, deg, marine.hours, options);
        if (shared.pending) pending = true;
        return { channel, hours: shared.hours, deg };
      }),
    );
    const loadedChannels = fetched.filter((item) => item != null);
    // Dive sites in one channel share its weight, so a channel counts once however many pins it has. Shared among
    // the pins that loaded, so a pin still fetching does not take part of its channel's weight with it.
    const weights = channelWeights(loadedChannels.map((item) => item.channel));
    const sources = [
      ...rimSources(ring),
      ...loadedChannels.map((item, index) => channelSource(item.channel, item.hours, item.deg, ring.level, weights[index])),
    ];
    if (!pending) lagoonMemo.set(atoll.id, { at: Date.now(), sources });
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
    const parsed: unknown = JSON.parse(readDataFile("replay.json"));
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
  // Shared only when the hours are from the site's own seaward point: the lenders are weighed by distance from it.
  const hours = crossesRim(site, mates) && !marine.fromFallback
    ? (await sharedDriftHours(site, mates, atoll, bearing, marine.hours, options)).hours
    : marine.hours;

  return {
    ok: true,
    bearing,
    bearingSource,
    hours,
    fetchedAt: marine.fetchedAt,
    stale: marine.stale || marineSeriesStale(marine.hours),
  };
}

/**
 * The route a site's forecast takes and its axis, from its bearing, without fetching anything: the same siteRoute
 * loadSite picks (a lagoon site whose atoll has no ring still says "lagoon" here). Null with no atoll.
 */
export function routeFor(
  site: Site,
  mates: readonly Site[],
  atoll: Atoll | undefined,
): { route: ForecastRoute; axisDeg: number | null } | null {
  if (!atoll) return null;
  const outside = { lat: atoll.oceanLat, lon: atoll.oceanLon };
  const deg = resolveBearing(site, mates, outside, rimForAtoll(atoll)).deg;
  return siteRoute(site, mates, deg);
}

/** The axis "incoming" means at a strait wall or a wall whose current runs along the reef; null elsewhere or with no atoll. */
export function alongHeadingFor(site: Site, mates: readonly Site[], atoll: Atoll | undefined): number | null {
  return routeFor(site, mates, atoll)?.axisDeg ?? null;
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
  // Reports pull the stream at walls, the strait and lagoon sites too (lib/axis-reports.ts), read along today's axis.
  // A strait or lagoon report is read only by the heading saved with it; a wall's can also fall back on its bearing.
  const onAxis = (hours: HourForecast[], axisDeg: number, kind: "wall" | "strait" | "lagoon") =>
    applyAxisReports(hours, reports, (report) => alongReportDirection(report, axisDeg, kind));
  if (route.route === "strait" && axis != null) {
    return loaded("strait", axis, onAxis(straitHours({ hours: marine.hours, axisDeg: axis }), axis, "strait"));
  }
  // Along the reef the stream comes from the ocean model alone: no channel section.
  if (route.route === "along-reef" && axis != null) {
    return loaded("along-reef", axis, onAxis(alongReefHours({ hours: marine.hours, alongHeadingDeg: axis }), axis, "wall"));
  }
  if (route.route === "lagoon" && atoll) {
    const lagoon = await lagoonLoad(site, mates, atoll, marine.hours, options);
    if (lagoon) return loaded("lagoon", lagoon.axisDeg, onAxis(lagoon.hours, lagoon.axisDeg, "lagoon"));
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

/**
 * A lagoon site's reports for the channel model it falls back to. A report filed while the lagoon model ran says
 * "incoming" toward its saved lagoon axis, not along the inward bearing, so it is read against the bearing like a
 * wall report against a changed heading. A report with no saved axis was filed on the channel model.
 */
function lagoonReportsOnBearing(reports: readonly Report[], inwardBearingDeg: number): Report[] {
  return reports.map((report) => {
    const direction = alongReportDirection(report, inwardBearingDeg, "lagoon");
    return direction ? { ...report, direction } : report;
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

/** Where a site's marine series is fetched: its seaward point at its own step-out. */
function samplePoint(site: Pick<Site, "id" | "lat" | "lon">, bearing: number): { lat: number; lon: number } {
  return seawardPoint(site.lat, site.lon, bearing, seawardKmFor(site.id));
}

/**
 * Two pins further apart than this cannot have sample points within DRIFT_SMOOTHING_MAX_KM: each sample point is at
 * most the largest GEBCO step-out from its pin.
 */
const LENDER_PIN_REACH_KM = DRIFT_SMOOTHING_MAX_KM + 2 * Math.max(...SEAWARD_STEPS_KM);

/** Lender points by site and atoll line-up. Cleared with the lagoon memo, and whenever it grows past this. */
const LENDER_MEMO_MAX = 2000;
const lenderMemo = new Map<string, DriftLender[]>();

/** Line-up hashes by mates list and atoll: a map build asks for every site of an atoll with the same list. */
const lineUpKeys = new WeakMap<readonly Site[], Map<string, string>>();

/**
 * What decides a site's lenders: every same-atoll pin's place and kind, hashed. Whether a mate crosses the
 * rim depends on the passes near it, and a fallback bearing on the seeded mates, so any change among them must miss
 * the memo.
 */
function atollMatesKey(atoll: Atoll, mates: readonly Site[]): string {
  let byAtoll = lineUpKeys.get(mates);
  if (!byAtoll) lineUpKeys.set(mates, (byAtoll = new Map()));
  const kept = byAtoll.get(atoll.id);
  if (kept) return kept;
  // Two FNV-1a hashes from different seeds, 64 bits together, so two line-ups sharing a key is out of reach.
  let first = 0x811c9dc5;
  let second = 0x01000193;
  let count = 0;
  for (const mate of mates) {
    if (mate.atollId !== atoll.id) continue;
    count += 1;
    const text = `${mate.id}:${mate.lat}:${mate.lon}:${mate.siteType ?? ""}:${mate.siteTypeSource ?? ""}:${mate.sourceUrl}:${mate.inwardBearingDeg ?? ""}|`;
    for (let at = 0; at < text.length; at += 1) {
      const code = text.charCodeAt(at);
      first = Math.imul(first ^ code, 0x01000193);
      second = Math.imul(second ^ code, 0x01000193) ^ (second >>> 15);
    }
  }
  const key = `${count}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
  byAtoll.set(atoll.id, key);
  return key;
}

/** A catalog pin that lends a site its drift, and where its series is fetched. */
export type DriftLender = { pin: Site; point: { lat: number; lon: number } };

/**
 * The sample points that lend a site their drift (lib/drift-smoothing.ts): those of the other catalog channel sites
 * of its atoll (crossing the rim, so passes, channel thilas, corners and funnel walls) within DRIFT_SMOOTHING_MAX_KM
 * of its own sample point. Pins added in the app never lend, so a new pin never shifts the catalog's forecasts; they
 * still borrow. How much each lends is decided once their series are in (driftShares). Kept per site and atoll
 * line-up: resolving a bearing walks the outline.
 */
export function driftLenders(
  site: Site,
  mates: readonly Site[],
  atoll: Atoll,
  own: { lat: number; lon: number },
): DriftLender[] {
  const key = `${atoll.id}|${atoll.rimSourceUrl}|${site.id}|${own.lat}|${own.lon}|${atollMatesKey(atoll, mates)}`;
  const kept = lenderMemo.get(key);
  if (kept) return kept;
  const outside = { lat: atoll.oceanLat, lon: atoll.oceanLon };
  const rim = rimForAtoll(atoll);
  const found = mates
    .filter(
      (mate) =>
        mate.id !== site.id &&
        mate.atollId === atoll.id &&
        mate.sourceUrl !== "user" &&
        distanceKm(mate, site) <= LENDER_PIN_REACH_KM &&
        crossesRim(mate, mates),
    )
    .map((mate) => ({ pin: mate, point: samplePoint(mate, resolveBearing(mate, mates, outside, rim).deg) }))
    .filter((item) => distanceKm(item.point, own) <= DRIFT_SMOOTHING_MAX_KM);
  if (lenderMemo.size >= LENDER_MEMO_MAX) lenderMemo.clear();
  lenderMemo.set(key, found);
  return found;
}

/**
 * Channel shares among the site and the lenders whose series loaded: pins within SAME_CHANNEL_KM of each other are
 * one channel and split one weight (channelWeights, as the lagoon's openings do), the site's own pin included. A
 * channel lends once however many dive sites it has, and a pin that could not lend leaves its share to the others.
 */
export function driftShares(site: Site, loaded: readonly Site[]): { own: number; lenders: number[] } {
  const shares = channelWeights([site, ...loaded], 1);
  return { own: shares[0], lenders: shares.slice(1) };
}

/** A series fit to lend its drift: fetched at the lender's own sample point, fresh by age and by its newest hour. */
export function lendsDrift(marine: MarineFetch): marine is Extract<MarineFetch, { ok: true }> {
  return marine.ok && !marine.stale && !marineSeriesStale(marine.hours);
}

/**
 * A channel site's hours with the drift it shares with its lenders. Each lender is fetched at its own sample point;
 * one still on its first fetch, failed or stale lends nothing, and `pending` says one was still on its first fetch.
 * The one path for a channel's own forecast and for its opening in the lagoon flow.
 */
async function sharedDriftHours(
  site: Site,
  mates: readonly Site[],
  atoll: Atoll,
  bearing: number,
  hours: MarineHour[],
  options: FetchOptions,
): Promise<{ hours: MarineHour[]; pending: boolean }> {
  const own = samplePoint(site, bearing);
  const lenders = driftLenders(site, mates, atoll, own);
  let pending = false;
  const fetched = await Promise.all(
    lenders.map(async ({ pin, point }) => {
      // Never waits: a lender with no cache yet is queued and lends nothing this time, the same on the map and on the
      // site page. The warm-up and the next request fill it in.
      const marine = await fetchMarine(point.lat, point.lon, { ...options, wait: false });
      if (lendsDrift(marine)) return { pin, point, hours: marine.hours };
      if (!marine.ok && marine.pending) pending = true;
      return null;
    }),
  );
  const loaded = fetched.filter((item) => item != null);
  const shares = driftShares(site, loaded.map((item) => item.pin));
  const samples: DriftSample[] = loaded.map((item, index) => ({ point: item.point, hours: item.hours, share: shares.lenders[index] }));
  return { hours: smoothedDriftHours({ point: own, hours, share: shares.own }, samples), pending };
}
