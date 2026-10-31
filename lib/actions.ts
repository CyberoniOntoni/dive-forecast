"use server";

import { atollForPin } from "./bearing";
import type { BoatTrip } from "./boat-route-data";
import { boatRoute } from "./boat-route-data";
import { FORECAST_NOTICE, parseWall, toMaldivesWall } from "./forecast";
import { siteNoteFor } from "./site-type";
import { forecastAtReport } from "./forecast-log";
import { alongHeadingFor, loadSite, reportTideForSite, type ReportTide, type SiteLoad } from "./load-site";
import { loadOffshore, siteSeaState, type Offshore } from "./sea-state";
import { shelterPoint, shelterShapes, shelterView, type ShelterView } from "./shelter-grid";
import type { RimRing } from "./rim";
import { recentReportRows, type RecentReportRow } from "./recent-reports";
import { currentWallTime, timeZoneForSite, zoneLabel, type SiteTimeZone } from "./site-time";
import { ready } from "./ready";
import { requireSession } from "./auth";
import { reportAwards } from "./points";
import type { ReportAward } from "./points-rules";
import {
  addReport as persistReport,
  addUserSite,
  findSite,
  listMergedSites,
  ratingsForSite,
  readCatalog,
  readStore,
  reportsForSite,
  saveRating,
} from "./store";
import {
  STRENGTHS,
  UNSEEDED_ATOLL_ID,
  type Atoll,
  type Direction,
  type ForecastAtReport,
  type ForecastRoute,
  type Rating,
  type Report,
  type SeaStateHour,
  type Site,
  type SiteForecast,
  type Strength,
} from "./types";

const REPORT_HOUR_INDEX = 6;

export type ReportActionState = {
  success: boolean;
  error: string | null;
  /** What the saved report earned (lib/points.ts). */
  award?: ReportAward | null;
};

export async function listSites(): Promise<Site[]> {
  await ready();
  return listMergedSites();
}

export async function getSite(id: string): Promise<Site | null> {
  await ready();
  return findSite(id);
}

export async function addSite(input: { name: string; lat: number; lon: number }): Promise<Site> {
  await ready();
  const session = await requireSession();
  const body = requireSiteInput(input);
  const name = requireSiteName(body.name);
  const lat = requireLatitude(body.lat);
  const lon = requireLongitude(body.lon);
  const atolls = readCatalog().atolls;
  if (atolls.length === 0) throw new Error("No atolls");

  const atoll = atollForPin(lat, lon, atolls);
  return addUserSite({ ...newUserSite(name, lat, lon, atoll?.id ?? UNSEEDED_ATOLL_ID), addedBy: session.userId });
}

/** A site's ratings: the mean of every diver's, how many there are, and the signed-in diver's own. */
export type RatingSummary = { average: number | null; count: number; mine: number | null };

export async function rateSite(siteId: string, score: number): Promise<RatingSummary> {
  await ready();
  const session = await requireSession();
  requireSiteId(siteId);
  if (!findSite(siteId)) throw new Error("Unknown site");
  requireRatingScore(score);
  await saveRating({ siteId, score, updatedAt: new Date().toISOString(), userId: session.userId });
  return ratingSummary(ratingsForSite(siteId), session.userId);
}

export async function getRating(siteId: string, userId: string | null): Promise<RatingSummary> {
  await ready();
  return ratingSummary(ratingsForSite(siteId), userId);
}

function ratingSummary(ratings: readonly Rating[], userId: string | null): RatingSummary {
  const count = ratings.length;
  const average = count ? Math.round((ratings.reduce((sum, item) => sum + item.score, 0) / count) * 10) / 10 : null;
  const mine = userId ? (ratings.find((item) => item.userId === userId)?.score ?? null) : null;
  return { average, count, mine };
}

