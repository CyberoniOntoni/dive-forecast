/**
 * The reef-zone overlay's file format, shared by the export script and the map.
 * public/overlays/reef-zones/index.json lists the tiles; each tile holds zones as [classIndex, ...rings], where a
 * ring is flat integer steps in 1e-5 degrees: [x0, y0, dx1, dy1, ...]. That keeps 80,000 Maldives polygons small.
 */

/** Allen Coral Atlas geomorphic classes, in the order tiles refer to them, with the Atlas's own colours. */
export const REEF_ZONE_CLASSES = [
  { name: "Reef Crest", color: "#614272" },
  { name: "Outer Reef Flat", color: "#c5a7cb" },
  { name: "Inner Reef Flat", color: "#92739d" },
  { name: "Terrestrial Reef Flat", color: "#fbdefb" },
  { name: "Reef Slope", color: "#288471" },
  { name: "Sheltered Reef Slope", color: "#10bda6" },
  { name: "Back Reef Slope", color: "#bee2e1" },
  { name: "Plateau", color: "#cd6812" },
  { name: "Shallow Lagoon", color: "#77d0fc" },
  { name: "Deep Lagoon", color: "#2ca2f9" },
] as const;

export const REEF_ZONES_PATH = "/overlays/reef-zones";
/** Tiles are this many degrees square, named by their south-west corner. */
export const REEF_TILE_DEG = 0.25;
const SCALE = 1e5;

/** One tile in the index: its file and the bounds of everything in it (zones can reach past the tile). */
export type ReefTileEntry = { file: string; south: number; west: number; north: number; east: number };
export type ReefZoneTile = [classIndex: number, ...rings: number[][]][];

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

/** File name of the tile whose south-west corner holds the point. */
export function reefTileFile(lat: number, lon: number): string {
  const corner = (value: number) => (Math.floor(value / REEF_TILE_DEG) * REEF_TILE_DEG).toFixed(2);
  return `${corner(lat)}_${corner(lon)}.json`;
}
