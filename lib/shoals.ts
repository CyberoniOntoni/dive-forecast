import fs from "fs";
import path from "path";
import { ringProblem, type RimRing } from "./rim";
import { REEF_TRANSMISSION } from "./wave-exposure";

/**
 * Shoals inside atoll lagoons (data/shoals.json, from the Allen Coral Atlas reef zones; npm run shoals): reef tops
 * awash or a metre or two down at low tide, and sand shallows a few metres down. Swell breaks or loses height crossing
 * them; the wind blows on over them.
 */
export type ShoalKind = "reef" | "shallow";
export type Shoal = { kind: ShoalKind; ring: RimRing };

/**
 * Share of the swell height left after crossing a shoal. A reef top breaks swell as the atoll's rim does. Sand a few
 * metres down only trips the bigger swells; half is a first guess.
 */
export const SHOAL_TRANSMISSION: Record<ShoalKind, number> = { reef: REEF_TRANSMISSION, shallow: 0.5 };

const SHOALS_PATH = path.join(process.cwd(), "data", "shoals.json");
let loadedShoals: Shoal[] | null = null;

/**
 * The shoals in data/shoals.json. A missing file means no shoals. Any other read or parse error, or a shoal of the
 * wrong shape, throws and is read again on the next call, as readIslands does.
 */
export function readShoals(): Shoal[] {
  if (loadedShoals) return loadedShoals;
  let text: string;
  try {
    text = fs.readFileSync(SHOALS_PATH, "utf8");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT")) throw error;
    loadedShoals = [];
    return loadedShoals;
  }
  loadedShoals = parseShoals(text);
  return loadedShoals;
}

/** The shoals in a shoals file's text. Each needs a known kind and a closed ring of finite [lat, lon] pairs. */
export function parseShoals(text: string): Shoal[] {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { shoals?: unknown }).shoals)) {
    throw new Error("shoals.json: shoals is not a list");
  }
  return (parsed as { shoals: unknown[] }).shoals.map((item, index) => {
    const { kind, ring } = (typeof item === "object" && item !== null ? item : {}) as { kind?: unknown; ring?: unknown };
    if (kind !== "reef" && kind !== "shallow") throw new Error(`shoals.json: shoal ${index} has no valid kind`);
    const problem = ringProblem(ring);
    if (problem) throw new Error(`shoals.json: shoal ${index} ring ${problem}`);
    return { kind, ring: ring as RimRing };
  });
}
