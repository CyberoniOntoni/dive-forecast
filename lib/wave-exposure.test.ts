import { describe, expect, it } from "vitest";
import type { RimRing } from "./rim";
import { exposureAt, exposureShoal, fetchShare, offshorePoints, REEF_TRANSMISSION, siteExposure, STEP_DEG, type ExposureRing } from "./wave-exposure";

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
  /** A square island of side `size` degrees centred on a point. */
  const square = (lat: number, lon: number, size: number) =>
    [
      [lat - size / 2, lon - size / 2],
      [lat + size / 2, lon - size / 2],
      [lat + size / 2, lon + size / 2],
      [lat - size / 2, lon + size / 2],
      [lat - size / 2, lon - size / 2],
    ] as RimRing;

  it("shelters the water just behind an island from swell, less so farther off", () => {
    const near = siteExposure({ ...site, lon: 73.508 }, [], [], [island(0)]);
    const open = siteExposure(site, [], [], []);
    const far = siteExposure({ ...site, lon: 73.45 }, [], [], [island(0)]);
    expect(exposureAt(open.swell, 90)).toBe(1);
    expect(exposureAt(near.swell, 90)).toBeLessThan(0.3);
    expect(exposureAt(far.swell, 90)).toBeGreaterThan(0.85);
    expect(exposureAt(near.swell, 270)).toBe(1);
  });

  it("lets a small island between two rays cast its shadow, by the share of sky it fills", () => {
    // A 60 m islet 300 m away at 92°, between the 90° and 95° rays: about 11° of the horizon.
    const islet = { wooded: false, ring: square(4.0 - 0.0105 * Math.cos((92 * Math.PI) / 180), 73.5 + 0.0027, 0.00054) };
    const open = siteExposure(site, [], [], []);
    const behind = siteExposure(site, [], [], [islet]);
    expect(exposureAt(behind.swell, 92)).toBeLessThan(exposureAt(open.swell, 92) - 0.1);
    expect(exposureAt(behind.swell, 272)).toBe(1);
    // Far off, the same islet fills a sliver of sky and barely matters.
    const far = siteExposure(site, [], [], [{ ...islet, ring: square(4.0, 73.5 + 0.045, 0.00054) }]);
    expect(exposureAt(far.swell, 90)).toBeGreaterThan(0.97);
    expect(exposureAt(far.swell, 90)).toBeLessThan(1);
  });

  it("reads a wooded island's fetch along each bearing, not from its nearest point", () => {
    // A 4 km wooded island running north-south 500 m east of the site.
    const long = { wooded: true, ring: [[3.982, 73.5045], [4.018, 73.5045], [4.018, 73.508], [3.982, 73.508], [3.982, 73.5045]] as RimRing };
    const exposure = siteExposure(site, [], [], [long]);
    expect(exposure.fetchKm[90 / STEP_DEG]).toBeCloseTo(0.5 - 0.2, 1);
    // The 30° ray spans 27.5° to 32.5°: the shore is 0.5 / sin 32.5° = 0.93 km off along its nearest arc, not 0.5.
    expect(exposure.fetchKm[30 / STEP_DEG]).toBeCloseTo(0.93 - 0.2, 1);
  });

  it("keeps a wooded islet's lee when it falls between two rays", () => {
    // About 100 m across, 1.5 km off at 92.5°: under half of each of the 90° and 95° rays.
    const at = (92.5 * Math.PI) / 180;
    const islet = { wooded: true, ring: square(4.0 + (1.5 * Math.cos(at)) / 110.57, 73.5 + (1.5 * Math.sin(at)) / 111.04, 0.0009) };
    const exposure = siteExposure(site, [], [], [islet]);
    expect(exposure.fetchKm[90 / STEP_DEG]).toBeCloseTo(1.45 - 0.2, 1);
    expect(exposure.fetchKm[95 / STEP_DEG]).toBeCloseTo(1.45 - 0.2, 1);
    expect(exposure.fetchKm[100 / STEP_DEG]).toBeNull();
  });

  it("calms only the part of an arc a near islet fills; the rest keeps the farther shore's fetch", () => {
    // A 20 m wooded islet 0.4 km east (about 2.9° of sky, so partly filling the arcs at its edges) in front of a long
    // wooded island 30 km east that fills the whole 90° ray.
    const islet = { wooded: true, ring: square(4.0, 73.5 + 0.4 / 111.04, 0.00018) };
    const far = { wooded: true, ring: [[3.7, 73.77], [4.3, 73.77], [4.3, 73.8], [3.7, 73.8], [3.7, 73.77]] as RimRing };
    const ray = 90 / STEP_DEG;
    const alone = siteExposure(site, [], [], [islet]).rayWind[ray];
    const behind = siteExposure(site, [], [], [far]).rayWind[ray];
    const both = siteExposure(site, [], [], [islet, far]);
    expect(both.fetchKm[ray]).toBeCloseTo(0.4 - 0.009 - 0.2, 1);
    // Each share of an arc counts at its own shore. Alone, the islet's share s calms the ray by s·(1 − f_islet); in
    // front of the far island the same share swaps that island's wind for the islet's: s·(f_far − f_islet). Counting
    // the islet's edge arcs as wholly calmed would make the second drop bigger than this ratio says.
    const fIslet = fetchShare(0.4 - 0.009 - 0.2);
    const fFar = fetchShare(30 - 0.2);
    expect((behind - both.rayWind[ray]) / (1 - alone)).toBeCloseTo((fFar - fIslet) / (1 - fIslet), 1);
  });

  it("cuts the swell behind a lagoon shoal, by how much of the sky it fills, but not the wind", () => {
    // Inside SQUARE, 5 km from its east rim: a reef top 1 km east, about 450 m across (about 25° of sky).
    const lagoon = { lat: 4.0, lon: 73.555, kind: "lagoon" as const, inwardBearingDeg: null, ownWayId: "own" };
    const shoal = (lonOffset: number, transmission: number) => exposureShoal(square(4.0, 73.555 + lonOffset, 0.004), transmission);
    const open = siteExposure(lagoon, [OWN], [EAST_GAP]);
    const behind = siteExposure(lagoon, [OWN], [EAST_GAP], [], [shoal(0.009, 0.15)]);
    const sand = siteExposure(lagoon, [OWN], [EAST_GAP], [], [shoal(0.009, 0.5)]);
    expect(exposureAt(behind.swell, 90)).toBeLessThan(0.6 * exposureAt(open.swell, 90));
    expect(exposureAt(sand.swell, 90)).toBeLessThan(exposureAt(open.swell, 90));
    expect(exposureAt(sand.swell, 90)).toBeGreaterThan(exposureAt(behind.swell, 90));
    expect(exposureAt(behind.swell, 270)).toBeCloseTo(exposureAt(open.swell, 270), 3);
    // Swell only: the wind blows on over a shoal, so its share, the unspread ray share and the fetch stay as they were.
    expect(behind.fetchKm).toEqual(open.fetchKm);
    expect(behind.wind).toEqual(open.wind);
    expect(behind.rayWind).toEqual(open.rayWind);
    // Out past the rim (and its gap), the reef has cut that swell already: the shoal adds nothing.
    const outside = siteExposure(lagoon, [OWN], [EAST_GAP], [], [shoal(0.06, 0.15)]);
    expect(outside.swell).toEqual(open.swell);
    // A cell on the shoal itself reads the swell that crossed the shoals round it.
    const onTop = siteExposure({ ...lagoon, lon: 73.564 }, [OWN], [EAST_GAP], [], [shoal(0.009, 0.15)]);
    expect(onTop.swell).toEqual(siteExposure({ ...lagoon, lon: 73.564 }, [OWN], [EAST_GAP]).swell);
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
