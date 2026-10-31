import fs from "fs";
import path from "path";
import { atollForPin } from "./bearing";
import { perRequest, workerEnv, type WorkerEnv } from "./cloudflare";
import { readDataFile } from "./data-files";
import { emptyStore, loadD1Store, normalizeStore, prepareD1, storeChanges } from "./store-d1";
import {
  UNSEEDED_ATOLL_ID,
  type Catalog,
  type Rating,
  type Report,
  type Site,
  type StoreData,
} from "./types";

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
 * On a worker: this request's store, as read from D1 by refreshStore (run by every server action) or as this request
 * last wrote it. Per request, so another request's refresh never swaps it mid-render. There is no data/ folder there;
 * the store lives in D1 (lib/store-d1.ts).
 */
const workerSnapshot = perRequest(() => ({ store: null as StoreData | null }));

/** Reads the store from D1 so this request's readStore sees other isolates' writes. Does nothing on Node. */
export async function refreshStore(): Promise<void> {
  const env = workerEnv();
  if (env) workerSnapshot().store = await readWorkerStore(env);
}

export function readStore(): StoreData {
  if (workerEnv()) {
    const { store } = workerSnapshot();
    if (!store) throw new Error("readStore() before refreshStore()");
    return store;
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

async function readWorkerStore(env: WorkerEnv): Promise<StoreData> {
  await prepareD1(env.DB, env.DATA);
  return loadD1Store(env.DB);
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

export function ratingsForSite(siteId: string): Rating[] {
  return readStore().ratings.filter((rating) => rating.siteId === siteId);
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

/** One rating per diver per site; a rating with no userId is the site's one anonymous rating from before sign-in. */
export async function saveRating(rating: Rating): Promise<Rating> {
  return mutateStore((store) => {
    const index = store.ratings.findIndex((item) => item.siteId === rating.siteId && item.userId === rating.userId);
    if (index >= 0) store.ratings[index] = rating;
    else store.ratings.push(rating);
    return rating;
  });
}

/** Per process on Node, per request on a worker (perRequest). */
const mutations = perRequest(() => ({ chain: Promise.resolve() as Promise<unknown> }));

/**
 * Changes the store in one read-change-write. `mutate` must only change the store it is given. Process-local on Node:
 * this queue does not coordinate other Node processes. On a worker the store is read fresh from D1 and only the
 * records `mutate` changed are written, in one transaction, so isolates writing at the same time do not lose each
 * other's records.
 */
export function mutateStore<T>(mutate: (store: StoreData) => T): Promise<T> {
  const queue = mutations();
  const run = queue.chain.then(() => {
    const env = workerEnv();
    if (env) return mutateWorkerStore(env, mutate);
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

async function mutateWorkerStore<T>(env: WorkerEnv, mutate: (store: StoreData) => T): Promise<T> {
  const store = await readWorkerStore(env);
  const before = structuredClone(store);
  const result = mutate(store);
  const changes = storeChanges(env.DB, before, store);
  if (changes.length > 0) {
    try {
      await env.DB.batch(changes);
    } catch (error) {
      // Two first sign-ins for one address at once: the database keeps one account; the other is asked to retry.
      if (/UNIQUE constraint failed: users\.email/.test(String((error as Error)?.message))) {
        throw new Error("That account was just created. Try again.");
      }
      throw error;
    }
  }
  workerSnapshot().store = store;
  return result;
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
