import { describe, expect, it } from "vitest";
import {
  decodeCells,
  encodeCells,
  packExposures,
  parseShelterGrid,
  seaOwner,
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
    // Direction 1 of 24 is 15°: the mean of rays 2, 3 and 4 of 72.
    expect(back.swell[1]).toBeCloseTo(3 / rays, 2);
    expect(back.wind[5]).toBe(0.2);
    expect(unpackExposure(bytes, 2, 0).wind[5]).toBe(0.5);
    // Rays alternate open sea and 12.3 km: every bin has one of each, so keeps the fetch.
    expect(back.fetchKm[0]).toBeCloseTo(12.25, 5);
  });

  it("keeps a short fetch seen by only one ray of a bin", () => {
    // Direction 6 (90°) spans rays 17, 18 and 19 (85°, 90°, 95°); only 95° sees an island 0.5 km off.
    const fetchKm: (number | null)[] = Array.from({ length: rays }, () => 8);
    fetchKm[19] = 0.5;
    fetchKm[30] = null;
    const back = unpackExposure(packExposures([{ ...exposure(0.5), fetchKm }]), 1, 0);
    expect(back.fetchKm[6]).toBe(0.5);
    expect(back.fetchKm[7]).toBe(8);
    // Ray 30 (150°) alone open: the bin still has sheltered water.
    expect(back.fetchKm[10]).toBe(8);
    const open = unpackExposure(packExposures([{ ...exposure(0.5), fetchKm: Array(rays).fill(null) }]), 1, 0);
    expect(open.fetchKm[6]).toBeNull();
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

describe("seaOwner", () => {
  // North and South Malé, from data/rims.json, about 7 km apart across Vaadhoo Kandu.
  const NORTH_MALE = "671807044";
  const SOUTH_MALE = "671807056";

  it("gives a lagoon to its atoll and the sea to the nearest outline, blending where two seas meet", () => {
    expect(seaOwner(4.25, 73.45)).toEqual({ wayId: NORTH_MALE, outside: false, island: false });
    const seam = seaOwner(4.14, 73.5);
    expect(seam).toMatchObject({ wayId: SOUTH_MALE, outside: true, blend: { wayId: NORTH_MALE } });
    expect(seam?.blend?.share).toBeGreaterThan(0.5);
    expect(seam?.blend?.share).toBeLessThan(1);
    expect(seaOwner(4.16, 73.5)).toMatchObject({ wayId: NORTH_MALE, outside: true });
    // Far out in the ocean east of North Malé.
    expect(seaOwner(4.3, 73.8)).toBeNull();
  });
});
