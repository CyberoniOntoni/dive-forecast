"use server";

import { atollForPin } from "./bearing";
import { FORECAST_NOTICE, parseWall, toMaldivesWall } from "./forecast";
import { siteNoteFor } from "./site-type";
import { forecastAtReport } from "./forecast-log";
import { alongHeadingFor, loadSite, reportTideForSite, type ReportTide, type SiteLoad } from "./load-site";
import { exposureIslands, exposureRings, loadOffshore, seaStateHours, siteSeaState, type Offshore } from "./sea-state";
import { readShelterGrid, SHELTER_BAND_KM, SHELTER_STEP_DEG, shelterField } from "./shelter-grid";
import { readIslands } from "./islands";
import { readOpenings } from "./openings";
import { KM_PER_DEG_LAT, pointInRing, rimEdgeKm, rimForAtoll, rimWayId, type RimRing } from "./rim";
import { siteExposure } from "./wave-exposure";
import { recentReportRows, type RecentReportRow } from "./recent-reports";
import { currentWallTime, timeZoneForSite, zoneLabel, type SiteTimeZone } from "./site-time";
import {
  addReport as persistReport,
  addUserSite,
  findSite,
  listMergedSites,
  ratingForSite,
  readCatalog,
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

export type ReportActionState = { success: boolean; error: string | null };

export async function listSites(): Promise<Site[]> {
  return listMergedSites();
}

export async function getSite(id: string): Promise<Site | null> {
  return findSite(id);
}

export async function addSite(input: { name: string; lat: number; lon: number }): Promise<Site> {
  const body = requireSiteInput(input);
  const name = requireSiteName(body.name);
  const lat = requireLatitude(body.lat);
  const lon = requireLongitude(body.lon);
  const atolls = readCatalog().atolls;
  if (atolls.length === 0) throw new Error("No atolls");

  const atoll = atollForPin(lat, lon, atolls);
  return addUserSite(newUserSite(name, lat, lon, atoll?.id ?? UNSEEDED_ATOLL_ID));
}

export async function rateSite(siteId: string, score: number): Promise<Rating> {
  requireSiteId(siteId);
  if (!findSite(siteId)) throw new Error("Unknown site");
  requireRatingScore(score);
  return saveRating({ siteId, score, updatedAt: new Date().toISOString() });
}

export async function getRating(siteId: string): Promise<Rating | null> {
  return ratingForSite(siteId);
}

export async function addReport(input: unknown): Promise<Report> {
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
  try {
    const time = String(formData.get("time") ?? "").trim();
    const direction = String(formData.get("direction") ?? "");
    const strength = String(formData.get("strength") ?? "");
    await addReport({
      siteId,
      time,
      direction: direction as Direction,
      strength: strength as Strength,
    });
    return { success: true, error: null };
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
  requireSiteId(siteId);
  return recentReportRows(reportsForSite(siteId), {
    nowWall: toMaldivesWall(new Date().toISOString()),
    route,
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

/**
 * One atoll's felt height on one of its grids for the map: one byte per cell, row 0 at the south, as
 * lib/shelter-field.ts sets out. "coarse" is the 500 m grid over the whole atoll; "fine" the 125 m cells near islands,
 * cropped to the view.
 */
export type ShelterAtoll = {
  wayId: string;
  layer: "coarse" | "fine";
  south: number;
  west: number;
  stepDeg: number;
  rows: number;
  columns: number;
  values: string;
};
/** The hour shown, the hours that can be picked (from now, as far as the waves go), and the atolls in view. */
export type ShelterView = { time: string; hours: string[]; atolls: ShelterAtoll[]; stale: boolean };

/** One coarse grid cell, km. */
const SHELTER_STEP_KM = SHELTER_STEP_DEG * KM_PER_DEG_LAT;
/** Hours the layer offers: from the current one, three days on. */
const SHELTER_HOURS = 72;
/** The fine cells are sent only for a view this small (degrees across): zoom 12 on a laptop, 11 on a phone. */
const SHELTER_FINE_VIEW_DEG = 0.6;

/**
 * Felt height over the atolls in view and the sea round them, at `time` (a Maldives wall hour) or the current hour,
 * with the 125 m cells near islands once the view is small enough. An atoll whose offshore waves are not loaded yet is
 * left out, and its fetch runs in the background for the next view.
 */
export async function getShelter(
  view: { south: number; west: number; north: number; east: number },
  time?: string,
): Promise<ShelterView> {
  const { south, west, north, east } = view ?? {};
  if (![south, west, north, east].every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new Error("Bad view");
  }
  if (time !== undefined && !/^\d{4}-\d{2}-\d{2}T\d{2}:00$/.test(time)) throw new Error("Bad time");
  const now = currentHour();
  const grid = readShelterGrid();
  const seen = new Set<string>();
  const shapes = readCatalog().atolls.flatMap((atoll) => {
    const ring = rimForAtoll(atoll);
    const wayId = rimWayId(atoll);
    // Two catalog atolls can share one outline; draw it once.
    if (!ring || !grid.atolls[wayId] || seen.has(wayId)) return [];
    seen.add(wayId);
    return [{ atoll, wayId, box: padBox(ringBox(ring), SHELTER_BAND_KM / KM_PER_DEG_LAT) }];
  });
  const shown = shapes.filter(({ box }) => box.north >= south && box.south <= north && box.east >= west && box.west <= east);
  // Atolls in view, and their neighbours whose seas they blend with where the two meet.
  const wanted = new Set(shown.map(({ wayId }) => wayId));
  for (const { wayId } of shown) for (const neighbour of Object.keys(grid.atolls[wayId].coarse.blend)) wanted.add(neighbour);
  const loaded = await Promise.all(
    shapes
      .filter(({ wayId }) => wanted.has(wayId))
      .map(async ({ atoll, wayId }) => ({ atoll, wayId, offshore: await loadOffshore(atoll, { wait: false }).catch(() => null) })),
  );
  const offshores = new Map(
    loaded.flatMap(({ wayId, offshore }) => (offshore != null && offshore.sides.length > 0 ? [[wayId, offshore] as const] : [])),
  );
  const ready = shown.flatMap(({ wayId }) => {
    const offshore = offshores.get(wayId);
    return offshore ? [{ wayId, offshore }] : [];
  });
  const hours = [...new Set(ready.flatMap(({ offshore }) => offshore.sides.flatMap((side) => side.hours.map((hour) => hour.time))))]
    .filter((hour) => hour >= now)
    .sort()
    .slice(0, SHELTER_HOURS);
  const hour = time && hours.includes(time) ? time : now;
  const detail = north - south <= SHELTER_FINE_VIEW_DEG && east - west <= SHELTER_FINE_VIEW_DEG;
  const atolls: ShelterAtoll[] = [];
  for (const { wayId, offshore } of ready) {
    const layers = [
      { layer: "coarse" as const, field: shelterField(wayId, offshore, hour, "coarse", undefined, offshores) },
      {
        layer: "fine" as const,
        field: detail ? shelterField(wayId, offshore, hour, "fine", { south, west, north, east }, offshores) : null,
      },
    ];
    for (const { layer, field } of layers) {
      if (!field) continue;
      atolls.push({
        wayId,
        layer,
        south: field.south,
        west: field.west,
        stepDeg: field.stepDeg,
        rows: field.rows,
        columns: field.columns,
        values: Buffer.from(field.values).toString("base64"),
      });
    }
  }
  return { time: hour, hours, atolls, stale: ready.some(({ offshore }) => offshore.stale) };
}

/** An atoll's outline and the islands in and round it, for the map to cut the shading to water. */
export async function getShelterShapes(wayId: string): Promise<{ outline: RimRing; islands: RimRing[] } | null> {
  if (typeof wayId !== "string" || !/^\d+$/.test(wayId)) throw new Error("Bad outline");
  const atoll = readCatalog().atolls.find((item) => rimWayId(item) === wayId);
  const outline = rimForAtoll(atoll);
  if (!outline) return null;
  const box = padBox(ringBox(outline), SHELTER_BAND_KM / KM_PER_DEG_LAT);
  const islands = readIslands()
    .map((island) => island.ring)
    .filter((ring) => {
      const island = ringBox(ring);
      return island.north >= box.south && island.south <= box.north && island.east >= box.west && island.west <= box.east;
    });
  return { outline, islands };
}

/**
 * The sea state at one point of a lagoon or the sea within SHELTER_BAND_KM of an atoll, traced on its own (not read
 * off the grid), for the map's tap readout. Outside an outline the point belongs to the nearest one. Null farther out
 * or on land.
 */
export async function getShelterPoint(lat: number, lon: number, time: string): Promise<SeaStateHour | "unknown" | null> {
  if (![lat, lon].every((value) => typeof value === "number" && Number.isFinite(value))) throw new Error("Bad point");
  if (typeof time !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:00$/.test(time)) throw new Error("Bad time");
  const atolls = readCatalog().atolls.flatMap((item) => {
    const ring = rimForAtoll(item);
    return ring ? [{ atoll: item, ring }] : [];
  });
  const within = atolls.find(({ ring }) => pointInRing(lat, lon, ring));
  const nearest = within
    ? null
    : atolls
        .map(({ atoll, ring }) => ({ atoll, km: rimEdgeKm({ lat, lon }, ring) }))
        // The shading fades out over the cell past the band's edge; a tap anywhere it shows still reads.
        .filter(({ km }) => km <= SHELTER_BAND_KM + SHELTER_STEP_KM)
        .sort((a, b) => a.km - b.km)[0];
  const atoll = within?.atoll ?? nearest?.atoll;
  if (!atoll) return null;
  if (readIslands().some((island) => pointInRing(lat, lon, island.ring))) return null;
  const offshore = await loadOffshore(atoll, { wait: false }).catch(() => null);
  if (!offshore || offshore.sides.length === 0) return "unknown";
  const exposure = siteExposure(
    { lat, lon, kind: "lagoon", inwardBearingDeg: null, ownWayId: rimWayId(atoll) },
    exposureRings(),
    readOpenings(),
    exposureIslands(),
  );
  const [hour] = seaStateHours({
    sides: offshore.sides.map((side) => ({ sideDeg: side.sideDeg, hours: side.hours.filter((item) => item.time === time) })),
    exposure,
    wind: (offshore.wind ?? []).filter((item) => item.time === time),
  });
  return hour ?? "unknown";
}

function currentHour(): string {
  return `${toMaldivesWall(new Date().toISOString()).slice(0, 13)}:00`;
}

function ringBox(ring: RimRing): { south: number; north: number; west: number; east: number } {
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const [lat, lon] of ring) {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lon);
    east = Math.max(east, lon);
  }
  return { south, north, west, east };
}

function padBox(box: { south: number; north: number; west: number; east: number }, by: number) {
  return { south: box.south - by, north: box.north + by, west: box.west - by, east: box.east + by };
}
