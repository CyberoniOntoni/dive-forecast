import { cacheGet, cachePut } from "./cache-bucket";
import { runInBackground, workerEnv, type WorkerEnv } from "./cloudflare";
import { edgeRead, edgeWrite } from "./edge-cache";
import { parseWall } from "./forecast";
import type { FetchOptions } from "./marine";
import { nowcastSites, type SiteNowcast } from "./nowcast";
import type { Atoll, Site } from "./types";

/** A saved map younger than this is served as it is; an older one from the same hour is served while a new one is made. */
const FRESH_MS = 5 * 60 * 1000;
const KEY_PREFIX = "nowcast/";
/** Maldives time is UTC+5 all year. */
const MALDIVES_OFFSET_MS = 5 * 60 * 60 * 1000;
/** How long a data centre keeps its copy of an hour's list: the hour, and a little over for clock skew. */
const EDGE_SECONDS = 65 * 60;
/** A data centre's copy older than FRESH_MS is checked against R2 at most this often per isolate. */
const CHECK_EVERY_MS = 60 * 1000;

type SavedNowcasts = { computedAt: number; sitesKey: string; nowcasts: SiteNowcast[] };

/** When this isolate last checked each hour's list against R2: plain times, shared across requests. */
const lastChecked = new Map<string, number>();

/**
 * The map's nowcasts. On Node this is nowcastSites, as the long-running process keeps its memos warm. On a worker a
 * fresh isolate would first load the data files and hundreds of cached series, so the finished list is saved in R2
 * per Maldives hour, with a copy in the serving data centre (lib/edge-cache.ts), since R2 may be far away: a saved list
 * for the same hour and the same sites is served at once, and one older than FRESH_MS is checked or rebuilt in the
 * background. The scheduled warm-up (lib/warm.ts) saves each hour's list before the hour starts, so the first map of
 * an hour does not build it. A new report or a point's first fetch shows on the map within one rebuild.
 */
export async function mapNowcasts(
  sites: readonly Site[],
  atolls: readonly Atoll[],
  maldivesWall: string,
): Promise<SiteNowcast[]> {
  const env = workerEnv();
  if (!env) return nowcastSites(sites, atolls, maldivesWall);
  const key = hourKey(maldivesWall);
  const sitesKey = siteIdsKey(sites);
  const rebuild = async () => (await buildMapNowcasts(sites, atolls, maldivesWall)).nowcasts;
  const fresh = (saved: SavedNowcasts) => isFresh(saved, maldivesWall);
  /** True once per CHECK_EVERY_MS per hour's list in this isolate: requests in between leave the check to it. */
  const claimCheck = () => {
    if (Date.now() - (lastChecked.get(key) ?? 0) < CHECK_EVERY_MS) return false;
    lastChecked.set(key, Date.now());
    return true;
  };
  const edge = parseSaved(await edgeRead(key));
  if (edge && edge.saved.sitesKey === sitesKey) {
    if (!fresh(edge.saved) && claimCheck()) {
      runInBackground(
        (async () => {
          // Another data centre, an isolate or the warm-up may have saved a newer list already.
          const stored = await read(env, key);
          const newer = stored && stored.saved.sitesKey === sitesKey && stored.saved.computedAt > edge.saved.computedAt;
          if (newer && fresh(stored.saved)) return edgeWrite(key, stored.text, EDGE_SECONDS);
          await rebuild();
        })(),
      );
    }
    return edge.saved.nowcasts;
  }
  const stored = await read(env, key);
  if (stored && stored.saved.sitesKey === sitesKey) {
    // A fresh list goes to the edge, so the next request takes the path above. An old one does not: it could land on
    // top of the newer copy a rebuild (this one or another request's) has just written there.
    if (fresh(stored.saved)) edgeWrite(key, stored.text, EDGE_SECONDS);
    else if (claimCheck()) runInBackground(rebuild());
    return stored.saved.nowcasts;
  }
  return rebuild();
}

/**
 * Builds the map's nowcasts for the hour of maldivesWall and saves them in R2 and this data centre's copy (for the
 * warm-up that is the cron's data centre, not the visitors'; they copy it from R2). The map rebuilds with
 * { wait: false }; the warm-up passes its own options. `saved` is false only when R2 refused the list (on Node,
 * which only computes, it is true).
 */
export async function buildMapNowcasts(
  sites: readonly Site[],
  atolls: readonly Atoll[],
  maldivesWall: string,
  options?: FetchOptions,
): Promise<{ nowcasts: SiteNowcast[]; saved: boolean }> {
  const nowcasts = await nowcastSites(sites, atolls, maldivesWall, options);
  const env = workerEnv();
  if (!env) return { nowcasts, saved: true };
  const key = hourKey(maldivesWall);
  const text = JSON.stringify({ computedAt: Date.now(), sitesKey: siteIdsKey(sites), nowcasts } satisfies SavedNowcasts);
  const saved = await save(env, key, text);
  edgeWrite(key, text, EDGE_SECONDS);
  return { nowcasts, saved };
}

function hourKey(maldivesWall: string): string {
  return `${KEY_PREFIX}${maldivesWall.slice(0, 13)}.json`;
}

/**
 * Younger than FRESH_MS, counted from when it was built or from the start of its hour if that is later: the warm-up
 * builds an hour's list at :50 of the hour before, and that list is new when its hour starts.
 */
function isFresh(saved: SavedNowcasts, maldivesWall: string): boolean {
  return Date.now() - Math.max(saved.computedAt, hourStartMs(maldivesWall)) <= FRESH_MS;
}

/** Unix ms at the start of the Maldives hour of a wall time. parseWall reads the wall as if it were UTC; it is UTC+5. */
function hourStartMs(maldivesWall: string): number {
  return parseWall(`${maldivesWall.slice(0, 13)}:00`) - MALDIVES_OFFSET_MS;
}

/** The site ids in order, hashed (FNV-1a): a pin added or removed makes a saved list stale. */
export function siteIdsKey(sites: readonly Site[]): string {
  let hash = 0x811c9dc5;
  for (const site of sites) {
    for (let at = 0; at < site.id.length; at += 1) {
      hash ^= site.id.charCodeAt(at);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0x2c;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${sites.length}:${(hash >>> 0).toString(16)}`;
}

async function read(env: WorkerEnv, key: string): Promise<{ saved: SavedNowcasts; text: string } | null> {
  try {
    return parseSaved(await cacheGet(env, key));
  } catch {
    return null;
  }
}

function parseSaved(text: string | null): { saved: SavedNowcasts; text: string } | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Partial<SavedNowcasts>;
    if (typeof parsed.computedAt !== "number" || typeof parsed.sitesKey !== "string" || !Array.isArray(parsed.nowcasts)) {
      return null;
    }
    return { saved: parsed as SavedNowcasts, text };
  } catch {
    return null;
  }
}

async function save(env: WorkerEnv, key: string, text: string): Promise<boolean> {
  try {
    await cachePut(env, key, text);
    return true;
  } catch (error) {
    console.warn("Failed to save map nowcasts", error);
    return false;
  }
}
