import fs from "fs";
import path from "path";
import { atollForPin } from "./bearing";
import { readOpenings } from "./openings";
import { rimForAtoll, rimWayId } from "./rim";
import { deriveSiteType, onRimBand } from "./site-type";
import { perRequest, workerEnv, type WorkerEnv } from "./cloudflare";
import { readDataFile } from "./data-files";
import {
  emptyStore,
  GUARD_FAILED,
  loadD1Rows,
  normalizeStore,
  prepareD1,
  readStoreVersion,
  storeChanges,
} from "./store-d1";
import {
  UNSEEDED_ATOLL_ID,
  type Catalog,
  type Rating,
  type Report,
  type Site,
  type SitePhoto,
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

/**
 * The isolate's last full read of the store, by the store version it was read at. A request first reads the version
 * (one row) and reuses this copy while it matches, so a page view does not read every row of every table. Plain data,
 * never a promise, so sharing it across requests is safe; nothing changes it in place (mutateStore reads afresh).
 * Kept at most ISOLATE_STORE_MAX_MS, in case the database was edited by hand without changing the version.
 */
let isolateStore: { version: string; store: StoreData; readAt: number } | null = null;
const ISOLATE_STORE_MAX_MS = 10 * 60 * 1000;

/** Reads the store from D1 so this request's readStore sees other isolates' writes. Does nothing on Node. */
export async function refreshStore(): Promise<void> {
  const env = workerEnv();
  if (!env) return;
  await prepareD1(env.DB, env.DATA);
  const now = Date.now();
  if (isolateStore && now - isolateStore.readAt < ISOLATE_STORE_MAX_MS) {
    const version = await readStoreVersion(env.DB);
    if (version === isolateStore.version) {
      workerSnapshot().store = isolateStore.store;
      return;
    }
  }
  const { store, version } = await readWorkerRows(env);
  isolateStore = { version, store, readAt: now };
  workerSnapshot().store = store;
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

/** The store when this request can read it without waiting: always on Node, after refreshStore on a worker. */
export function peekStore(): StoreData | null {
  if (workerEnv() && !workerSnapshot().store) return null;
  return readStore();
}

async function readWorkerRows(env: WorkerEnv) {
  await prepareD1(env.DB, env.DATA);
  return loadD1Rows(env.DB);
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
    .filter((site) => !publishedIds.has(site.id) && !site.hidden)
    .map((site) => withCurrentPlace(site, catalog));
  return [...published, ...onlyAdded];
}

/**
 * An app-added pin's atoll and site type are worked out from where it sits now, not stored when it was added, so a
 * better outline, a new pass or a new reef gap reaches old pins too. The pin's position decides (deriveSiteType, with
 * the catalog's passes and the atoll's open reef gaps): well inside the outline is lagoon, outside it the ocean wall,
 * and on the rim a pin in a gap is a pass. On the rim band, where that cannot be sure, the adder's pick
 * (diverSiteType) wins. No type in an unseeded atoll. Catalog sites never see these pins as mates, so a pick or a
 * position changes only the pin's own forecast.
 */
export function withCurrentPlace(site: Site, catalog: Pick<Catalog, "atolls" | "sites">): Site {
  if (site.sourceUrl !== "user") return site;
  const atoll = atollForPin(site.lat, site.lon, catalog.atolls);
  const atollId = atoll?.id ?? UNSEEDED_ATOLL_ID;
  const placed: Site = { ...site, atollId };
  delete placed.siteType;
  delete placed.siteTypeSource;
  if (!atoll) return placed;
  const ring = rimForAtoll(atoll);
  if (site.diverSiteType && (!ring || onRimBand(site, ring))) {
    placed.siteType = site.diverSiteType;
    placed.siteTypeSource = "diver";
    return placed;
  }
  const passes = catalog.sites.filter((mate) => mate.atollId === atollId && mate.siteType === "pass");
  const wayId = rimWayId(atoll);
  // A gap a reef flat bridges is a shallow sill, not a channel divers drop into.
  const channels = readOpenings().filter((gap) => gap.wayId === wayId && !gap.reefFlatBridges);
  const derived = deriveSiteType(site, ring, passes, channels);
  if (derived) {
    placed.siteType = derived;
    placed.siteTypeSource = "derived";
  }
  return placed;
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

/** Adds an app-added pin. With `perDay`, throws when its adder already added that many in the last 24 hours. */
export async function addUserSite(site: Site, perDay?: number): Promise<Site> {
  return mutateStore((store) => {
    if (store.sites.some((existing) => existing.id === site.id)) return site;
    if (perDay != null && site.addedBy) {
      const since = Date.parse(site.addedAt ?? new Date().toISOString()) - 24 * 60 * 60 * 1000;
      const recent = store.sites.filter(
        (existing) => existing.addedBy === site.addedBy && existing.addedAt && Date.parse(existing.addedAt) > since,
      );
      if (recent.length >= perDay) throw new Error(`You can add up to ${perDay} sites a day. Try again tomorrow.`);
    }
    store.sites.push(site);
    return site;
  });
}

/**
 * Adds a photo record to an app-added site, if the site still has room. Returns false (nothing changed) when the
 * site is not an app-added pin or already has `max` photos.
 */
export async function addSitePhotoRecord(siteId: string, photo: SitePhoto, max: number): Promise<boolean> {
  return mutateStore((store) => {
    const site = store.sites.find((item) => item.id === siteId);
    if (!site) return false;
    const photos = site.photos ?? [];
    if (photos.length >= max) return false;
    site.photos = [...photos, photo];
    return true;
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

/** Times a change is read and tried again after another request changed the same records first. */
const MUTATE_TRIES = 8;

/**
 * One change on D1: read, change, write the touched records with guards (lib/store-d1.ts storeChanges). When
 * another request changed one of those records (or a watched list) in between, the batch writes nothing and the
 * change runs again on a fresh read, so counters such as a sign-in code's wrong tries never lose a count.
 */
async function mutateWorkerStore<T>(env: WorkerEnv, mutate: (store: StoreData) => T): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const { store, raw } = await readWorkerRows(env);
    const before = structuredClone(store);
    const result = mutate(store);
    const changes = storeChanges(env.DB, before, store, raw);
    if (changes.length > 0) {
      try {
        await env.DB.batch(changes);
      } catch (error) {
        const message = String((error as Error)?.message);
        if (GUARD_FAILED.test(message)) {
          if (attempt >= MUTATE_TRIES) throw new Error("The app is busy. Try again in a moment.");
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 20 * attempt));
          continue;
        }
        // Two first sign-ins for one address at once: the database keeps one account; the other is asked to retry.
        if (/UNIQUE constraint failed: users\.email/.test(message)) {
          throw new Error("That account was just created. Try again.");
        }
        if (/UNIQUE constraint failed: users\.nickname_key/.test(message)) throw new Error("That nickname is taken.");
        throw error;
      }
      isolateStore = null;
    }
    workerSnapshot().store = store;
    return result;
  }
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
