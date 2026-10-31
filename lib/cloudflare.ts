import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * The bindings in wrangler.jsonc. ASSETS serves the built static files, which include the read-only data files
 * (scripts/cf-assets.ts copies them to /_data/). DATA is the R2 bucket holding the Open-Meteo cache (and the old
 * store.json, copied into D1 once). DB is the D1 database holding reports, ratings, added pins and accounts.
 */
export type WorkerEnv = {
  ASSETS: { fetch: (input: string) => Promise<Response> };
  DATA: R2Bucket;
  DB: D1Database;
};

/** The subset of Cloudflare's D1 binding this app uses. A batch runs as one transaction. */
export type D1Database = {
  prepare: (sql: string) => D1PreparedStatement;
  batch: (statements: D1PreparedStatement[]) => Promise<unknown[]>;
};

export type D1PreparedStatement = {
  bind: (...values: unknown[]) => D1PreparedStatement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
};

/** The subset of Cloudflare's R2 binding this app uses. */
export type R2Bucket = {
  get: (key: string) => Promise<{ text: () => Promise<string> } | null>;
  put: (key: string, value: string) => Promise<unknown>;
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
 * A setting or secret by name: the worker's binding (wrangler vars and secrets) when there is one, else the process
 * environment (Docker, next dev). Empty means unset.
 */
export function appSetting(name: string): string | null {
  const bound = (workerEnv() as Record<string, unknown> | null)?.[name];
  const value = typeof bound === "string" ? bound : process.env[name];
  return value ? value : null;
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

/** A map of promises in flight by key, per request on a worker (perRequest). Callers asking for the same key share one. */
export function inFlightPerRequest<V>(): () => Map<string, Promise<V>> {
  return perRequest(() => new Map<string, Promise<V>>());
}
