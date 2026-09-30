/**
 * The Allen Coral Atlas overlays (reef zones, bottom types, reef outline): what each one is, and the tile format
 * shared by the export script (scripts/atlas-overlays.ts) and the map.
 * Each overlay's directory under public/overlays/ has index.json listing its tiles. A tile holds shapes as
 * [classIndex, ...rings], where a ring is flat integer steps in 1e-5 degrees: [x0, y0, dx1, dy1, ...].
 */

export type AtlasOverlayId = "reefZones" | "bottomTypes" | "reefOutline";
export type AtlasClass = { name: string; color: string };

export type AtlasOverlay = {
  id: AtlasOverlayId;
  title: string;
  /** Where the tiles are served, under public/. */
  path: string;
  /** The GeoPackage in the Atlas download, under data/sources/aca/. */
  source: string;
  /** The Atlas classes, in the order tiles refer to them, with the Atlas's own colours. */
  classes: readonly AtlasClass[];
  /** Drawn as an outline instead of a fill. */
  outline: boolean;
  /** Drawn from this zoom; below it too many tiles would load at once. */
  minZoom: number;
  /** Douglas-Peucker tolerance, degrees. 0.0001 is about 11 m. */
  tolerance: number;
  /** Shapes smaller than this are dropped as specks. */
  minAreaM2: number;
};

export const ATLAS_OVERLAYS: Record<AtlasOverlayId, AtlasOverlay> = {
  reefZones: {
    id: "reefZones",
    title: "Reef zones",
    path: "/overlays/reef-zones",
    source: "Geomorphic-Map/geomorphic.gpkg",
    classes: [
      { name: "Reef Crest", color: "#614272" },
      { name: "Outer Reef Flat", color: "#c5a7cb" },
      { name: "Inner Reef Flat", color: "#92739d" },
      { name: "Reef Slope", color: "#288471" },
      { name: "Sheltered Reef Slope", color: "#10bda6" },
      { name: "Back Reef Slope", color: "#bee2e1" },
      { name: "Plateau", color: "#cd6812" },
      { name: "Shallow Lagoon", color: "#77d0fc" },
      { name: "Deep Lagoon", color: "#2ca2f9" },
    ],
    outline: false,
    minZoom: 11,
    tolerance: 0.0001,
    minAreaM2: 0,
  },
  bottomTypes: {
    id: "bottomTypes",
    title: "Bottom types",
    path: "/overlays/bottom-types",
    source: "Benthic-Map/benthic.gpkg",
    classes: [
      { name: "Coral/Algae", color: "#ff6161" },
      { name: "Rock", color: "#b19c3a" },
      { name: "Rubble", color: "#e0d05e" },
      { name: "Sand", color: "#ffffbe" },
      { name: "Seagrass", color: "#668438" },
      { name: "Microalgal Mats", color: "#9bcc4f" },
    ],
    outline: false,
    minZoom: 12,
    tolerance: 0.0001,
    minAreaM2: 600,
  },
  reefOutline: {
    id: "reefOutline",
    title: "Reef outline",
    path: "/overlays/reef-outline",
    source: "Reef-Extent/reefextent.gpkg",
    classes: [{ name: "Reef", color: "#ffd166" }],
    outline: true,
    minZoom: 10,
    tolerance: 0.0001,
    minAreaM2: 0,
  },
};

export const ATLAS_CREDIT = '<a href="https://allencoralatlas.org/">Allen Coral Atlas</a>, CC BY 4.0';

/** Tiles are this many degrees square, named by their south-west corner. */
export const ATLAS_TILE_DEG = 0.25;
const SCALE = 1e5;

/** One tile in an overlay's index: its file and the bounds of everything in it (shapes can reach past the tile). */
export type AtlasTileEntry = { file: string; south: number; west: number; north: number; east: number };
export type AtlasTile = [classIndex: number, ...rings: number[][]][];

/** [[lon, lat], ...] → [x0, y0, dx1, dy1, ...] in 1e-5 degree steps. */
export function encodeRing(ring: readonly (readonly number[])[]): number[] {
  const flat: number[] = [];
  let px = 0;
  let py = 0;
  for (const [lon, lat] of ring) {
    const x = Math.round(lon * SCALE);
    const y = Math.round(lat * SCALE);
    flat.push(x - px, y - py);
    px = x;
    py = y;
  }
  return flat;
}

/** The inverse of encodeRing, as [lat, lon] pairs, the order Leaflet takes. */
export function decodeRing(flat: readonly number[]): [number, number][] {
  const points: [number, number][] = [];
  let x = 0;
  let y = 0;
  for (let index = 0; index + 1 < flat.length; index += 2) {
    x += flat[index];
    y += flat[index + 1];
    points.push([y / SCALE, x / SCALE]);
  }
  return points;
}

/**
 * Douglas-Peucker on a ring of [lon, lat]: drops points closer than `tolerance` degrees to the simplified line.
 * A closed ring starts and ends on the same point, so measuring against that zero-length chord would drop every
 * point; distances to a zero-length chord are measured to its point instead.
 */
export function simplifyRing(ring: readonly (readonly number[])[], tolerance: number): number[][] {
  const points = ring.map(([lon, lat]) => [lon, lat]);
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [from, to] = stack.pop()!;
    const [x1, y1] = points[from];
    const [x2, y2] = points[to];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    let farthest = -1;
    let farthestIndex = -1;
    for (let index = from + 1; index < to; index += 1) {
      const [x, y] = points[index];
      const distance = length === 0 ? Math.hypot(x - x1, y - y1) : Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / length;
      if (distance > farthest) {
        farthest = distance;
        farthestIndex = index;
      }
    }
    if (farthest > tolerance) {
      keep[farthestIndex] = 1;
      stack.push([from, farthestIndex], [farthestIndex, to]);
    }
  }
  return points.filter((_, index) => keep[index] === 1);
}

/** Area of a ring of [lon, lat], square metres (shoelace on a local flat projection; fine at reef scale). */
export function ringAreaM2(ring: readonly (readonly number[])[]): number {
  if (ring.length < 3) return 0;
  const lat0 = (ring[0][1] * Math.PI) / 180;
  const mx = 111_320 * Math.cos(lat0);
  const my = 110_574;
  let twice = 0;
  for (let index = 0, prev = ring.length - 1; index < ring.length; prev = index, index += 1) {
    twice += ring[prev][0] * mx * ring[index][1] * my - ring[index][0] * mx * ring[prev][1] * my;
  }
  return Math.abs(twice) / 2;
}

/** File name of the tile whose south-west corner holds the point. */
export function atlasTileFile(lat: number, lon: number): string {
  const corner = (value: number) => (Math.floor(value / ATLAS_TILE_DEG) * ATLAS_TILE_DEG).toFixed(2);
  return `${corner(lat)}_${corner(lon)}.json`;
}
