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
/** A field with outlines left out is served as it is only this long. */
const PARTIAL_MS = 15 * 1000;
const EDGE_SECONDS = 65 * 60;
const HOUR_MS = 60 * 60 * 1000;
const MALDIVES_OFFSET_MS = 5 * HOUR_MS;

type SavedField = { computedAt: number; field: FlowFieldView };

/** A data centre's copy older than FRESH_MS is checked against R2, or rebuilt, at most this often per isolate. */
const CHECK_EVERY_MS = 60 * 1000;
/** When this isolate last checked each hour's field: plain times, shared across requests, pruned to recent hours. */
const lastChecked = new Map<string, number>();
/** Builds in flight in this request, by hour (per request on a worker: lib/cloudflare.ts perRequest). */
const building = inFlightPerRequest<FlowFieldView>();
/** On Node, each hour's field for FRESH_MS: the process is long lived, so a few recent hours are kept in memory. */
const nodeFields = new Map<string, { at: number; field: FlowFieldView }>();
const NODE_HOURS_KEPT = 4;

/** Whether a wall hour is one the map can show: from a day before now to the end of the forecast week. */
export function flowHourInWindow(hour: string, nowMs: number = Date.now()): boolean {
  const start = parseWall(`${hour.slice(0, 13)}:00`) - MALDIVES_OFFSET_MS;
  return Number.isFinite(start) && start >= nowMs - 26 * HOUR_MS && start <= nowMs + 8 * 24 * HOUR_MS;
}

/**
 * The map's flow field for a wall hour. On Node it is built and kept in memory for FRESH_MS. On a worker a fresh
 * isolate would first read every ring point's and channel's series, so the finished field is kept in R2 per hour,
 * with a copy in the serving data centre, as the map's nowcasts are (lib/nowcast-cache.ts): a saved field is served
 * at once; a data centre's copy older than FRESH_MS is checked against R2 in the background, and rebuilt only when R2
 * has nothing newer and fresh. A fresh field read from R2 is copied to the data centre. The warm-up builds the coming
 * hour's.
 */
export async function mapFlowField(hour: string): Promise<FlowFieldView> {
  const env = workerEnv();
  if (!env) {
    const kept = nodeFields.get(hour);
    if (kept && Date.now() - kept.at <= keepFor(kept.field)) return kept.field;
    // One build per hour at a time: on Node the in-flight map is the process's.
    return rebuild(hour).then((field) => {
      nodeFields.delete(hour);
      nodeFields.set(hour, { at: Date.now(), field });
      while (nodeFields.size > NODE_HOURS_KEPT) nodeFields.delete(nodeFields.keys().next().value as string);
      return field;
    });
  }
  const key = hourKey(hour);
  const claimCheck = () => {
    const now = Date.now();
    if (now - (lastChecked.get(hour) ?? 0) < CHECK_EVERY_MS) return false;
    for (const [other, at] of lastChecked) if (now - at > HOUR_MS) lastChecked.delete(other);
    lastChecked.set(hour, now);
    return true;
  };
  const edgeText = await edgeRead(key);
  const edge = parseSaved(edgeText);
  if (edge) {
    if (!isFresh(edge, hour) && claimCheck()) {
      runInBackground(
        (async () => {
          // Another data centre, an isolate or the warm-up may have saved a newer field already.
          const text = await cacheGet(env, key).catch(() => null);
          const stored = parseSaved(text);
          if (text && stored && stored.computedAt > edge.computedAt && isFresh(stored, hour)) {
            return edgeWrite(key, text, EDGE_SECONDS);
          }
          await rebuild(hour);
        })(),
      );
    }
    return edge.field;
  }
  const text = await cacheGet(env, key).catch(() => null);
  const stored = parseSaved(text);
  if (text && stored) {
    // A fresh field goes to the edge, so the next request here takes the path above. An old one does not: it could
    // land on top of the newer copy a rebuild has just written there.
    if (isFresh(stored, hour)) edgeWrite(key, text, EDGE_SECONDS);
    else if (claimCheck()) runInBackground(rebuild(hour));
    return stored.field;
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

/** How long a field is served as it is: FRESH_MS, or PARTIAL_MS when outlines were left out, so they join soon. */
const keepFor = (field: FlowFieldView) => ((field.missing ?? 0) > 0 ? PARTIAL_MS : FRESH_MS);

/**
 * A complete field is fresh for FRESH_MS from when it was made or its hour started, whichever is later (the warm-up
 * builds the coming hour's before it starts). A partial one only for PARTIAL_MS from when it was made, even for a
 * coming hour.
 */
function isFresh(saved: SavedField, hour: string): boolean {
  if ((saved.field.missing ?? 0) > 0) return Date.now() - saved.computedAt <= PARTIAL_MS;
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
