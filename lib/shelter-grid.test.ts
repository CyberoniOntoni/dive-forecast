import { describe, expect, it } from "vitest";
import {
  decodeCells,
  encodeCells,
  packExposures,
  parseShelterGrid,
  SHELTER_BAND_KM,
  SHELTER_CELL_BYTES,
  SHELTER_DIRECTIONS,
  SHELTER_FINE_KM,
  SHELTER_FINE_STEP_DEG,
  SHELTER_STEP_DEG,
  unpackExposure,
} from "./shelter-grid";
import { STEP_DEG } from "./wave-exposure";

describe("shelter grid cells", () => {
  const rays = 360 / STEP_DEG;
  const exposure = (wind: number) => ({
    swell: Array.from({ length: rays }, (_, index) => index / rays),
    wind: Array.from({ length: rays }, () => wind),
    fetchKm: Array.from({ length: rays }, (_, index) => (index % 2 === 0 ? null : 12.3)),
  });

  it("keeps each cell's exposure to within the packing step, through the stored encoding", () => {
    const bytes = decodeCells(encodeCells(packExposures([exposure(0.5), exposure(0.2)])));
    const back = unpackExposure(bytes, 2, 1);
    expect(back.swell).toHaveLength(SHELTER_DIRECTIONS);
    // Direction 1 of 24 is 15°, ray 3 of 72.
    expect(back.swell[1]).toBeCloseTo(3 / rays, 2);
    expect(back.wind[5]).toBe(0.2);
    expect(unpackExposure(bytes, 2, 0).wind[5]).toBe(0.5);
    expect(back.fetchKm[0]).toBeNull();
    expect(back.fetchKm[1]).toBeCloseTo(12.25, 5);
  });

  it("rejects a file built for another grid or with cells that do not match its runs", () => {
    const cells = encodeCells(new Uint8Array(SHELTER_CELL_BYTES * 2));
    const layer = { south: 4, west: 73, rows: 1, columns: 2, inner: [[0, 0, 1]], outer: [[0, 1, 1]], land: [], other: [], blend: {}, cells };
    const good = {
      stepDeg: SHELTER_STEP_DEG,
      fineStepDeg: SHELTER_FINE_STEP_DEG,
      bandKm: SHELTER_BAND_KM,
      fineKm: SHELTER_FINE_KM,
      directions: SHELTER_DIRECTIONS,
      atolls: { a: { coarse: layer, fine: layer } },
    };
    expect(Object.keys(parseShelterGrid(JSON.stringify(good)).atolls)).toEqual(["a"]);
    expect(() => parseShelterGrid(JSON.stringify({ ...good, directions: 16 }))).toThrow(/another grid/);
    expect(() => parseShelterGrid(JSON.stringify({ ...good, atolls: { a: { coarse: layer } } }))).toThrow(/no fine grid/);
    const long = { ...layer, outer: [[0, 1, 2]] };
    expect(() => parseShelterGrid(JSON.stringify({ ...good, atolls: { a: { coarse: long, fine: layer } } }))).toThrow(/do not match/);
  });
});
