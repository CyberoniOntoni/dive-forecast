import { inFlightPerRequest, runInBackground, type WorkerEnv } from "./cloudflare";

/**
 * The R2 bucket for regenerable caches (Open-Meteo series under marine-cache/, the map's nowcast/ lists). CACHE is a
 * bucket created with the Asia-Pacific location hint, close to the Maldives; DATA (eastern North America) keeps site
 * photos and the old store.json backup. A worker without a CACHE binding keeps its caches in DATA as before.
 */
export function cacheBucket(env: WorkerEnv) {
  return env.CACHE ?? env.DATA;
}

/** Copies from DATA into CACHE still in flight in this request, by key, so a newer write never lands before one. */
const copying = inFlightPerRequest<unknown>();

/**
 * A cache object's text, or null when there is none. While the CACHE bucket fills after the move, a key it does not
 * have yet is read from DATA once and copied across behind the response, so the first visitors after the move do
 * not wait for Open-Meteo. An old copy is no worse than any other cached series: past its TTL it is refreshed.
 */
export async function cacheGet(env: WorkerEnv, key: string): Promise<string | null> {
  const bucket = cacheBucket(env);
  const object = await bucket.get(key);
  if (object) return object.text();
  if (!env.CACHE || env.CACHE === env.DATA) return null;
  const old = await env.DATA.get(key);
  if (!old) return null;
  const text = await old.text();
  const copy = Promise.resolve(bucket.put(key, text)).catch(() => null);
  copying().set(key, copy);
  runInBackground(copy);
  return text;
}

export async function cachePut(env: WorkerEnv, key: string, text: string): Promise<void> {
  await copying().get(key);
  await cacheBucket(env).put(key, text);
}
