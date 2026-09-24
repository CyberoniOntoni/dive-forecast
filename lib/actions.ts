"use server";

import { nearestAtoll } from "./bearing";
import { FORECAST_NOTICE, residualSlopeWindow, toMaldivesWall } from "./forecast";
import { loadSite } from "./load-site";
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

export async function listSites(): Promise<Site[]> {
  return listMergedSites();
}

export async function getSite(id: string): Promise<Site | null> {
  return findSite(id);
}

export async function addSite(input: { name: string; lat: number; lon: number }): Promise<Site> {
  const name = input.name.trim();
  if (!name) throw new Error("Site name is required");
  if (!Number.isFinite(input.lat) || input.lat < -90 || input.lat > 90) throw new Error("Bad latitude");
  if (!Number.isFinite(input.lon) || input.lon < -180 || input.lon > 180) throw new Error("Bad longitude");
  const atolls = readCatalog().atolls;
  if (atolls.length === 0) throw new Error("No atolls");
  const atoll = nearestAtoll(input.lat, input.lon, atolls);
  const site: Site = {
    id: uniqueSiteId(name),
    name,
    atollId: atoll.id,
    lat: input.lat,
    lon: input.lon,
    sourceUrl: "user",
  };
  return addUserSite(site);
}

export async function rateSite(siteId: string, score: number): Promise<Rating> {
  if (!findSite(siteId)) throw new Error("Unknown site");
  if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error("Rating must be an integer from 1 to 5");
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
  if (input.direction !== "incoming" && input.direction !== "outgoing") throw new Error("Bad direction");
  if (!STRENGTHS.includes(input.strength)) throw new Error("Bad strength");
  const time = toMaldivesWall(input.time);
  const slopeWindowM = await reportSlopeWindow(site, time);
  const report: Report = {
    id: crypto.randomUUID(),
    siteId: input.siteId,
    time,
    direction: input.direction,
    strength: input.strength,
    slopeM: slopeWindowM ? slopeWindowM[6] : null,
  };
  if (slopeWindowM) report.slopeWindowM = slopeWindowM;
  return persistReport(report);
}

async function reportSlopeWindow(site: Site, time: string): Promise<(number | null)[] | null> {
  try {
    const catalog = readCatalog();
    const atoll = catalog.atolls.find((item) => item.id === site.atollId);
    const loaded = await loadSite(site, catalog.sites, atoll, reportsForSite(site.id));
    if (loaded.unavailable) return null;
    return residualSlopeWindow(loaded.marineHours, time);
  } catch {
    return null;
  }
}

export async function forecastSite(siteId: string): Promise<SiteForecast> {
  const site = findSite(siteId);
  if (!site) {
    return { hours: [], unavailable: true, notice: FORECAST_NOTICE, inwardBearingDeg: null, fetchedAt: null };
  }
  const catalog = readCatalog();
  const atoll = catalog.atolls.find((item) => item.id === site.atollId);
  const loaded = await loadSite(site, catalog.sites, atoll, reportsForSite(siteId));
  return {
    hours: loaded.hours,
    unavailable: loaded.unavailable,
    notice: FORECAST_NOTICE,
    inwardBearingDeg: loaded.bearing,
    fetchedAt: loaded.fetchedAt,
  };
}

function uniqueSiteId(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "site"}-${crypto.randomUUID().slice(0, 8)}`;
}