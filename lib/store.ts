import fs from "fs";
import path from "path";
import type { Catalog, Rating, Report, Site, StoreData } from "./types";

const CATALOG_PATH = path.join(process.cwd(), "data", "sites.json");
const STORE_PATH = path.join(process.cwd(), "data", "store.json");

export function readCatalog(): Catalog {
  const raw = fs.readFileSync(CATALOG_PATH, "utf8");
  return JSON.parse(raw) as Catalog;
}

export function readStore(): StoreData {
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    return normalizeStore(JSON.parse(raw));
  } catch (error) {
    if (isMissingFile(error)) return emptyStore();
    throw error;
  }
}

function emptyStore(): StoreData {
  return { reports: [], ratings: [], sites: [] };
}

function normalizeStore(parsed: unknown): StoreData {
  const record = parsed as Partial<StoreData>;
  return {
    reports: Array.isArray(record.reports) ? record.reports : [],
    ratings: Array.isArray(record.ratings) ? record.ratings : [],
    sites: Array.isArray(record.sites) ? record.sites : [],
  };
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export function listMergedSites(): Site[] {
  const published = readCatalog().sites;
  const added = readStore().sites;
  const publishedIds = new Set(published.map((site) => site.id));
  const onlyAdded = added.filter((site) => !publishedIds.has(site.id));
  return [...published, ...onlyAdded];
}

export function findSite(id: string): Site | null {
  return listMergedSites().find((site) => site.id === id) ?? null;
}

export function reportsForSite(siteId: string): Report[] {
  return readStore().reports.filter((report) => report.siteId === siteId);
}

export function ratingForSite(siteId: string): Rating | null {
  return readStore().ratings.find((rating) => rating.siteId === siteId) ?? null;
}

export function addUserSite(site: Site): Site {
  const store = readStore();
  store.sites.push(site);
  writeStore(store);
  return site;
}

export function addReport(report: Report): Report {
  const store = readStore();
  store.reports.push(report);
  writeStore(store);
  return report;
}

export function saveRating(rating: Rating): Rating {
  const store = readStore();
  const index = store.ratings.findIndex((item) => item.siteId === rating.siteId);
  if (index >= 0) store.ratings[index] = rating;
  else store.ratings.push(rating);
  writeStore(store);
  return rating;
}

function writeStore(store: StoreData) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`);
}
