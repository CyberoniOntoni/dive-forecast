import type { WorkerEnv } from "./cloudflare";

/**
 * Until when a key missing from CACHE is looked up in DATA, where the caches lived before the move (eastern North
 * America). Writes go to CACHE only, and the hourly warm-up rewrites every series within about 4.5 hours, so after a
 * few hours DATA holds nothing CACHE lacks; past this time a miss costs no extra round trip. Remove once passed.
 */
export const DATA_FALLBACK_UNTIL_MS = Date.parse("2026-11-12T00:00:00Z");

/**
 * The R2 bucket for regenerable caches (Open-Meteo series under marine-cache/, the map's nowcast/ lists). CACHE was
 * created with the Asia-Pacific location hint, close to the Maldives; DATA keeps site photos and the old store.json
 * backup. A worker without a CACHE binding (previews) keeps its caches in DATA.
 */
function cacheBucket(env: WorkerEnv) {
  return env.CACHE ?? env.DATA;
}

/** A cache object's text, or null when there is none. Nothing is copied across: the next write puts it in CACHE. */
export async function cacheGet(env: WorkerEnv, key: string, now = Date.now()): Promise<string | null> {
  const object = await cacheBucket(env).get(key);
  if (object) return object.text();
  if (!env.CACHE || now >= DATA_FALLBACK_UNTIL_MS) return null;
  const old = await env.DATA.get(key);
  return old ? old.text() : null;
}

export async function cachePut(env: WorkerEnv, key: string, text: string): Promise<void> {
  await cacheBucket(env).put(key, text);
}