export async function addReport(input: unknown): Promise<Report> {
  await ready();
  const session = await requireSession();
  const body = requireReportInput(input);
  const site = findSite(body.siteId as string);
  if (!site) throw new Error("Unknown site");
  requireDirection(body.direction as Direction);
  requireStrength(body.strength as Strength);

  // A report's time is the dive site's own wall clock (lib/site-time.ts); today that is always the Maldives.
  const zone = timeZoneForSite(site);
  const time = toMaldivesWall(body.time as string);
  const filedAt = new Date();
  requireNotAhead(time, zone, filedAt.getTime());
  requireNotDuplicate(site.id, time, body.direction as Direction, body.strength as Strength, filedAt.getTime());
  const tide = await reportTide(site, time);
  const predicted = await predictionAtReport(site, time);
  const report: Report = {
    id: crypto.randomUUID(),
    siteId: body.siteId as string,
    time,
    direction: body.direction as Direction,
    strength: body.strength as Strength,
    slopeM: tide ? tide.slopeWindowM[REPORT_HOUR_INDEX] : null,
    filedAt: filedAt.toISOString(),
    userId: session.userId,
  };
  if (tide) {
    report.slopeWindowM = tide.slopeWindowM;
    if (tide.rangeM != null) report.rangeM = tide.rangeM;
    if (tide.throughflowM != null) report.throughflowM = tide.throughflowM;
    if (tide.headWindowM != null) report.headWindowM = tide.headWindowM;
  }
  const along = await reportAlongHeading(site);
  if (along != null) report.alongHeadingDeg = Math.round(along);
  if (predicted) report.predicted = predicted;
  return persistReport(report);
}

export async function addReportAction(siteId: string, formData: FormData): Promise<ReportActionState> {
  await ready();
  try {
    const time = String(formData.get("time") ?? "").trim();
    const direction = String(formData.get("direction") ?? "");
    const strength = String(formData.get("strength") ?? "");
    const report = await addReport({
      siteId,
      time,
      direction: direction as Direction,
      strength: strength as Strength,
    });
    return { success: true, error: null, award: reportAwards(readStore().reports).get(report.id) ?? null };
  } catch (caught) {
    const error = caught instanceof Error ? caught.message : "Could not add that report.";
    return { success: false, error };
  }
}

/**
 * The forecast for the report hour as the site page shows it, plus the model alone. Never blocks a report.
 * Only reports from before this dive count, as in the replay, so a back-dated report is not scored on later dives.
 */
async function predictionAtReport(site: Site, time: string): Promise<ForecastAtReport | null> {
  try {
    const catalog = readCatalog();
    const atoll = catalog.atolls.find((item) => item.id === site.atollId);
    const diveMs = parseWall(time);
    const earlier = reportsForSite(site.id).filter((report) => parseWall(report.time) < diveMs);
    const shown = await loadSite(site, catalog.sites, atoll, earlier);
    const modelOnly = await loadSite(site, catalog.sites, atoll, []);
    return forecastAtReport(shown, modelOnly, time);
  } catch {
    return null;
  }
}

/**
 * The compass heading "incoming" meant for this site when the report was filed. A wall's or strait's comes from its
 * bearing; a lagoon site's is the main axis of its lagoon flow, so it comes from the forecast. Never blocks a report.
 */
async function reportAlongHeading(site: Site): Promise<number | null> {
  try {
    const catalog = readCatalog();
    const atoll = catalog.atolls.find((item) => item.id === site.atollId);
    if (site.siteType === "lagoon") return (await loadSite(site, catalog.sites, atoll, [])).alongHeadingDeg;
    return alongHeadingFor(site, catalog.sites, atoll);
  } catch {
    return null;
  }
}

async function reportTide(site: Site, time: string): Promise<ReportTide | null> {
  try {
    const catalog = readCatalog();
    const atoll = catalog.atolls.find((item) => item.id === site.atollId);
    return await reportTideForSite(site, catalog.sites, atoll, time);
  } catch {
    return null;
  }
}

