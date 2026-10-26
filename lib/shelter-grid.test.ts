import { describe, expect, it } from "vitest";
import { packExposure, parseShelterGrid, SHELTER_CELL_BYTES, SHELTER_DIRECTIONS, SHELTER_STEP_DEG, unpackExposure } from "./shelter-grid";
import { STEP_DEG } from "./wave-exposure";

describe("shelter grid cells", () => {
  it("keeps a cell's exposure to within the packing step", () => {
    const rays = 360 / STEP_DEG;
    const exposure = {
      swell: Array.from({ length: rays }, (_, index) => index / rays),
      wind: Array.from({ length: rays }, () => 0.5),
      fetchKm: Array.from({ length: rays }, (_, index) => (index % 2 === 0 ? null : 12.3)),
    };
    const bytes = new Uint8Array(SHELTER_CELL_BYTES);
    packExposure(exposure, bytes, 0);
    const back = unpackExposure(bytes, 0);
    expect(back.swell).toHaveLength(SHELTER_DIRECTIONS);
    // Direction 1 of 24 is 15°, ray 3 of 72.
    expect(back.swell[1]).toBeCloseTo(3 / rays, 2);
    expect(back.wind[5]).toBe(0.5);
    expect(back.fetchKm[0]).toBeNull();
    expect(back.fetchKm[1]).toBeCloseTo(12.25, 5);
  });

  it("rejects a file built for another grid or with cells that do not match its runs", () => {
    const cells = Buffer.alloc(SHELTER_CELL_BYTES * 2).toString("base64");
    const good = { stepDeg: SHELTER_STEP_DEG, directions: SHELTER_DIRECTIONS, atolls: { a: { south: 4, west: 73, runs: [[0, 0, 2]], cells } } };
    expect(Object.keys(parseShelterGrid(JSON.stringify(good)).atolls)).toEqual(["a"]);
    expect(() => parseShelterGrid(JSON.stringify({ ...good, directions: 16 }))).toThrow(/another grid/);
    const short = { ...good, atolls: { a: { ...good.atolls.a, runs: [[0, 0, 3]] } } };
    expect(() => parseShelterGrid(JSON.stringify(short))).toThrow(/do not match/);
  });
});
