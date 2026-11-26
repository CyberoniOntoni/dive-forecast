import { cacheGet, cachePut } from "./cache-bucket";
import { inFlightPerRequest, runInBackground, workerEnv } from "./cloudflare";
import { edgeRead, edgeWrite } from "./edge-cache";
import { flowField } from "./flow-field";
import type { FlowFieldView } from "./flow-wire";
import { parseWall } from "./forecast";
import type { FetchOptions } from "./marine";

/** A saved field younger than this is served as it is; an older one from the same hour is served while a new one is made. */
const FRESH_MS = 5 * 60 * 1000;
const KEY_PREFIX = "flowfield/";
const EDGE_SECONDS = 65 * 60;
const MALDIVES_OFFSET_MS = 5 * 60 * 60 * 1000;

type SavedField = { computedAt: number; field: FlowFieldView };

/** A background rebuild of an hour's field starts at most this often per isolate. */
const REBUILD_EVERY_MS = 60 * 1000;
/** When this isolate last started each hour's background rebuild: plain times, shared across requests. */
const lastRebuild = new Map<string, number>();
/** Builds in flight in this request, by hour (per request on a worker: lib/cloudflare.ts perRequest). */
const building = inFlightPerRequest<FlowFieldView>();

/**
 * The map's flow field for a wall hour. On Node it is built on each call, as the process keeps the series and lagoon
 * memos warm. On a worker a fresh isolate would first read every ring point's and channel's series, so the finished
 * field is kept in R2 per hour, with a copy in the serving data centre, as the map's nowcasts are (lib/nowcast-cache.ts):
 * a saved field is served at once and one older than FRESH_MS is rebuilt in the background. The warm-up builds the
 * coming hour's.
 */
export async function mapFlowField(hour: string): Promise<FlowFieldView> {
  const env = workerEnv();
  if (!env) return flowField(hour);
  const key = hourKey(hour);
  const saved = parseSaved(await edgeRead(key)) ?? parseSaved(await cacheGet(env, key).catch(() => null));
  if (saved) {
    if (!isFresh(saved, hour) && Date.now() - (lastRebuild.get(hour) ?? 0) >= REBUILD_EVERY_MS) {
      lastRebuild.set(hour, Date.now());
      runInBackground(rebuild(hour));
    }
    return saved.field;
  }
  return rebuild(hour);
}

function rebuild(hour: string, options?: FetchOptions): Promise<FlowFieldView> {
  const inFlight = building();
  const running = inFlight.get(hour);
  if (running) return running;
  const build = buildFlowField(hour, options)
    .then(({ field }) => field)
    .finally(() => inFlight.delete(hour));
  inFlight.set(hour, build);
  return build;
}

/** Builds an hour's field and saves it in R2 and this data centre's copy. `saved` is false only when R2 refused it. */
export async function buildFlowField(hour: string, options?: FetchOptions): Promise<{ field: FlowFieldView; saved: boolean }> {
  const field = await flowField(hour, options);
  const env = workerEnv();
  if (!env) return { field, saved: true };
  const key = hourKey(hour);
  const text = JSON.stringify({ computedAt: Date.now(), field } satisfies SavedField);
  let saved = true;
  try {
    await cachePut(env, key, text);
  } catch (error) {
    console.warn("Failed to save the flow field", error);
    saved = false;
  }
  edgeWrite(key, text, EDGE_SECONDS);
  return { field, saved };
}

function hourKey(hour: string): string {
  return `${KEY_PREFIX}${hour.slice(0, 13)}.json`;
}

function isFresh(saved: SavedField, hour: string): boolean {
  const hourStart = parseWall(`${hour.slice(0, 13)}:00`) - MALDIVES_OFFSET_MS;
  return Date.now() - Math.max(saved.computedAt, hourStart) <= FRESH_MS;
}

function parseSaved(text: string | null): SavedField | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Partial<SavedField>;
    if (typeof parsed.computedAt !== "number" || !parsed.field || !Array.isArray(parsed.field.atolls)) return null;
    return parsed as SavedField;
  } catch {
    return null;
  }
}
