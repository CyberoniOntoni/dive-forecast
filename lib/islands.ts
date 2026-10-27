import fs from "fs";
import path from "path";
import type { RimRing } from "./rim";

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

const ISLANDS_PATH = path.join(process.cwd(), "data", "islands.json");
let loadedIslands: Island[] | null = null;

/**
 * The islands in data/islands.json. A missing file means no islands. Any other read or parse error, or an island of
 * the wrong shape, throws and is read again on the next call, as readRims and readOpenings do.
 */
export function readIslands(): Island[] {
  if (loadedIslands) return loadedIslands;
  let text: string;
  try {
    text = fs.readFileSync(ISLANDS_PATH, "utf8");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT")) throw error;
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
  if (!Array.isArray(ring) || ring.length < 4) return "has a ring of fewer than four points";
  for (const point of ring) {
    if (!Array.isArray(point) || point.length !== 2) return "has a point that is not a [lat, lon] pair";
    const [lat, lon] = point as unknown[];
    if (typeof lat !== "number" || !Number.isFinite(lat) || Math.abs(lat) > 90) return "has a point with no valid lat";
    if (typeof lon !== "number" || !Number.isFinite(lon) || Math.abs(lon) > 180) return "has a point with no valid lon";
  }
  const first = ring[0] as number[];
  const last = ring[ring.length - 1] as number[];
  if (first[0] !== last[0] || first[1] !== last[1]) return "has a ring that is not closed";
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
