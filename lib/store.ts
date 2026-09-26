import fs from "fs";
import path from "path";
import type { Catalog, Rating, Report, Site, StoreData } from "./types";

const CATALOG_PATH = path.join(process.cwd(), "data", "sites.json");
const DEFAULT_STORE_PATH = path.join(process.cwd(), "data", "store.json");
let storePath = DEFAULT_STORE_PATH;

export function setStorePath(filePath: string) {
  storePath = filePath;
}

export function readCatalog(): Catalog {
  const raw = fs.readFileSync(CATALOG_PATH, "utf8");
  return JSON.parse(raw) as Catalog;
}

export function readStore(): StoreData {
  try {
    const raw = fs.readFileSync(storePath, "utf8");
    return normalizeStore(JSON.parse(raw));
  } catch (error) {
    if (isMissingFile(error)) return emptyStore();
    if (error instanceof SyntaxError) {
      fs.renameSync(storePath, `${storePath}.corrupt.${Date.now()}`);
      return emptyStore();
    }
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

export async function addUserSite(site: Site): Promise<Site> {
  return mutateStore((store) => {
    if (store.sites.some((existing) => existing.id === site.id)) return site;
    store.sites.push(site);
    return site;
  });
}

export async function addReport(report: Report): Promise<Report> {
  return mutateStore((store) => {
    store.reports.push(report);
    return report;
  });
}

export async function saveRating(rating: Rating): Promise<Rating> {
  return mutateStore((store) => {
    const index = store.ratings.findIndex((item) => item.siteId === rating.siteId);
    if (index >= 0) store.ratings[index] = rating;
    else store.ratings.push(rating);
    return rating;
  });
}

let mutationChain: Promise<unknown> = Promise.resolve();

/** Process-local: this queue does not coordinate other Node processes. */
function mutateStore<T>(mutate: (store: StoreData) => T): Promise<T> {
  const run = mutationChain.then(() => {
    const store = readStore();
    const result = mutate(store);
    writeStore(store);
    return result;
  });
  mutationChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function writeStore(store: StoreData) {
  const dir = path.dirname(storePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.store.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(tmpPath, `${JSON.stringify(store, null, 2)}\n`);
    fs.renameSync(tmpPath, storePath);
  } catch (error) {
    fs.rmSync(tmpPath, { force: true });
    throw error;
  }
}
