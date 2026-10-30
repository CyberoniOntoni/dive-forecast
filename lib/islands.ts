import { ringProblem, type RimRing } from "./rim";
import { readDataFileIfPresent } from "./data-files";

/**
 * Islands (data/islands.json, from OpenStreetMap land polygons; npm run islands). Land stops swell outright, and an
 * island with trees also takes the wind off the water behind it.
 */
export type Island = { areaHa: number; ring: RimRing };

/**
 * Islands at least this big are taken to carry trees and so to shelter the water behind them from the wind. OSM's
 * land polygons say nothing of cover; the smallest islands are mostly bare sand. A first guess.
 */
export const WOODED_MIN_HA = 1;

let loadedIslands: Island[] | null = null;

/**
 * The islands in data/islands.json. A missing file means no islands. Any other read or parse error, or an island of
 * the wrong shape, throws and is read again on the next call, as readRims and readOpenings do.
 */
export function readIslands(): Island[] {
  if (loadedIslands) return loadedIslands;
  const text = readDataFileIfPresent("islands.json");
  if (text === null) {
    loadedIslands = [];
    return loadedIslands;
  }
  loadedIslands = parseIslands(text);
  return loadedIslands;
}

/** The islands in an islands file's text. Each needs a non-negative area and a closed ring of finite [lat, lon] pairs. */
export function parseIslands(text: string): Island[] {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error("islands.json: not an object");
  if (!Array.isArray(parsed.islands)) throw new Error("islands.json: islands is not a list");
  return parsed.islands.map((item: unknown, index: number) => {
    const problem = islandProblem(item);
    if (problem) throw new Error(`islands.json: island ${index} ${problem}`);
    const island = item as { areaHa: number; ring: RimRing };
    return { areaHa: island.areaHa, ring: island.ring };
  });
}

function islandProblem(item: unknown): string | null {
  if (!isRecord(item)) return "is not an object";
  const { areaHa, ring } = item;
  if (typeof areaHa !== "number" || !Number.isFinite(areaHa) || areaHa < 0) return "has no valid areaHa";
  const problem = ringProblem(ring);
  return problem && `ring ${problem}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
