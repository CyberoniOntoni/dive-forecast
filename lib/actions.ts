"use server";

import { atollForPin } from "./bearing";
import { FORECAST_NOTICE, parseWall, toMaldivesWall } from "./forecast";
import { ALONG_REEF_NOTE, LAGOON_NOTE } from "./site-type";
import { forecastAtReport } from "./forecast-log";
import { alongHeadingFor, loadSite, reportTideForSite, type ReportTide } from "./load-site";
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
  type Direction,
  type ForecastAtReport,
  type Rating,
  type Report,
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

  const time = toMaldivesWall(body.time as string);
  const tide = await reportTide(site, time);
  const predicted = await predictionAtReport(site, time);
  const report: Report = {
    id: crypto.randomUUID(),
    siteId: body.siteId as string,
    time,
    direction: body.direction as Direction,
    strength: body.strength as Strength,
    slopeM: tide ? tide.slopeWindowM[REPORT_HOUR_INDEX] : null,
  };
  if (tide) {
    report.slopeWindowM = tide.slopeWindowM;
    if (tide.rangeM != null) report.rangeM = tide.rangeM;
    if (tide.throughflowM != null) report.throughflowM = tide.throughflowM;
  }
  const along = reportAlongHeading(site);
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

/** Never blocks a report: a site whose heading cannot be resolved saves none. */
function reportAlongHeading(site: Site): number | null {
  try {
    const catalog = readCatalog();
    return alongHeadingFor(site, catalog.sites, catalog.atolls.find((item) => item.id === site.atollId));
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

  const loaded = await loadStoredSite(site);
  return {
    hours: loaded.hours,
    unavailable: loaded.unavailable,
    stale: loaded.stale,
    notice: FORECAST_NOTICE,
    inwardBearingDeg: loaded.bearing,
    bearingSource: loaded.bearingSource,
    siteType: loaded.siteType,
    alongHeadingDeg: loaded.alongHeadingDeg,
    siteNote: loaded.alongHeadingDeg != null ? ALONG_REEF_NOTE : loaded.siteType === "lagoon" ? LAGOON_NOTE : null,
    fetchedAt: loaded.fetchedAt,
  };
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
    alongHeadingDeg: null,
    siteNote: null,
    fetchedAt: null,
  };
}

async function loadStoredSite(site: Site) {
  const catalog = readCatalog();
  const atoll = catalog.atolls.find((item) => item.id === site.atollId);
  return loadSite(site, catalog.sites, atoll, reportsForSite(site.id));
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
