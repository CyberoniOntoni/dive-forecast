import { appSetting, perRequest, runInBackground, workerEnv } from "./cloudflare";

/**
 * A copy of R2 objects in the Cloudflare data centre serving the request (the Workers Cache API). The R2 bucket sits in
 * eastern North America, so from the Maldives every R2 read crosses the world, and a site page reads 10 to 30 of
 * them on a fresh isolate. The edge copy is read in a few milliseconds. The Open-Meteo series use it, and the map's
 * saved nowcasts have their own copy (lib/nowcast-cache.ts). It is only ever a copy: callers check the text they get
 * for freshness, serve one that is too old while they check R2 behind the response, and the data centre may drop it
 * at any time.
 */
type EdgeCache = {
  match: (key: string) => Promise<Response | undefined>;
  put: (key: string, response: Response) => Promise<void>;
};

/**
 * Keys sit under the worker's own domain (APP_URL), as the Cache API scopes entries to the zone. The path is never
 * served: requests reach the worker before any cache, and nothing routes /__r2-copy/. Null without APP_URL: a
 * worker that does not know its domain keeps no edge copy.
 */
function keyOrigin(): string | null {
  const app = appSetting("APP_URL");
  return app ? `${app.replace(/\/+$/, "")}/__r2-copy/` : null;
}

/**
 * Cache API calls one request may make. Workers Paid allows 1,000 match/put calls per invocation; the map's rebuild of
 * every site's nowcast reads about 550 series in one request, so past this budget it goes straight to R2 as before.
 */
export const EDGE_CALLS_PER_REQUEST = 400;
const callsThisRequest = perRequest(() => ({ count: 0 }));

/**
 * The worker's default cache, or null on Node, anywhere the Cache API is missing, and once this request has spent its
 * EDGE_CALLS_PER_REQUEST. Each non-null answer counts one call.
 */
function edgeCache(): EdgeCache | null {
  if (!workerEnv()) return null;
  const caches = (globalThis as { caches?: { default?: EdgeCache } }).caches;
  if (!caches?.default) return null;
  const calls = callsThisRequest();
  if (calls.count >= EDGE_CALLS_PER_REQUEST) return null;
  calls.count += 1;
  return caches.default;
}

function keyUrl(key: string): string | null {
  const origin = keyOrigin();
  return origin ? `${origin}${key.split("/").map(encodeURIComponent).join("/")}` : null;
}

/** The edge copy of an R2 object's text, or null when there is none (or no Cache API, or it failed). */
export async function edgeRead(key: string): Promise<string | null> {
  const url = keyUrl(key);
  const cache = url ? edgeCache() : null;
  if (!cache || !url) return null;
  try {
    const response = await cache.match(url);
    return response ? await response.text() : null;
  } catch {
    return null;
  }
}

/** Keeps a copy of an R2 object's text at the edge for up to maxAgeSeconds, after the response is sent. */
export function edgeWrite(key: string, text: string, maxAgeSeconds: number): void {
  if (!(maxAgeSeconds >= 1)) return;
  const url = keyUrl(key);
  const cache = url ? edgeCache() : null;
  if (!cache || !url) return;
  try {
    const response = new Response(text, {
      headers: { "content-type": "application/json", "cache-control": `max-age=${Math.round(maxAgeSeconds)}` },
    });
    runInBackground(cache.put(url, response));
  } catch {
    // An edge copy is only a shortcut: R2 stays the store.
  }
}
