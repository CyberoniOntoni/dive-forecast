import { describe, expect, it } from "vitest";
import type { RimRing } from "./rim";
import { exposureAt, fetchShare, offshorePoints, REEF_TRANSMISSION, siteExposure } from "./wave-exposure";

// A square atoll about 22 km across, centred on 4.0 N 73.5 E, with one 1 km gap in the middle of its east side.
const SQUARE: RimRing = [
  [3.9, 73.4],
  [4.1, 73.4],
  [4.1, 73.6],
  [3.9, 73.6],
  [3.9, 73.4],
];
const EAST_GAP = { lat: 4.0, lon: 73.6, widthM: 1000 };

describe("siteExposure", () => {
  it("leaves a wall open to the ocean it faces and sheltered from the lagoon side", () => {
    // On the east rim, its inward bearing pointing west into the lagoon.
    const wall = siteExposure({ lat: 4.05, lon: 73.6, kind: "wall", inwardBearingDeg: 270 }, [SQUARE], []);
    expect(exposureAt(wall.swell, 90)).toBeGreaterThan(0.9);
    expect(exposureAt(wall.swell, 270)).toBeCloseTo(REEF_TRANSMISSION, 2);
    expect(exposureAt(wall.wind, 270)).toBeLessThan(0.2);
  });

  it("shelters the lagoon from swell everywhere but through a gap", () => {
    const middle = { lat: 4.0, lon: 73.55, kind: "lagoon" as const, inwardBearingDeg: null };
    const closed = siteExposure(middle, [SQUARE], []);
    const open = siteExposure(middle, [SQUARE], [EAST_GAP]);
    for (const from of [0, 90, 180, 270]) expect(exposureAt(closed.swell, from)).toBeLessThan(0.2);
    expect(exposureAt(open.swell, 90)).toBeGreaterThan(exposureAt(closed.swell, 90));
    expect(exposureAt(open.swell, 270)).toBeCloseTo(exposureAt(closed.swell, 270), 3);
  });

  it("lets wind chop grow again over the lagoon fetch", () => {
    // Near the east rim, the wind from the west has the whole lagoon to build over; from the east, almost none.
    const site = siteExposure({ lat: 4.0, lon: 73.59, kind: "lagoon", inwardBearingDeg: null }, [SQUARE], []);
    expect(exposureAt(site.wind, 270)).toBeGreaterThan(0.5);
    expect(exposureAt(site.wind, 90)).toBeLessThan(exposureAt(site.wind, 270));
    expect(exposureAt(site.swell, 270)).toBeLessThan(0.2);
  });
});

describe("fetchShare", () => {
  it("grows with the square root of fetch and caps at 1", () => {
    expect(fetchShare(15)).toBeCloseTo(0.5, 5);
    expect(fetchShare(600)).toBe(1);
    expect(fetchShare(0)).toBe(0);
  });
});

describe("offshorePoints", () => {
  it("puts eight points outside the outline, one per side", () => {
    const points = offshorePoints(SQUARE);
    expect(points.map((point) => point.sideDeg)).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
    const north = points[0];
    const east = points[2];
    expect(north.lat).toBeGreaterThan(4.15);
    expect(east.lon).toBeGreaterThan(73.65);
  });
});
