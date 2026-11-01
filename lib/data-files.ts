import fs from "fs";
import path from "path";
import { inFlightPerRequest, workerEnv } from "./cloudflare";

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

/**
 * Files the app reads only for one feature, fetched by the actions that need them (ready(...)) instead of by every
 * request on a fresh isolate. The shelter grid is 8.5 MB, more than all the other files together, and only the
 * map's sheltered-water layer reads it.
 */
export const ON_DEMAND_DATA_FILES: readonly DataFile[] = ["shelter-grid.json"];

/** The files every server action needs before its synchronous readers run. */
export const CORE_DATA_FILES: readonly DataFile[] = DATA_FILES.filter((name) => !ON_DEMAND_DATA_FILES.includes(name));

/** On a worker: each loaded file's text, or null when the build had no such file. Loaded once per isolate. */
const loaded = new Map<DataFile, string | null>();
/** Loads under way by file, per request (perRequest): requests arriving together on a cold isolate each fetch. */
const loadsInFlight = inFlightPerRequest<void>();

/**
 * Fetches the named data files (by default every file but the on-demand ones) from the worker's static assets, once
 * per isolate, so the synchronous loaders below can read them. Does nothing on Node. Every server action calls it
 * first (lib/ready.ts).
 */
export function preloadDataFiles(names: readonly DataFile[] = CORE_DATA_FILES): Promise<void> {
  const env = workerEnv();
  if (!env) return Promise.resolve();
  const inFlight = loadsInFlight();
  return Promise.all(
    names
      .filter((name) => !loaded.has(name))
      .map((name) => {
        const running = inFlight.get(name);
        if (running) return running;
        const load = (async () => {
          const response = await env.ASSETS.fetch(`https://assets.local/_data/${name}`);
          if (response.status === 404) {
            loaded.set(name, null);
            return;
          }
          if (!response.ok) throw new Error(`data/${name}: HTTP ${response.status} from static assets`);
          loaded.set(name, await response.text());
        })().finally(() => inFlight.delete(name));
        inFlight.set(name, load);
        return load;
      }),
  ).then(() => undefined);
}

/**
 * The text of data/<name>. A missing file throws an ENOENT error on both runtimes, so each loader's "missing file
 * means none" rule holds on Cloudflare too. On a worker, reading before preloadDataFiles has run throws: a silent
 * "missing" there would drop rims or shelter without a word.
 */
export function readDataFile(name: DataFile): string {
  if (!workerEnv()) return fs.readFileSync(path.join(process.cwd(), "data", name), "utf8");
  if (!loaded.has(name)) throw new Error(`data/${name} read before preloadDataFiles()`);
  const text = loaded.get(name);
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
