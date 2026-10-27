import { describe, expect, it } from "vitest";
import { parseIslands } from "./islands";

const RING = [
  [4, 73.5],
  [4.001, 73.5],
  [4.001, 73.501],
  [4, 73.5],
];

describe("parseIslands", () => {
  it("reads islands with their area and ring", () => {
    expect(parseIslands(JSON.stringify({ islands: [{ areaHa: 1.2, ring: RING }] }))).toEqual([{ areaHa: 1.2, ring: RING }]);
  });

  it("throws on a file of the wrong shape", () => {
    expect(() => parseIslands("{}")).toThrow(/not a list/);
    expect(() => parseIslands(JSON.stringify({ islands: [{ ring: RING }] }))).toThrow(/island 0 has no valid areaHa/);
    expect(() => parseIslands(JSON.stringify({ islands: [{ areaHa: 1, ring: RING.slice(0, 3) }] }))).toThrow(/fewer than four/);
    expect(() => parseIslands(JSON.stringify({ islands: [{ areaHa: 1, ring: [...RING.slice(0, 3), [4, 73.6]] }] }))).toThrow(/not closed/);
  });
});