export async function forecastSite(siteId: string): Promise<SiteForecast> {
  await ready();
  const site = findSite(siteId);
  if (!site) return unavailableForecast();

  const catalog = readCatalog();
  const atoll = catalog.atolls.find((item) => item.id === site.atollId);
  // The offshore waves do not depend on the current, so they load alongside it rather than after it.
  const [loaded, offshore] = await Promise.all([
    loadSite(site, catalog.sites, atoll, reportsForSite(site.id)),
    loadOffshore(atoll).catch(() => undefined),
  ]);
  const sea = seaStateFor(site, catalog.sites, atoll, loaded, offshore);
  return {
    seaState: sea.hours,
    seaStale: sea.stale,
    hours: loaded.hours,
    unavailable: loaded.unavailable,
    stale: loaded.stale,
    notice: FORECAST_NOTICE,
    inwardBearingDeg: loaded.bearing,
    bearingSource: loaded.bearingSource,
    siteType: loaded.siteType,
    forecastRoute: loaded.forecastRoute,
    alongHeadingDeg: loaded.alongHeadingDeg,
    siteNote: siteNoteFor(loaded.siteType, loaded.forecastRoute),
    fetchedAt: loaded.fetchedAt,
  };
}

/**
 * The site's newest reports, as the site page lists them. On any route but "channel" the site's forecast reads as a
 * compass direction, so older in/out reports there are marked.
 */
export async function getRecentReports(siteId: string, route: ForecastRoute): Promise<RecentReportRow[]> {
  await ready();
  requireSiteId(siteId);
  return recentReportRows(reportsForSite(siteId), {
    nowWall: toMaldivesWall(new Date().toISOString()),
    route,
    nicknames: new Map(readStore().users.map((user) => [user.id, user.nickname])),
  });
}

function unavailableForecast(): SiteForecast {
  return {
    hours: [],
    unavailable: true,
    stale: false,
    notice: FORECAST_NOTICE,
    inwardBearingDeg: null,
    bearingSource: null,
    siteType: null,
    forecastRoute: "channel",
    alongHeadingDeg: null,
    siteNote: null,
    fetchedAt: null,
    seaState: null,
    seaStale: false,
  };
}

/**
 * The site's sea state for its forecast hours: null hours when the site has no atoll outline or no forecast, empty
 * when the waves failed to load. Never fails the forecast.
 */
function seaStateFor(
  site: Site,
  mates: readonly Site[],
  atoll: Atoll | undefined,
  loaded: SiteLoad,
  offshore: Offshore | null | undefined,
): { hours: SeaStateHour[] | null; stale: boolean } {
  if (loaded.unavailable || offshore === null) return { hours: null, stale: false };
  if (offshore === undefined) return { hours: [], stale: false };
  try {
    const sea = siteSeaState(site, mates, atoll, offshore, {
      hours: loaded.hours,
      forecastRoute: loaded.forecastRoute,
      inwardBearingDeg: loaded.bearing,
    });
    return { hours: sea.hours, stale: sea.stale };
  } catch {
    return { hours: [], stale: false };
  }
}

function newUserSite(name: string, lat: number, lon: number, atollId: string): Site {
  return {
    id: uniqueSiteId(name),
    name,
    atollId,
    lat,
    lon,
    sourceUrl: "user",
  };
}

function requireSiteInput(input: unknown): { name: unknown; lat: unknown; lon: unknown } {
  if (input === null || typeof input !== "object") throw new Error("Site is required");
  return input as { name: unknown; lat: unknown; lon: unknown };
}

function requireReportInput(input: unknown): {
  siteId: unknown;
  time: unknown;
  direction: unknown;
  strength: unknown;
} {
  if (input === null || typeof input !== "object") throw new Error("Report is required");
  return input as { siteId: unknown; time: unknown; direction: unknown; strength: unknown };
}

function requireSiteName(name: unknown): string {
  if (typeof name !== "string") throw new Error("Site name is required");
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Site name is required");
  if (trimmed.length > 80) throw new Error("Site name must be 1 to 80 characters");
  return trimmed;
}

function requireLatitude(lat: unknown): number {
  if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -2 || lat > 9) {
    throw new Error("Latitude is outside Maldives bounds [-2, 9]");
  }
  return lat;
}

function requireLongitude(lon: unknown): number {
  if (typeof lon !== "number" || !Number.isFinite(lon) || lon < 71 || lon > 76) {
    throw new Error("Longitude is outside Maldives bounds [71, 76]");
  }
  return lon;
}

/** A dive more than an hour ahead of the site's clock is almost always a time entered in the diver's own zone. */
const AHEAD_LIMIT_MS = 60 * 60 * 1000;
/** An identical report filed again within this window is a double submission, not a second diver. */
const DUPLICATE_WINDOW_MS = 30 * 60 * 1000;

