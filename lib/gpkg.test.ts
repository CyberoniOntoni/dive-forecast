import { describe, expect, it } from "vitest";
import { gpkgPolygons, polygonContains, type Polygon } from "./gpkg";

/** A GeoPackage blob: header with an XY envelope, then little-endian WKB. */
function blob(wkb: number[]): Uint8Array {
  const header = [0x47, 0x50, 0, 0b0011, 0xe6, 0x10, 0, 0]; // little-endian, envelope type 1, SRS 4326
  const envelope = new Array(32).fill(0);
  return new Uint8Array([...header, ...envelope, ...wkb]);
}

function u32(value: number): number[] {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return [...bytes];
}

function f64(value: number): number[] {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, true);
  return [...bytes];
}

function polygonWkb(rings: number[][][]): number[] {
  return [1, ...u32(3), ...u32(rings.length), ...rings.flatMap((ring) => [...u32(ring.length), ...ring.flatMap(([x, y]) => [...f64(x), ...f64(y)])])];
}

const square = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
const hole = [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]];

describe("gpkgPolygons", () => {
  it("reads a polygon with a hole", () => {
    expect(gpkgPolygons(blob(polygonWkb([square, hole])))).toEqual([[square, hole]]);
  });

  it("reads each polygon of a multipolygon", () => {
    const other = [[10, 10], [11, 10], [11, 11], [10, 10]];
    const multi = [1, ...u32(6), ...u32(2), ...polygonWkb([square]), ...polygonWkb([other])];
    expect(gpkgPolygons(blob(multi))).toEqual([[square], [other]]);
  });

  it("rejects a blob without the GeoPackage magic", () => {
    expect(() => gpkgPolygons(new Uint8Array([0, 0, 0, 0]))).toThrow();
  });
});

describe("polygonContains", () => {
  const withHole: Polygon = [square, hole];
  it("is inside the outline and outside the hole", () => {
    expect(polygonContains(withHole, 3, 3)).toBe(true);
    expect(polygonContains(withHole, 1.5, 1.5)).toBe(false);
    expect(polygonContains(withHole, 5, 5)).toBe(false);
  });
});
