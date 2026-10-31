import { appSetting, runInBackground, workerEnv } from "./cloudflare";

/**
 * A copy of R2 objects in the Cloudflare data centre serving the request (the Workers Cache API). The R2 bucket sits in
 * eastern North America, so from the Maldives every R2 read crosses the world, and a site page reads 10 to 30 of
 * them on a fresh isolate. The edge copy is read in a few milliseconds. Only the Open-Meteo series use it: the map's
 * saved nowcasts change every few minutes and stay in R2 alone. It is only ever a copy: callers check the
 * text they get for freshness and go to R2 when it is too old, and the data centre may drop it at any time.
 */
type EdgeCache = {
  match: (key: string) => Promise<Response | undefined>;
  put: (key: string, response: Response) => Promise<void>;
};

/**
 * Keys sit under the worker's own domain (APP_URL), as the Cache API scopes entries to the zone. The path is never
 * served: requests reach the worker before any cache, and nothing routes /__r2-copy/.
 */
function keyOrigin(): string {
  return `${(appSetting("APP_URL") ?? "https://50bar.app").replace(/\/+$/, "")}/__r2-copy/`;
}

/** The worker's default cache, or null on Node (and anywhere the Cache API is missing). */
function edgeCache(): EdgeCache | null {
  if (!workerEnv()) return null;
  const caches = (globalThis as { caches?: { default?: EdgeCache } }).caches;
  return caches?.default ?? null;
}

function keyUrl(key: string): string {
  return `${keyOrigin()}${key.split("/").map(encodeURIComponent).join("/")}`;
}

/** The edge copy of an R2 object's text, or null when there is none (or no Cache API, or it failed). */
export async function edgeRead(key: string): Promise<string | null> {
  const cache = edgeCache();
  if (!cache) return null;
  try {
    const response = await cache.match(keyUrl(key));
    return response ? await response.text() : null;
  } catch {
    return null;
  }
}

/** Keeps a copy of an R2 object's text at the edge for up to maxAgeSeconds, after the response is sent. */
export function edgeWrite(key: string, text: string, maxAgeSeconds: number): void {
  const cache = edgeCache();
  if (!cache) return;
  try {
    const response = new Response(text, {
      headers: { "content-type": "application/json", "cache-control": `max-age=${Math.max(1, Math.round(maxAgeSeconds))}` },
    });
    runInBackground(cache.put(keyUrl(key), response));
  } catch {
    // An edge copy is only a shortcut: R2 stays the store.
  }
}