function requireNotAhead(time: string, zone: SiteTimeZone, nowMs: number): void {
  const siteNowMs = parseWall(currentWallTime(zone, nowMs));
  if (parseWall(time) - siteNowMs > AHEAD_LIMIT_MS) {
    throw new Error(`That time is still ahead in the ${zone.place}. Enter the dive in ${zoneLabel(zone)}.`);
  }
}

function requireNotDuplicate(siteId: string, time: string, direction: Direction, strength: Strength, nowMs: number): void {
  const repeat = reportsForSite(siteId).some((report) => {
    if (report.time !== time || report.direction !== direction || report.strength !== strength) return false;
    const filed = report.filedAt ? Date.parse(report.filedAt) : Number.NaN;
    return Number.isFinite(filed) && nowMs - filed < DUPLICATE_WINDOW_MS;
  });
  if (repeat) throw new Error("This report is already saved.");
}

function requireSiteId(siteId: unknown): asserts siteId is string {
  if (typeof siteId !== "string" || !siteId.trim()) throw new Error("Site id is required");
}

function requireRatingScore(score: number): void {
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw new Error("Rating must be an integer from 1 to 5");
  }
}

function requireDirection(direction: Direction): void {
  if (direction !== "incoming" && direction !== "outgoing") throw new Error("Bad direction");
}

function requireStrength(strength: Strength): void {
  if (!STRENGTHS.includes(strength)) throw new Error("Bad strength");
}

function uniqueSiteId(name: string): string {
  const suffix = crypto.randomUUID().slice(0, 8);
  return `${slugFromName(name)}-${suffix}`;
}

function slugFromName(name: string): string {
  const letters = name.toLowerCase().normalize("NFKD");
  const dashed = letters.replace(/[^a-z0-9]+/g, "-");
  const trimmed = dashed.replace(/^-|-$/g, "");
  return trimmed || "site";
}

export type { ShelterAtoll, ShelterView } from "./shelter-grid";

const WALL_HOUR = /^\d{4}-\d{2}-\d{2}T\d{2}:00$/;

/** The sheltered-water layer's felt height for the view, at `time` (a Maldives wall hour) or now. */
export async function getShelter(
  view: { south: number; west: number; north: number; east: number },
  time?: string,
): Promise<ShelterView> {
  await ready("shelter-grid.json");
  const { south, west, north, east } = view ?? {};
  if (![south, west, north, east].every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new Error("Bad view");
  }
  if (time !== undefined && !WALL_HOUR.test(time)) throw new Error("Bad time");
  return shelterView({ south, west, north, east }, time);
}

/** An atoll's outline and the islands in and round it, for the map to cut the shading to water. */
export async function getShelterShapes(wayId: string): Promise<{ outline: RimRing; islands: RimRing[] } | null> {
  await ready("shelter-grid.json");
  if (typeof wayId !== "string" || !/^\d+$/.test(wayId)) throw new Error("Bad outline");
  return shelterShapes(wayId);
}

/** The sea state at one tapped spot of the layer. */
export async function getShelterPoint(lat: number, lon: number, time: string): Promise<SeaStateHour | "unknown" | null> {
  await ready("shelter-grid.json");
  if (![lat, lon].every((value) => typeof value === "number" && Number.isFinite(value))) throw new Error("Bad point");
  if (typeof time !== "string" || !WALL_HOUR.test(time)) throw new Error("Bad time");
  return shelterPoint(lat, lon, time);
}

export type { BoatTrip } from "./boat-route-data";

/**
 * A boat route from a GPS position to a site or a point picked on the map ("lat,lon"), round the islands and reef the
 * app knows of. Null for an unknown site.
 */
export async function getBoatRoute(from: { lat: number; lon: number }, destinationId: string): Promise<BoatTrip | null> {
  await ready();
  const { lat, lon } = from ?? {};
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("Bad position");
  }
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error("Bad position");
  if (typeof destinationId !== "string" || destinationId.length === 0) throw new Error("Bad destination");
  return boatRoute({ lat, lon }, destinationId);
}
