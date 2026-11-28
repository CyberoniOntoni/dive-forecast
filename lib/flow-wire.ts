/**
 * How the map's current-flow layer gets its field from the server, and the speed scale both sides use. Shared by
 * lib/flow-field.ts (server) and lib/flow-layer.ts (browser), so it holds no server code.
 */
import { parseWall } from "./forecast";
import type { Strength } from "./types";

/** One atoll's ingredients for the flow animation at one hour. Speeds are knots, as east and north components. */
export type FlowAtoll = {
  /** The outline's OSM way id: the key getFlowShapes takes for the outline, islands and reef tops. */
  wayId: string;
  atollId: string;
  /** The outline's box, so the map builds only atolls near the view. Absent in fields saved before it was added. */
  box?: { south: number; north: number; west: number; east: number };
  /**
   * The lagoon model's flow (lib/lagoon-flow.ts) on a grid over the outline's box, row 0 at the south, column 0 at
   * the west, cell centres half a step in. Defined on both sides of the outline; the map uses it inside only. Null
   * when fewer than half the rim's openings have this hour.
   */
  lagoon: {
    south: number;
    west: number;
    stepLat: number;
    stepLon: number;
    rows: number;
    columns: number;
    /** Each cell's east and north speed, one signed byte each in FLOW_QUANTUM_KN steps, base64 (encodeVectors). */
    vectors: string;
  } | null;
  /** The ocean model's surface current at the ring sample points, 3 km off the outline. */
  ocean: { lat: number; lon: number; east: number; north: number }[];
  /**
   * Catalog sites whose water crosses the rim (passes, channel thilas, corners): the only gates in the reef. Each with
   * its width in metres (the published section's, else the Allen Coral Atlas measure), or null when neither is known.
   */
  channels: { id: string; widthM: number | null }[];
  /**
   * Catalog sites whose current runs along the reef (outer walls, strait walls). The map no longer reads it (the
   * along-reef model at the ring points, `reef`, took its place; a field saved before that falls back to the ocean
   * current turned along the reef); still sent so the shape stays the same.
   */
  walls: string[];
  /** Every reef gap of the outline with its flow this hour (lib/flow-gaps.ts). Absent in fields saved before it. */
  gaps?: FlowGap[];
  /** The current along the outer reef at the ring points this hour (lib/flow-gaps.ts). Absent in old fields. */
  reef?: FlowReef[];
};

/**
 * A reef gap's flow: its middle, width, where the water heads (inward normal for a flood, outward for an ebb) and how
 * fast, knots. `siteIds` are the catalog channel sites in it, whose own forecast the map shows there instead.
 */
export type FlowGap = { lat: number; lon: number; widthM: number; headingDeg: number; knots: number; siteIds: string[] };

/**
 * The current along the outer reef at a point on the outline, knots: positive runs with the outline's inward normal
 * turned 90° clockwise (the along-reef model's "incoming"), negative the other way. That way round is the same all
 * round an outline, so the map can blend neighbouring points across a corner.
 */
export type FlowReef = { lat: number; lon: number; knots: number };

/**
 * One hour's flow. `missing` counts the outlines left out (series not cached yet, or a failure), so a partial field
 * is kept only briefly and asked for again; absent in fields saved before it was added.
 */
export type FlowFieldView = {
  time: string;
  atolls: FlowAtoll[];
  missing?: number;
  /**
   * Islands outside every outline as boxes, for the open sea between the atolls (water stops there). Absent in fields
   * saved before it was added.
   */
  land?: { south: number; north: number; west: number; east: number }[];
};

/** The map's speed for each forecast band, knots: the boat route's (lib/route-current.ts), with slack barely moving. */
export const FLOW_KNOTS: Record<Strength, number> = { slack: 0.1, mild: 0.8, strong: 1.6, too_strong: 2.5 };

/**
 * The lagoon flow index (residual metres per hour, LAGOON_BANDS) against knots: the band edges 0.02, 0.2 and 0.55
 * land between the band speeds above, so a lagoon cell called mild moves about as fast as a mild channel on the map.
 * Not a measured speed: the index has no physical unit.
 */
const LAGOON_KNOTS: readonly [number, number][] = [
  [0, 0],
  [0.02, 0.3],
  [0.2, 1.2],
  [0.55, 2],
  [1.1, 2.8],
];

export function lagoonKnots(index: number): number {
  if (!(index > 0)) return 0;
  for (let at = 1; at < LAGOON_KNOTS.length; at += 1) {
    const [x1, y1] = LAGOON_KNOTS[at];
    if (index > x1) continue;
    const [x0, y0] = LAGOON_KNOTS[at - 1];
    return y0 + ((y1 - y0) * (index - x0)) / (x1 - x0);
  }
  return LAGOON_KNOTS[LAGOON_KNOTS.length - 1][1];
}

/** Metres per second to knots. */
export const KNOTS_PER_MS = 1.943844;

/** The wall string for parseWall's milliseconds (its inverse). */
const wallAtMs = (ms: number) => new Date(ms).toISOString().slice(0, 16);

/** The Maldives wall hour nearest a wall time ("2026-11-26T14:40" is "2026-11-26T15:00"). Null for a malformed time. */
export function nearestWallHour(wall: string): string | null {
  const ms = parseWall(wall);
  if (!Number.isFinite(ms)) return null;
  // Half past keeps the earlier hour, as the map's nowcast does (nearestForecastHour).
  const minutes = Math.round(ms / 60_000) % 60;
  const hour = Math.floor(ms / 3_600_000) + (minutes > 30 ? 1 : 0);
  return wallAtMs(hour * 3_600_000).slice(0, 13) + ":00";
}

/** One step of a lagoon cell's speed on the wire, knots: a signed byte then reaches ±3.2 knots, past the map's top band. */
export const FLOW_QUANTUM_KN = 0.025;

/** East and north speeds (knots) as signed bytes in FLOW_QUANTUM_KN steps, interleaved, base64. */
export function encodeVectors(east: readonly number[], north: readonly number[]): string {
  const bytes = new Int8Array(east.length * 2);
  const quantize = (value: number) => Math.max(-127, Math.min(127, Math.round(value / FLOW_QUANTUM_KN)));
  for (let index = 0; index < east.length; index += 1) {
    bytes[2 * index] = quantize(east[index]);
    bytes[2 * index + 1] = quantize(north[index] ?? 0);
  }
  let text = "";
  const raw = new Uint8Array(bytes.buffer);
  for (let index = 0; index < raw.length; index += 1) text += String.fromCharCode(raw[index]);
  return btoa(text);
}

/** encodeVectors read back: east and north knots per cell. */
export function decodeVectors(text: string): { east: Float32Array; north: Float32Array } {
  const binary = atob(text);
  const count = Math.floor(binary.length / 2);
  const east = new Float32Array(count);
  const north = new Float32Array(count);
  const signed = (code: number) => (code > 127 ? code - 256 : code) * FLOW_QUANTUM_KN;
  for (let index = 0; index < count; index += 1) {
    east[index] = signed(binary.charCodeAt(2 * index));
    north[index] = signed(binary.charCodeAt(2 * index + 1));
  }
  return { east, north };
}
