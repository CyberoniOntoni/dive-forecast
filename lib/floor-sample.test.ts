import { describe, expect, it } from "vitest";
import { ACA_MAX_DEPTH_M, pickSeawardKm, sectionFromTransect, type TransectSample } from "./floor-sample";

describe("seaward step", () => {
  it("stays at 3 km when that cell is already open ocean", () => {
    expect(pickSeawardKm([{ km: 3, elevationM: -200 }])).toEqual({ km: 3, open: true });
  });

  it("treats -50 m as open and -49 m as not", () => {
    expect(pickSeawardKm([{ km: 3, elevationM: -50 }]).open).toBe(true);
    expect(pickSeawardKm([{ km: 3, elevationM: -49 }, { km: 6, elevationM: -80 }])).toEqual({ km: 6, open: true });
  });

  it("walks past land and the reef to the first open cell", () => {
    const picked = pickSeawardKm([
      { km: 3, elevationM: 2 },
      { km: 6, elevationM: -20 },
      { km: 9, elevationM: -400 },
    ]);
    expect(picked).toEqual({ km: 9, open: true });
  });

  it("stays at 3 km when the shelf is shallow out to 15 km", () => {
    const cells = [3, 6, 9, 12, 15].map((km) => ({ km, elevationM: -30 }));
    expect(pickSeawardKm(cells)).toEqual({ km: 3, open: false });
  });
});

describe("channel section from a transect", () => {
  const line = (depths: (number | null)[], step = 10): TransectSample[] =>
    depths.map((depthM, index) => ({ distanceM: index * step, depthM }));

  it("returns the mean of the deep gap, not the shoalest cell in it", () => {
    const section = sectionFromTransect(line([2, 6, 10, 6, 2]), null);
    expect(section).toEqual({ widthM: 30, depthM: 22 / 3 });
  });

  it("rejects an unobserved pixel instead of treating it as deep", () => {
    expect(sectionFromTransect(line([2, 6, null, 6, 2]), null)).toBeNull();
  });

  it("rejects an Allen Coral Atlas gap that exceeds the optical range", () => {
    expect(sectionFromTransect(line([2, 8, 20, 8, 2]), ACA_MAX_DEPTH_M)).toBeNull();
  });

  it("accepts a fully observed shallow gap inside that range", () => {
    const section = sectionFromTransect(line([2, 3, 8, 9, 8, 3, 2]), ACA_MAX_DEPTH_M);
    expect(section).toEqual({ widthM: 30, depthM: 25 / 3 });
  });

  it("rejects a reef flat, a slope with no far shoulder, and a gap narrower than 20 m", () => {
    expect(sectionFromTransect(line([1, 2, 4, 2, 1]), null)).toBeNull();
    expect(sectionFromTransect(line([10, 12, 11]), null)).toBeNull();
    expect(sectionFromTransect(line([2, 3, 20, 3, 2], 5), null)).toBeNull();
  });
});
