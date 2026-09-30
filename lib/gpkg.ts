/**
 * Reads polygon geometries from GeoPackage blobs (as in the Allen Coral Atlas downloads), without a GIS library.
 * A blob is a small header ("GP", version, flags, SRS id, optional envelope) followed by standard WKB.
 */

/** Rings of [lon, lat]; the first ring is the outline, the rest are holes. */
export type Polygon = number[][][];

const ENVELOPE_BYTES = [0, 32, 48, 48, 64];

/** The polygons in a GeoPackage geometry blob. Anything that is not a polygon or multipolygon gives none. */
export function gpkgPolygons(blob: Uint8Array): Polygon[] {
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  if (blob[0] !== 0x47 || blob[1] !== 0x50) throw new Error("Not a GeoPackage geometry");
  const flags = blob[3];
  const envelope = ENVELOPE_BYTES[(flags >> 1) & 0b111] ?? 0;
  return wkbPolygons(view, 8 + envelope).polygons;
}

function wkbPolygons(view: DataView, start: number): { polygons: Polygon[]; end: number } {
  const little = view.getUint8(start) === 1;
  const type = view.getUint32(start + 1, little) % 1000; // ISO Z/M codes add 1000s
  let at = start + 5;
  if (type === 3) {
    const { polygon, end } = readPolygon(view, at, little);
    return { polygons: [polygon], end };
  }
  if (type === 6) {
    const count = view.getUint32(at, little);
    at += 4;
    const polygons: Polygon[] = [];
    for (let index = 0; index < count; index += 1) {
      const inner = wkbPolygons(view, at);
      polygons.push(...inner.polygons);
      at = inner.end;
    }
    return { polygons, end: at };
  }
  return { polygons: [], end: view.byteLength };
}

function readPolygon(view: DataView, start: number, little: boolean): { polygon: Polygon; end: number } {
  let at = start;
  const rings = view.getUint32(at, little);
  at += 4;
  const polygon: Polygon = [];
  for (let ring = 0; ring < rings; ring += 1) {
    const points = view.getUint32(at, little);
    at += 4;
    const coords: number[][] = new Array(points);
    for (let point = 0; point < points; point += 1) {
      coords[point] = [view.getFloat64(at, little), view.getFloat64(at + 8, little)];
      at += 16;
    }
    polygon.push(coords);
  }
  return { polygon, end: at };
}

/** True when [lon, lat] is inside the polygon: inside the outline and in none of its holes (even-odd). */
export function polygonContains(polygon: Polygon, lon: number, lat: number): boolean {
  let inside = false;
  for (const ring of polygon) {
    for (let index = 0, prev = ring.length - 1; index < ring.length; prev = index, index += 1) {
      const [x1, y1] = ring[index];
      const [x2, y2] = ring[prev];
      if (y1 > lat !== y2 > lat && lon < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1) inside = !inside;
    }
  }
  return inside;
}
