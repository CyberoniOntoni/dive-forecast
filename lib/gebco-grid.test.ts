import { describe, expect, it } from "vitest";
import { gebcoCenter, gebcoIndex, parseDodsGrid } from "./gebco-grid";

describe("GEBCO index", () => {
  it("puts the checked deep cell east of Malé on row 22608, column 60960", () => {
    const row = 22608;
    const col = 60960;
    const center = gebcoCenter(row, col);
    expect(center.lat).toBeCloseTo(4.202083333333334, 8);
    expect(center.lon).toBeCloseTo(74.00208333333333, 8);
    expect(gebcoIndex(center.lat, center.lon)).toEqual({ row, col });
  });

  it("starts the grid half a cell in from the south and west edges", () => {
    expect(gebcoCenter(0, 0).lat).toBeCloseTo(-89.99791666666667, 8);
    expect(gebcoCenter(0, 0).lon).toBeCloseTo(-179.99791666666667, 8);
  });
});

describe("DODS grid", () => {
  it("reads a one-cell elevation and its maps", () => {
    const body = encodeDods("int16", [-2490], [4.202083333333334], [74.00208333333333]);
    const grid = parseDodsGrid(body, "int16");
    expect(Array.from(grid.values)).toEqual([-2490]);
    expect(grid.lat[0]).toBeCloseTo(4.202083333333334, 8);
    expect(grid.lon[0]).toBeCloseTo(74.00208333333333, 8);
  });

  it("reads packed TID bytes, including a pad to four bytes", () => {
    const body = encodeDods("byte", [40, 44, 40], [1, 2, 3], [4]);
    const grid = parseDodsGrid(body, "byte");
    expect(Array.from(grid.values)).toEqual([40, 44, 40]);
    expect(Array.from(grid.lat)).toEqual([1, 2, 3]);
    expect(Array.from(grid.lon)).toEqual([4]);
  });

  it("rejects a response with no data block", () => {
    expect(() => parseDodsGrid(Buffer.from("not a grid"), "int16")).toThrow(/no data block/);
  });
});

function encodeDods(kind: "int16" | "byte", values: number[], lat: number[], lon: number[]): Buffer {
  const parts: Buffer[] = [Buffer.from("Dataset {\n} dummy;\nData:\n")];
  parts.push(repeatedCount(values.length));
  if (kind === "int16") {
    const data = Buffer.alloc(values.length * 4);
    values.forEach((value, index) => data.writeInt32BE(value, index * 4));
    parts.push(data);
  } else {
    const pad = (4 - (values.length % 4)) % 4;
    const data = Buffer.alloc(values.length + pad);
    values.forEach((value, index) => {
      data[index] = value;
    });
    parts.push(data);
  }
  for (const axis of [lat, lon]) {
    parts.push(repeatedCount(axis.length));
    const data = Buffer.alloc(axis.length * 8);
    axis.forEach((value, index) => data.writeDoubleBE(value, index * 8));
    parts.push(data);
  }
  return Buffer.concat(parts);
}

function repeatedCount(count: number): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeInt32BE(count, 0);
  bytes.writeInt32BE(count, 4);
  return bytes;
}
