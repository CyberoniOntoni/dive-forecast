import { runInBackground, workerEnv, type R2Bucket } from "./cloudflare";
import { nowcastSites, type SiteNowcast } from "./nowcast";
import type { Atoll, Site } from "./types";

/** A saved map younger than this is served as it is; an older one from the same hour is served while a new one is made. */
const FRESH_MS = 5 * 60 * 1000;
const KEY_PREFIX = "nowcast/";

type SavedNowcasts = { computedAt: number; sitesKey: string; nowcasts: SiteNowcast[] };

/**
 * The map's nowcasts. On Node this is nowcastSites, as the long-running process keeps its memos warm. On a worker a
 * fresh isolate would first load the data files and hundreds of cached series, so the finished list is saved in R2
 * per Maldives hour: a saved list for the same hour and the same sites is served at once, and one older than
 * FRESH_MS is rebuilt in the background. A new report or a point's first fetch shows on the map within one rebuild.
 */
export async function mapNowcasts(
  sites: readonly Site[],
  atolls: readonly Atoll[],
  maldivesWall: string,
): Promise<SiteNowcast[]> {
  const env = workerEnv();
  if (!env) return nowcastSites(sites, atolls, maldivesWall);
  const key = `${KEY_PREFIX}${maldivesWall.slice(0, 13)}.json`;
  const sitesKey = siteIdsKey(sites);
  const rebuild = async () => {
    const nowcasts = await nowcastSites(sites, atolls, maldivesWall);
    await save(env.DATA, key, { computedAt: Date.now(), sitesKey, nowcasts });
    return nowcasts;
  };
  const saved = await read(env.DATA, key);
  if (saved && saved.sitesKey === sitesKey) {
    if (Date.now() - saved.computedAt > FRESH_MS) runInBackground(rebuild());
    return saved.nowcasts;
  }
  return rebuild();
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

async function read(bucket: R2Bucket, key: string): Promise<SavedNowcasts | null> {
  try {
    const object = await bucket.get(key);
    if (!object) return null;
    const parsed = JSON.parse(await object.text()) as Partial<SavedNowcasts>;
    if (typeof parsed.computedAt !== "number" || typeof parsed.sitesKey !== "string" || !Array.isArray(parsed.nowcasts)) {
      return null;
    }
    return parsed as SavedNowcasts;
  } catch {
    return null;
  }
}

async function save(bucket: R2Bucket, key: string, saved: SavedNowcasts): Promise<void> {
  try {
    await bucket.put(key, JSON.stringify(saved));
  } catch (error) {
    console.warn("Failed to save map nowcasts", error);
  }
}
