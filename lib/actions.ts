"use server";

import { nearestAtoll } from "./bearing";
import { FORECAST_NOTICE, toMaldivesWall } from "./forecast";
import { loadSite, slopeWindowForSite } from "./load-site";
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
  type Direction,
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

  const atoll = nearestAtoll(lat, lon, atolls);
  return addUserSite(newUserSite(name, lat, lon, atoll.id));
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

export async function addReport(input: {
  siteId: string;
  time: string;
  direction: Direction;
  strength: Strength;
}): Promise<Report> {
  const site = findSite(input.siteId);
  if (!site) throw new Error("Unknown site");
  requireDirection(input.direction);
  requireStrength(input.strength);

  const time = toMaldivesWall(input.time);
  const slopeWindowM = await reportSlopeWindow(site, time);
  const report: Report = {
    id: crypto.randomUUID(),
    siteId: input.siteId,
    time,
    direction: input.direction,
    strength: input.strength,
    slopeM: slopeWindowM ? slopeWindowM[REPORT_HOUR_INDEX] : null,
  };
  if (slopeWindowM) report.slopeWindowM = slopeWindowM;
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

async function reportSlopeWindow(site: Site, time: string): Promise<(number | null)[] | null> {
  try {
    const catalog = readCatalog();
    const atoll = catalog.atolls.find((item) => item.id === site.atollId);
    return await slopeWindowForSite(site, catalog.sites, atoll, time);
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
