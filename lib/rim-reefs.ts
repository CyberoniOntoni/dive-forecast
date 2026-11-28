import { readDataFileIfPresent } from "./data-files";

/**
 * The reef tops along each atoll's rim (data/rim-reefs.json, from the Allen Coral Atlas reef zones; npm run
 * rim-reefs), by outline way id, each ring in the map tiles' encoding (encodeRing in lib/atlas-overlays.ts). The
 * current-flow layer stops water on them and lets it cross the rim everywhere else. Read by nothing in the forecast.
 */
let loaded: Map<string, number[][]> | null = null;

/** Every outline's reef tops. A missing file means none (the flow layer then walls the whole outline, as before). */
export function readRimReefs(): Map<string, number[][]> {
  if (loaded) return loaded;
  const text = readDataFileIfPresent("rim-reefs.json");
  loaded = text === null ? new Map() : parseRimReefs(text);
  return loaded;
}

/** The reef tops in a rim-reefs file's text. Each ring is a flat list of an even number of whole numbers. */
export function parseRimReefs(text: string): Map<string, number[][]> {
  const parsed: unknown = JSON.parse(text);
  const reefs = typeof parsed === "object" && parsed !== null ? (parsed as { reefs?: unknown }).reefs : undefined;
  if (typeof reefs !== "object" || reefs === null || Array.isArray(reefs)) throw new Error("rim-reefs.json: reefs is not a map");
  const out = new Map<string, number[][]>();
  for (const [wayId, list] of Object.entries(reefs)) {
    if (!Array.isArray(list)) throw new Error(`rim-reefs.json: ${wayId} is not a list`);
    list.forEach((ring, index) => {
      if (!Array.isArray(ring) || ring.length < 8 || ring.length % 2 !== 0 || !ring.every((value) => Number.isInteger(value))) {
        throw new Error(`rim-reefs.json: ${wayId} ring ${index} is not an encoded ring`);
      }
    });
    out.set(wayId, list as number[][]);
  }
  return out;
}
