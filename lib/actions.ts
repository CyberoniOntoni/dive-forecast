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

export async function listSites(): Promise<Site[]> {
  return listMergedSites();
}

export async function getSite(id: string): Promise<Site | null> {
  return findSite(id);
}

export async function addSite(input: { name: string; lat: number; lon: number }): Promise<Site> {
  const name = requireSiteName(input.name);
  requireLatitude(input.lat);
  requireLongitude(input.lon);
  const atolls = readCatalog().atolls;
  if (atolls.length === 0) throw new Error("No atolls");

  const atoll = nearestAtoll(input.lat, input.lon, atolls);
  return addUserSite(newUserSite(name, input.lat, input.lon, atoll.id));
}

export async function rateSite(siteId: string, score: number): Promise<Rating> {
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
    notice: FORECAST_NOTICE,
    inwardBearingDeg: loaded.bearing,
    fetchedAt: loaded.fetchedAt,
  };
}

function unavailableForecast(): SiteForecast {
  return { hours: [], unavailable: true, notice: FORECAST_NOTICE, inwardBearingDeg: null, fetchedAt: null };
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

function requireSiteName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Site name is required");
  return trimmed;
}

function requireLatitude(lat: number): void {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error("Bad latitude");
}

function requireLongitude(lon: number): void {
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new Error("Bad longitude");
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
