import fs from "fs";
import path from "path";
import { atollForPin } from "./bearing";
import { perRequest, workerEnv, type R2Bucket } from "./cloudflare";
import { readDataFile } from "./data-files";
import { UNSEEDED_ATOLL_ID, type Catalog, type Rating, type Report, type Site, type StoreData } from "./types";

const DEFAULT_STORE_FILE = "store.json";
let storeFile = DEFAULT_STORE_FILE;

export function setStorePath(filePath: string) {
  const base = path.basename(filePath);
  if (!base || base === "." || base === "..") {
    throw new Error("Store file must be a name under data/");
  }
  storeFile = base;
}

export function readCatalog(): Catalog {
  const raw = readDataFile("sites.json");
  return JSON.parse(raw) as Catalog;
}

/**
 * On a worker: the store as last read from R2 (refreshStore, run by every server action) or as last written by this
 * isolate. There is no data/ folder there; store.json lives in the DATA bucket under the same name.
 */
let workerSnapshot: StoreData | null = null;

/** Reads store.json from R2 so this request's readStore sees other isolates' writes. Does nothing on Node. */
export async function refreshStore(): Promise<void> {
  const env = workerEnv();
  if (env) workerSnapshot = (await readWorkerStore(env.DATA)).store;
}

export function readStore(): StoreData {
  if (workerEnv()) {
    if (!workerSnapshot) throw new Error("readStore() before refreshStore()");
    return workerSnapshot;
  }
  const file = path.join(process.cwd(), "data", storeFile);
  try {
    const raw = fs.readFileSync(file, "utf8");
    return normalizeStore(JSON.parse(raw));
  } catch (error) {
    if (isMissingFile(error)) return emptyStore();
    if (error instanceof SyntaxError) {
      try {
        fs.renameSync(file, `${file}.corrupt.${Date.now()}`);
      } catch (renameError) {
        console.error("Failed to quarantine corrupt store file", renameError);
      }
      return emptyStore();
    }
    throw error;
  }
}

/**
 * store.json from R2 with its etag (null when there is none yet). Corrupt JSON is copied aside as on Node and read as
 * empty; the etag is kept, so the next write replaces the corrupt object only if nobody changed it meanwhile.
 */
async function readWorkerStore(bucket: R2Bucket): Promise<{ store: StoreData; etag: string | null }> {
  const object = await bucket.get(storeFile);
  if (!object) return { store: emptyStore(), etag: null };
  const raw = await object.text();
  try {
    return { store: normalizeStore(JSON.parse(raw)), etag: object.etag };
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    try {
      await bucket.put(`${storeFile}.corrupt.${Date.now()}`, raw);
    } catch (copyError) {
      console.error("Failed to quarantine corrupt store object", copyError);
    }
    return { store: emptyStore(), etag: object.etag };
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
  const catalog = readCatalog();
  const published = catalog.sites;
  const added = readStore().sites;
  const publishedIds = new Set(published.map((site) => site.id));
  const onlyAdded = added
    .filter((site) => !publishedIds.has(site.id))
    .map((site) => withCurrentAtoll(site, catalog.atolls));
  return [...published, ...onlyAdded];
}

/** An app-added pin's atoll is worked out from where it sits now, not from what was stored when it was added. */
function withCurrentAtoll(site: Site, atolls: Catalog["atolls"]): Site {
  if (site.sourceUrl !== "user") return site;
  const atollId = atollForPin(site.lat, site.lon, atolls)?.id ?? UNSEEDED_ATOLL_ID;
  return atollId === site.atollId ? site : { ...site, atollId };
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

/** Per process on Node, per request on a worker (perRequest). */
const mutations = perRequest(() => ({ chain: Promise.resolve() as Promise<unknown> }));

/** Process-local: this queue does not coordinate other Node processes. On a worker, R2's etag check does that. */
function mutateStore<T>(mutate: (store: StoreData) => T): Promise<T> {
  const queue = mutations();
  const run = queue.chain.then(() => {
    const env = workerEnv();
    if (env) return mutateWorkerStore(env.DATA, mutate);
    const store = readStore();
    const result = mutate(store);
    writeStore(store);
    return result;
  });
  queue.chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const WORKER_WRITE_ATTEMPTS = 5;

/**
 * Read, change and write store.json in R2, only if nobody wrote it in between (etag match); otherwise start over from
 * the newer copy. Isolates in other places can write at the same time, so the process-local queue is not enough.
 * The very first write (no object yet) is unconditional.
 */
async function mutateWorkerStore<T>(bucket: R2Bucket, mutate: (store: StoreData) => T): Promise<T> {
  for (let attempt = 0; attempt < WORKER_WRITE_ATTEMPTS; attempt += 1) {
    const { store, etag } = await readWorkerStore(bucket);
    const result = mutate(store);
    const written = await bucket.put(storeFile, serializeStore(store), etag ? { onlyIf: { etagMatches: etag } } : undefined);
    if (written) {
      workerSnapshot = store;
      return result;
    }
  }
  throw new Error(`store.json changed during ${WORKER_WRITE_ATTEMPTS} write attempts in a row`);
}

function serializeStore(store: StoreData): string {
  return `${JSON.stringify(store, null, 2)}\n`;
}

function writeStore(store: StoreData) {
  const file = path.join(process.cwd(), "data", storeFile);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.store.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(tmpPath, serializeStore(store));
    fs.renameSync(tmpPath, file);
  } catch (error) {
    fs.rmSync(tmpPath, { force: true });
    throw error;
  }
}
