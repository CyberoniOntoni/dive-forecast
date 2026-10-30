import { readDataFile } from "./data-files";

/** A shorter break between crest is a map crack, not a channel. */
export const OPENING_MIN_M = 100;

/** Crest shorter than this does not split two openings. It is a sliver, not a wall. */
export const SHOULDER_MIN_M = 100;

/** A crest point closer than this to a gap end is that shoulder. */
export const SHOULDER_MATCH_M = 150;

/** A longer bare arc is open coast, not one channel. */
export const OPENING_MAX_M = 3000;

/** Coverage of reef crest along one atoll rim, in metres from the start of the outline. */
export type CrestArc = { startM: number; endM: number };

export type CrestGap = {
  kind: "opening" | "open-coast";
  /** Along-rim position where the previous crest ends. */
  startM: number;
  /** Along-rim position where the next crest begins. */
  endM: number;
  /** Along-rim separation. The stored width is the straight mouth, measured from the crest points. */
  alongM: number;
  wrapped: boolean;
};

/**
 * Breaks between reef-crest coverage on a closed rim.
 * Arcs may wrap (endM < startM). Arcs, and gaps between them, shorter than SHOULDER_MIN_M are joined.
 * Crest on only one stretch still leaves the bare rest of the rim. That rest is open coast when it is
 * longer than OPENING_MAX_M.
 */
export function openingsFromCrestArcs(arcs: readonly CrestArc[], perimeterM: number): CrestGap[] {
  if (perimeterM <= 0) return [];
  const walls = mergeWalls(arcs, perimeterM).filter((wall) => wall.end - wall.start >= SHOULDER_MIN_M);
  if (walls.length === 0) {
    return [{ kind: "open-coast", startM: 0, endM: perimeterM, alongM: perimeterM, wrapped: false }];
  }

  const gaps: CrestGap[] = [];
  for (let index = 0; index < walls.length; index += 1) {
    const wall = walls[index];
    const next = walls[(index + 1) % walls.length];
    const wrapped = next.start < wall.end;
    const alongM = wrapped ? next.start + perimeterM - wall.end : next.start - wall.end;
    if (alongM < OPENING_MIN_M) continue;
    gaps.push({
      kind: alongM > OPENING_MAX_M ? "open-coast" : "opening",
      startM: wall.end,
      endM: next.start,
      alongM,
      wrapped,
    });
  }
  return gaps;
}

type Interval = { start: number; end: number };

function mergeWalls(arcs: readonly CrestArc[], perimeterM: number): Interval[] {
  const pieces: Interval[] = [];
  for (const arc of arcs) {
    const start = normalize(arc.startM, perimeterM);
    const end = normalize(arc.endM, perimeterM);
    const length = end >= start ? end - start : perimeterM - start + end;
    if (length < SHOULDER_MIN_M) continue;
    if (end < start) {
      pieces.push({ start, end: perimeterM });
      if (end > 0) pieces.push({ start: 0, end });
    } else {
      pieces.push({ start, end });
    }
  }
  pieces.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Interval[] = [];
  for (const piece of pieces) {
    const last = merged[merged.length - 1];
    if (!last || piece.start - last.end >= SHOULDER_MIN_M) merged.push({ ...piece });
    else last.end = Math.max(last.end, piece.end);
  }
  if (merged.length >= 2) {
    const first = merged[0];
    const last = merged[merged.length - 1];
    if (first.start + perimeterM - last.end < SHOULDER_MIN_M) {
      first.start = 0;
      first.end = Math.max(first.end, last.end - perimeterM);
      merged.pop();
    }
  }
  return merged;
}

/** True when the straight width is inside the planform window. */
export function isCountedMouth(mouth: { widthM: number }): boolean {
  return mouth.widthM >= OPENING_MIN_M && mouth.widthM <= OPENING_MAX_M;
}

function normalize(distanceM: number, perimeterM: number): number {
  const mod = distanceM % perimeterM;
  return mod < 0 ? mod + perimeterM : mod;
}

/** A reef-crest gap in one atoll's outline (data/openings.json), keyed to that outline by its OSM way id. */
export type ReefOpening = {
  lat: number;
  lon: number;
  widthM: number;
  wayId: string;
  atollIds: string[];
  reefFlatBridges?: boolean;
};

let loadedOpenings: ReefOpening[] | null = null;

/**
 * The reef-crest mouths in data/openings.json, as the sea state's shelter reads them. A missing file means no mouths:
 * every rim crossing is reef. Any other read or parse error, or a mouth of the wrong shape, throws and is read again
 * on the next call, as readRims does, so a corrupt file never passes for an atoll with no gaps.
 */
export function readOpenings(): ReefOpening[] {
  if (loadedOpenings) return loadedOpenings;
  let text: string;
  try {
    text = readDataFile("openings.json");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT")) throw error;
    loadedOpenings = [];
    return loadedOpenings;
  }
  loadedOpenings = parseOpenings(text);
  return loadedOpenings;
}

/** The mouths in an openings file's text. Each needs a finite position, a positive width, its outline's way id and atolls. */
export function parseOpenings(text: string): ReefOpening[] {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error("openings.json: not an object");
  if (!Array.isArray(parsed.openings)) throw new Error("openings.json: openings is not a list");
  return parsed.openings.map((item: unknown, index: number) => {
    const problem = openingProblem(item);
    if (problem) throw new Error(`openings.json: opening ${index} ${problem}`);
    const opening = item as Record<string, unknown>;
    return {
      lat: opening.lat as number,
      lon: opening.lon as number,
      widthM: opening.widthM as number,
      wayId: opening.wayId as string,
      atollIds: [...(opening.atollIds as string[])],
      reefFlatBridges: opening.reefFlatBridges === true,
    };
  });
}

function openingProblem(item: unknown): string | null {
  if (!isRecord(item)) return "is not an object";
  const { lat, lon, widthM, wayId, atollIds, reefFlatBridges } = item;
  if (typeof lat !== "number" || !Number.isFinite(lat) || Math.abs(lat) > 90) return "has no valid lat";
  if (typeof lon !== "number" || !Number.isFinite(lon) || Math.abs(lon) > 180) return "has no valid lon";
  if (typeof widthM !== "number" || !Number.isFinite(widthM) || widthM <= 0) return "has no positive widthM";
  if (typeof wayId !== "string" || wayId.length === 0) return "has no wayId";
  if (!Array.isArray(atollIds) || atollIds.length === 0 || !atollIds.every((id) => typeof id === "string" && id.length > 0)) {
    return "has no atollIds";
  }
  if (reefFlatBridges !== undefined && typeof reefFlatBridges !== "boolean") return "has a reefFlatBridges that is not true or false";
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
