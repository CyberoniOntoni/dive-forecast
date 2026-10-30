import fs from "fs";
import path from "path";
import { perRequest, workerEnv } from "./cloudflare";

/**
 * The read-only files under data/ that the running app reads. On Cloudflare they ship as static assets under /_data/
 * (scripts/cf-assets.ts copies exactly this list), since a worker has no data/ folder to read.
 */
export const DATA_FILES = [
  "sites.json",
  "rims.json",
  "openings.json",
  "islands.json",
  "shoals.json",
  "shelter-grid.json",
  "seaward-floor.json",
  "replay.json",
] as const;

export type DataFile = (typeof DATA_FILES)[number];

/** On a worker: each file's text, or null when the build had no such file. Loaded once per isolate. */
let preloaded: Map<DataFile, string | null> | null = null;
/** A preload under way, per request (perRequest): requests arriving together on a cold isolate each fetch. */
const preloadInFlight = perRequest(() => ({ promise: null as Promise<void> | null }));

/**
 * Fetches every data file from the worker's static assets, once per isolate, so the synchronous loaders below can read
 * them. Does nothing on Node. Every server action calls it first (lib/actions.ts).
 */
export function preloadDataFiles(): Promise<void> {
  const env = workerEnv();
  if (!env || preloaded) return Promise.resolve();
  const preloading = preloadInFlight();
  preloading.promise ??= Promise.all(
    DATA_FILES.map(async (name) => {
      const response = await env.ASSETS.fetch(`https://assets.local/_data/${name}`);
      if (response.status === 404) return [name, null] as const;
      if (!response.ok) throw new Error(`data/${name}: HTTP ${response.status} from static assets`);
      return [name, await response.text()] as const;
    }),
  )
    .then((entries) => {
      preloaded = new Map(entries);
    })
    .finally(() => {
      preloading.promise = null;
    });
  return preloading.promise;
}

/**
 * The text of data/<name>. A missing file throws an ENOENT error on both runtimes, so each loader's "missing file
 * means none" rule holds on Cloudflare too. On a worker, reading before preloadDataFiles has run throws: a silent
 * "missing" there would drop rims or shelter without a word.
 */
export function readDataFile(name: DataFile): string {
  if (!workerEnv()) return fs.readFileSync(path.join(process.cwd(), "data", name), "utf8");
  if (!preloaded) throw new Error(`data/${name} read before preloadDataFiles()`);
  const text = preloaded.get(name);
  if (text == null) {
    throw Object.assign(new Error(`ENOENT: data/${name} is not in this build`), { code: "ENOENT" });
  }
  return text;
}

/** The text of data/<name>, or null when the file is missing. Any other read error throws. */
export function readDataFileIfPresent(name: DataFile): string | null {
  try {
    return readDataFile(name);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
