import { describe, expect, it } from "vitest";
import type { RimRing } from "./rim";
import { exposureAt, fetchShare, offshorePoints, REEF_TRANSMISSION, siteExposure, STEP_DEG, type ExposureRing } from "./wave-exposure";

// A square atoll about 22 km across, centred on 4.0 N 73.5 E, with one 1 km gap in the middle of its east side.
const SQUARE: RimRing = [
  [3.9, 73.4],
  [4.1, 73.4],
  [4.1, 73.6],
  [3.9, 73.6],
  [3.9, 73.4],
];
const OWN: ExposureRing = { wayId: "own", ring: SQUARE };
const EAST_GAP = { lat: 4.0, lon: 73.6, widthM: 1000, wayId: "own" };
// A neighbour atoll whose west rim runs 2.2 km east of SQUARE's east rim: a strait between them.
const NEIGHBOUR: ExposureRing = {
  wayId: "neighbour",
  ring: [
    [3.9, 73.62],
    [4.1, 73.62],
    [4.1, 73.8],
    [3.9, 73.8],
    [3.9, 73.62],
  ],
};

describe("siteExposure", () => {
  it("leaves a wall open to the ocean it faces and sheltered from the lagoon side", () => {
    // On the east rim, its inward bearing pointing west into the lagoon.
    const wall = siteExposure({ lat: 4.05, lon: 73.6, kind: "wall", inwardBearingDeg: 270, ownWayId: "own" }, [OWN], []);
    expect(exposureAt(wall.swell, 90)).toBeGreaterThan(0.9);
    expect(exposureAt(wall.swell, 270)).toBeCloseTo(REEF_TRANSMISSION, 2);
    expect(exposureAt(wall.wind, 270)).toBeLessThan(0.2);
  });

  it("shelters the lagoon from swell everywhere but through a gap", () => {
    const middle = { lat: 4.0, lon: 73.55, kind: "lagoon" as const, inwardBearingDeg: null, ownWayId: "own" };
    const closed = siteExposure(middle, [OWN], []);
    const open = siteExposure(middle, [OWN], [EAST_GAP]);
    for (const from of [0, 90, 180, 270]) expect(exposureAt(closed.swell, from)).toBeLessThan(0.2);
    expect(exposureAt(open.swell, 90)).toBeGreaterThan(exposureAt(closed.swell, 90));
    expect(exposureAt(open.swell, 270)).toBeCloseTo(exposureAt(closed.swell, 270), 3);
  });

  it("does not let one atoll's gap open another atoll's reef", () => {
    const middle = { lat: 4.0, lon: 73.55, kind: "lagoon" as const, inwardBearingDeg: null, ownWayId: "own" };
    const closed = siteExposure(middle, [OWN], []);
    const foreignGap = siteExposure(middle, [OWN], [{ ...EAST_GAP, wayId: "neighbour" }]);
    expect(exposureAt(foreignGap.swell, 90)).toBeCloseTo(exposureAt(closed.swell, 90), 3);
  });

  it("lets wind chop grow again over the lagoon fetch", () => {
    // Near the east rim, the wind from the west has the whole lagoon to build over; from the east, almost none.
    const site = siteExposure({ lat: 4.0, lon: 73.59, kind: "lagoon", inwardBearingDeg: null, ownWayId: "own" }, [OWN], []);
    expect(exposureAt(site.wind, 270)).toBeGreaterThan(0.5);
    expect(exposureAt(site.wind, 90)).toBeLessThan(exposureAt(site.wind, 270));
    expect(exposureAt(site.swell, 270)).toBeLessThan(0.2);
    // The lagoon's open water upwind, for local chop: about 21 km to the west rim, about 1 km to the east one.
    expect(site.fetchKm[270 / STEP_DEG]).toBeCloseTo(21.1, 0);
    expect(site.fetchKm[90 / STEP_DEG]).toBeCloseTo(1.1, 0);
  });

  it("gives no local fetch where the ray runs out to sea, and the wall's own reef on its lagoon side", () => {
    const wall = siteExposure({ lat: 4.05, lon: 73.6, kind: "wall", inwardBearingDeg: 270, ownWayId: "own" }, [OWN], []);
    expect(wall.fetchKm[90 / STEP_DEG]).toBeNull();
    expect(wall.fetchKm[270 / STEP_DEG]).toBe(0.5);
  });

  it("does not read a channel pin's own rim as solid reef", () => {
    // A pass pin set by hand 1.1 km inside the east rim, with no gap matched in the openings.
    const pin = siteExposure({ lat: 4.0, lon: 73.59, kind: "channel", inwardBearingDeg: 270, ownWayId: "own" }, [OWN], []);
    // Without the skip every ray in the fan would hit the own rim at 1.1 km and keep 15 %.
    expect(exposureAt(pin.swell, 90)).toBeGreaterThan(0.8);
  });

  it("skips only the site's own rim, even when a neighbour's is closer", () => {
    // A wall of SQUARE pinned out in the strait: 1.4 km from its own outline, 0.8 km from the neighbour's.
    const wall = { lat: 4.0, lon: 73.613, kind: "wall" as const, inwardBearingDeg: 270, ownWayId: "own" };
    const alone = siteExposure(wall, [OWN], []);
    const inStrait = siteExposure(wall, [OWN, NEIGHBOUR], []);
    expect(exposureAt(alone.swell, 90)).toBeGreaterThan(0.9);
    // Swell from the east has to cross the neighbour's reef first, however close it is.
    expect(exposureAt(inStrait.swell, 90)).toBeLessThan(0.3);
  });

  it("still skips the own rim of a pass pin set inside it", () => {
    // A pass pin of SQUARE 0.9 km inside its east rim: its own rim is skipped, the neighbour 3.1 km east is not.
    const pass = { lat: 4.0, lon: 73.592, kind: "channel" as const, inwardBearingDeg: 270, ownWayId: "own" };
    expect(exposureAt(siteExposure(pass, [OWN], []).swell, 90)).toBeGreaterThan(0.8);
    expect(exposureAt(siteExposure(pass, [OWN, NEIGHBOUR], []).swell, 90)).toBeLessThan(0.3);
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

describe("siteExposure with islands", () => {
  // A 400 m square island 1 km east of a site in open water.
  const island = (lonOffset: number, wooded = true) => ({
    wooded,
    ring: [
      [3.998, 73.509 + lonOffset],
      [4.002, 73.509 + lonOffset],
      [4.002, 73.513 + lonOffset],
      [3.998, 73.513 + lonOffset],
      [3.998, 73.509 + lonOffset],
    ] as RimRing,
  });
  const site = { lat: 4.0, lon: 73.5, kind: "lagoon" as const, inwardBearingDeg: null, ownWayId: null };

  it("shelters the water just behind an island from swell, less so farther off", () => {
    const near = siteExposure({ ...site, lon: 73.508 }, [], [], [island(0)]);
    const open = siteExposure(site, [], [], []);
    const far = siteExposure({ ...site, lon: 73.45 }, [], [], [island(0)]);
    expect(exposureAt(open.swell, 90)).toBe(1);
    expect(exposureAt(near.swell, 90)).toBeLessThan(0.3);
    expect(exposureAt(far.swell, 90)).toBeGreaterThan(0.85);
    expect(exposureAt(near.swell, 270)).toBe(1);
  });

  it("ends the wind's fetch behind a wooded island, but not behind bare sand", () => {
    const wooded = siteExposure(site, [], [], [island(0)]);
    const bare = siteExposure(site, [], [], [island(0, false)]);
    // The island's west shore is about 1 km east; the trees' calm patch takes 0.2 km of it.
    expect(wooded.fetchKm[90 / STEP_DEG]).toBeCloseTo(1.0 - 0.2, 1);
    expect(bare.fetchKm[90 / STEP_DEG]).toBeNull();
    expect(exposureAt(bare.swell, 90)).toBeLessThan(0.8);
  });
});
