import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * The bindings in wrangler.jsonc. ASSETS serves the built static files, which include the read-only data files
 * (scripts/cf-assets.ts copies them to /_data/). DATA is the R2 bucket holding store.json and the Open-Meteo cache.
 */
export type WorkerEnv = {
  ASSETS: { fetch: (input: string) => Promise<Response> };
  DATA: R2Bucket;
};

/** The subset of Cloudflare's R2 binding this app uses. */
export type R2Bucket = {
  get: (key: string) => Promise<{ text: () => Promise<string>; etag: string } | null>;
  put: (
    key: string,
    value: string,
    options?: { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } },
  ) => Promise<{ etag: string } | null>;
};

type Context = { env: WorkerEnv; ctx: { waitUntil: (promise: Promise<unknown>) => void } };

/**
 * The Cloudflare request context, or null when the app runs on Node (next dev, next start in Docker, tests, scripts).
 * OpenNext's worker sets the context before any page or action runs; anywhere else getCloudflareContext throws.
 */
function context(): Context | null {
  try {
    return getCloudflareContext() as unknown as Context;
  } catch {
    return null;
  }
}

/** The worker's bindings, or null on Node. */
export function workerEnv(): WorkerEnv | null {
  return context()?.env ?? null;
}

/**
 * Lets work run on after the response is sent. A worker drops unfinished promises when the response is done, so a
 * background cache refresh needs waitUntil there; on Node the promise just runs.
 */
export function runInBackground(promise: Promise<unknown>): void {
  const settled = promise.catch(() => null);
  context()?.ctx.waitUntil(settled);
}

/**
 * State that holds promises, such as a map of fetches in flight. On a worker a request must not wait on a promise that
 * another request's I/O settles: the runtime cancels it as hung. So there the value is one per request; on Node it is
 * one per process, so concurrent page loads still share their fetches.
 */
export function perRequest<T>(make: () => T): () => T {
  let shared: { value: T } | null = null;
  const byRequest = new WeakMap<Context, T>();
  return () => {
    const current = context();
    if (!current) return (shared ??= { value: make() }).value;
    if (!byRequest.has(current)) byRequest.set(current, make());
    return byRequest.get(current) as T;
  };
}
