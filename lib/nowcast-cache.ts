import { runInBackground, workerEnv, type R2Bucket } from "./cloudflare";
import { edgeRead, edgeWrite } from "./edge-cache";
import type { FetchOptions } from "./marine";
import { nowcastSites, type SiteNowcast } from "./nowcast";
import type { Atoll, Site } from "./types";

/** A saved map younger than this is served as it is; an older one from the same hour is served while a new one is made. */
const FRESH_MS = 5 * 60 * 1000;
const KEY_PREFIX = "nowcast/";
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
 * per Maldives hour, with a copy in the serving data centre (lib/edge-cache.ts), since R2 is in the US: a saved list
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
  const rebuild = () => buildMapNowcasts(sites, atolls, maldivesWall);
  const edge = parseSaved(await edgeRead(key));
  if (edge && edge.saved.sitesKey === sitesKey) {
    const checkedLately = Date.now() - (lastChecked.get(key) ?? 0) < CHECK_EVERY_MS;
    if (!isFresh(edge.saved) && !checkedLately) {
      lastChecked.set(key, Date.now());
      runInBackground(
        (async () => {
          // Another data centre, an isolate or the warm-up may have saved a newer list already.
          const stored = await read(env.DATA, key);
          if (stored && stored.saved.sitesKey === sitesKey && stored.saved.computedAt > edge.saved.computedAt) {
            edgeWrite(key, stored.text, EDGE_SECONDS);
            if (isFresh(stored.saved)) return;
          }
          await rebuild();
        })(),
      );
    }
    return edge.saved.nowcasts;
  }
  const stored = await read(env.DATA, key);
  if (stored && stored.saved.sitesKey === sitesKey) {
    edgeWrite(key, stored.text, EDGE_SECONDS);
    if (!isFresh(stored.saved)) runInBackground(rebuild());
    return stored.saved.nowcasts;
  }
  return rebuild();
}

/**
 * Builds the map's nowcasts for the hour of maldivesWall and saves them in R2 and this data centre's copy. The map
 * rebuilds with { wait: false }; the warm-up passes its own options. Worker only: on Node it just computes.
 */
export async function buildMapNowcasts(
  sites: readonly Site[],
  atolls: readonly Atoll[],
  maldivesWall: string,
  options?: FetchOptions,
): Promise<SiteNowcast[]> {
  const nowcasts = await nowcastSites(sites, atolls, maldivesWall, options);
  const env = workerEnv();
  if (!env) return nowcasts;
  const key = hourKey(maldivesWall);
  const text = JSON.stringify({ computedAt: Date.now(), sitesKey: siteIdsKey(sites), nowcasts } satisfies SavedNowcasts);
  await save(env.DATA, key, text);
  edgeWrite(key, text, EDGE_SECONDS);
  return nowcasts;
}

function hourKey(maldivesWall: string): string {
  return `${KEY_PREFIX}${maldivesWall.slice(0, 13)}.json`;
}

function isFresh(saved: SavedNowcasts): boolean {
  return Date.now() - saved.computedAt <= FRESH_MS;
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

async function read(bucket: R2Bucket, key: string): Promise<{ saved: SavedNowcasts; text: string } | null> {
  try {
    const object = await bucket.get(key);
    return object ? parseSaved(await object.text()) : null;
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

async function save(bucket: R2Bucket, key: string, text: string): Promise<void> {
  try {
    await bucket.put(key, text);
  } catch (error) {
    console.warn("Failed to save map nowcasts", error);
  }
}
