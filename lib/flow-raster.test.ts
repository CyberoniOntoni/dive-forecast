import { describe, expect, it } from "vitest";
import { encodeRing } from "./atlas-overlays";
import {
  buildFlowRaster,
  buildSeaRaster,
  cellAt,
  FlowParticles,
  KIND_LAGOON,
  KIND_LAND,
  KIND_SEA,
  velocityAt,
  type FlowChannel,
  type FlowRaster,
  type OceanPoint,
} from "./flow-raster";
import { decodeVectors, encodeVectors, FLOW_QUANTUM_KN, lagoonKnots, nearestWallHour, type FlowAtoll } from "./flow-wire";
import type { RimRing } from "./rim";

// A square atoll about 22 km across round 4°N 73.5°E, with an island in the middle of its south half.
const RIM: RimRing = [
  [3.9, 73.4],
  [3.9, 73.6],
  [4.1, 73.6],
  [4.1, 73.4],
  [3.9, 73.4],
];
const ISLAND: RimRing = [
  [3.94, 73.49],
  [3.94, 73.51],
  [3.96, 73.51],
  [3.96, 73.49],
  [3.94, 73.49],
];

/** A lagoon grid over the outline's box with the same velocity in every cell. */
function uniformLagoon(east: number, north: number): FlowAtoll["lagoon"] {
  const rows = 6;
  const columns = 6;
  const count = rows * columns;
  return {
    south: 3.86,
    west: 73.36,
    stepLat: 0.05,
    stepLon: 0.05,
    rows,
    columns,
    vectors: encodeVectors(Array(count).fill(east), Array(count).fill(north)),
  };
}

function atoll(lagoon: FlowAtoll["lagoon"], ocean: FlowAtoll["ocean"] = []): FlowAtoll {
  return { wayId: "1", atollId: "square", lagoon, ocean, channels: [], walls: [] };
}

const view = { south: 3.8, west: 73.3, north: 4.2, east: 73.7 };

/** A channel in the middle of the east rim, the flood running west into the lagoon. */
const EAST_PASS: FlowChannel = { lat: 4.0, lon: 73.6, headingDeg: 270, knots: 1.6, widthKm: 0.4 };

function speedAt(raster: FlowRaster, lat: number, lon: number): { east: number; north: number } {
  const out = [0, 0];
  expect(velocityAt(raster, lat, lon, out)).toBe(true);
  return { east: out[0], north: out[1] };
}

describe("flow wire", () => {
  it("sends each lagoon cell as two signed bytes, back within half a step", () => {
    const east = [0, 1.23, -2.5, 3.5];
    const north = [-0.01, 0.6, 2.2, -4];
    const back = decodeVectors(encodeVectors(east, north));
    expect(back.east).toHaveLength(4);
    for (let index = 0; index < 3; index += 1) {
      expect(Math.abs(back.east[index] - east[index])).toBeLessThanOrEqual(FLOW_QUANTUM_KN / 2 + 1e-6);
      expect(Math.abs(back.north[index] - north[index])).toBeLessThanOrEqual(FLOW_QUANTUM_KN / 2 + 1e-6);
    }
    // Past the byte's reach it holds at the top, keeping its sign.
    expect(back.east[3]).toBeCloseTo(127 * FLOW_QUANTUM_KN);
    expect(back.north[3]).toBeCloseTo(-127 * FLOW_QUANTUM_KN);
  });

  it("puts the lagoon's band edges between the map's band speeds", () => {
    expect(lagoonKnots(0)).toBe(0);
    expect(lagoonKnots(-1)).toBe(0);
    // Slack below 0.02, mild to 0.2, strong to 0.55 (LAGOON_BANDS): each edge between FLOW_KNOTS' bands.
    expect(lagoonKnots(0.02)).toBeGreaterThan(0.1);
    expect(lagoonKnots(0.02)).toBeLessThan(0.8);
    expect(lagoonKnots(0.2)).toBeGreaterThan(0.8);
    expect(lagoonKnots(0.2)).toBeLessThan(1.6);
    expect(lagoonKnots(0.55)).toBeGreaterThan(1.6);
    expect(lagoonKnots(0.55)).toBeLessThan(2.5);
    expect(lagoonKnots(9)).toBe(lagoonKnots(2));
  });

  it("rounds a wall time to the hour the map's pins show", () => {
    expect(nearestWallHour("2026-11-26T18:36")).toBe("2026-11-26T19:00");
    // Half past keeps the earlier hour, as nearestForecastHour does.
    expect(nearestWallHour("2026-11-26T18:30")).toBe("2026-11-26T18:00");
    expect(nearestWallHour("2026-12-31T23:45")).toBe("2027-01-01T00:00");
    expect(nearestWallHour("soon")).toBeNull();
  });
});

describe("buildFlowRaster", () => {
  it("marks the lagoon, the island and the sea, and keeps the lagoon model's heading inside", () => {
    const raster = buildFlowRaster(atoll(uniformLagoon(0.5, 0)), { outline: RIM, islands: [ISLAND] }, []);
    expect(raster.kind[cellAt(raster, 4.05, 73.5)]).toBe(KIND_LAGOON);
    expect(raster.kind[cellAt(raster, 3.95, 73.5)]).toBe(KIND_LAND);
    expect(raster.kind[cellAt(raster, 4.0, 73.65)]).toBe(KIND_SEA);
    const inside = speedAt(raster, 4.05, 73.5);
    expect(inside.east).toBeGreaterThan(0);
    // With no channel running to set it, the model's unitless flow is turned down, not shown at face value.
    expect(inside.east).toBeLessThan(0.5);
    expect(Math.abs(inside.north)).toBeLessThan(1e-6);
    // No ocean points and no sites: the sea is still.
    expect(Math.hypot(...Object.values(speedAt(raster, 4.0, 73.64)))).toBeLessThan(1e-6);
  });

  it("slows the lagoon to what the channels carry: speed × width spread over a half circle", () => {
    // The model says 1 knot everywhere; the one channel carries 1.6 knots through 400 m.
    const raster = buildFlowRaster(atoll(uniformLagoon(-1, 0)), { outline: RIM, islands: [] }, [EAST_PASS]);
    const expected = (1.6 * 0.4) / (Math.PI * 2);
    // Well away from the channel's jet and from the reef.
    const far = speedAt(raster, 3.96, 73.5);
    expect(-far.east).toBeCloseTo(expected, 1);
    expect(-far.east).toBeLessThan(0.2);
  });

  it("sets that scale from the lagoon side of the channel, whatever the model says out at sea", () => {
    // The model's grid runs past the outline; there (east of 73.6) it says 3 knots, inside 1 knot.
    const rows = 6;
    const columns = 6;
    const east = Array.from({ length: rows * columns }, (_, cell) => (cell % columns === 5 ? -3 : -1));
    const lagoon = { ...uniformLagoon(0, 0)!, vectors: encodeVectors(east, Array(rows * columns).fill(0)) };
    const raster = buildFlowRaster(atoll(lagoon), { outline: RIM, islands: [] }, [EAST_PASS]);
    expect(-speedAt(raster, 3.96, 73.5).east).toBeCloseTo((1.6 * 0.4) / (Math.PI * 2), 2);
  });

  it("does not run the lagoon flow into the reef away from a channel", () => {
    // The model runs east, straight at the east rim, which has no channel.
    const raster = buildFlowRaster(atoll(uniformLagoon(0.5, 0)), { outline: RIM, islands: [] }, []);
    expect(Math.abs(speedAt(raster, 4.05, 73.599).east)).toBeLessThan(0.01);
  });

  it("draws a current running past an incoming channel's mouth in toward it", () => {
    // 0.5 knots north along the east rim, past a channel flooding west.
    const ocean = [
      { lat: 4.0, lon: 73.7, east: 0, north: 0.5 },
      { lat: 3.8, lon: 73.7, east: 0, north: 0.5 },
    ];
    const raster = buildFlowRaster(atoll(uniformLagoon(0, 0), ocean), { outline: RIM, islands: [] }, [EAST_PASS]);
    // 0.5 km south of the mouth, just outside: still running north, and now also west, into the pass.
    const below = speedAt(raster, 4.0 - 0.5 / 110.57, 73.603);
    expect(below.north).toBeGreaterThan(0);
    expect(below.east).toBeLessThan(-0.1);
    // Out where the fan has faded, the current runs straight past.
    const away = speedAt(raster, 4.0 - 3 / 110.57, 73.603);
    expect(Math.abs(away.east)).toBeLessThan(0.02);
  });

  it("turns the ocean current to run along the reef next to it, and leaves it as it is far out", () => {
    // 1 knot toward the north-west everywhere round the atoll.
    const knots = 1 / Math.SQRT2;
    const ocean = [
      { lat: 4.0, lon: 73.7, east: -knots, north: knots },
      { lat: 4.0, lon: 73.3, east: -knots, north: knots },
    ];
    const raster = buildFlowRaster(atoll(null, ocean), { outline: RIM, islands: [] }, []);
    // Just off the east rim (a north-south reef) the water runs north along it: no westward part into the reef.
    const near = speedAt(raster, 4.0, 73.602);
    expect(Math.abs(near.east)).toBeLessThan(0.1);
    expect(near.north).toBeGreaterThan(0.7);
    // Five km out the ocean current is untouched.
    const far = speedAt(raster, 4.0, 73.6 + 5 / 111);
    expect(far.east).toBeCloseTo(-knots, 1);
    expect(far.north).toBeCloseTo(knots, 1);
  });

  it("runs a channel's jet along its heading at its band speed, a gate in the reef, wider and slower downstream", () => {
    const raster = buildFlowRaster(atoll(uniformLagoon(0, 0)), { outline: RIM, islands: [] }, [EAST_PASS]);
    const inGap = speedAt(raster, 4.0, 73.6);
    expect(inGap.east).toBeLessThan(-1.2);
    expect(Math.abs(inGap.north)).toBeLessThan(0.2);
    expect(raster.gate[cellAt(raster, 4.0, 73.599)]).toBe(1);
    expect(raster.gate[cellAt(raster, 4.0, 73.601)]).toBe(1);
    // 2 km into the lagoon the plume has spread and slowed.
    const inside = speedAt(raster, 4.0, 73.6 - 2 / 111);
    expect(inside.east).toBeLessThan(0);
    expect(-inside.east).toBeLessThan(-inGap.east);
    // Elsewhere on the rim there is no gate.
    expect(raster.gate[cellAt(raster, 4.05, 73.6)]).toBe(0);
  });

  it("runs the sea next to the reef at the along-reef model's current, not the lagoon behind it", () => {
    // The ring point on the east rim says 1.6 knots along the reef the "incoming" way: inward (west) turned 90°
    // clockwise, so north there. The ocean is still.
    const reef = [{ lat: 4.05, lon: 73.6, knots: 1.6 }];
    const raster = buildFlowRaster({ ...atoll(uniformLagoon(0, 0)), reef }, { outline: RIM, islands: [] }, []);
    expect(speedAt(raster, 4.05, 73.602).north).toBeGreaterThan(1.2);
    // Round the corner on the north rim it runs on the same way round the atoll: inward (south) turned 90°
    // clockwise is west.
    const north = speedAt(raster, 4.102, 73.5);
    expect(north.east).toBeLessThan(-1);
    expect(Math.abs(north.north)).toBeLessThan(0.2);
    expect(Math.hypot(...Object.values(speedAt(raster, 4.05, 73.59)))).toBeLessThan(0.05);
  });

  it("blends its open sea from a neighbouring atoll's ring points too", () => {
    // The atoll's own points run east; a neighbour 40 km west runs north. Midway between, both show.
    const own = ringOf(4.0, 73.5, 14, 1, 0);
    const neighbour = ringOf(4.0, 73.14, 6, 0, 1);
    const alone = buildFlowRaster(atoll(uniformLagoon(0, 0), own), { outline: RIM, islands: [] }, []);
    const shared = buildFlowRaster(atoll(uniformLagoon(0, 0), own), { outline: RIM, islands: [] }, [], [...own, ...neighbour]);
    const west = (raster: FlowRaster) => speedAt(raster, 4.0, 73.4 - 5 / 111);
    expect(west(alone).north).toBeCloseTo(0, 2);
    expect(west(shared).north).toBeGreaterThan(0.1);
    expect(west(shared).east).toBeGreaterThan(0.3);
  });
});

/** A reef top as an encoded ring: a thin box from (south, west) to (north, east). */
function reefTop(south: number, west: number, north: number, east: number): number[] {
  return encodeRing([
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ]);
}

describe("reef tops as the walls", () => {
  // Reef along the east rim, but for 6 km of open water in its middle with no listed channel.
  const reefs = [reefTop(3.9, 73.598, 3.97, 73.602), reefTop(4.03, 73.598, 4.1, 73.602)];

  it("lets the lagoon run out through open water between reefs, never over a reef top", () => {
    const raster = buildFlowRaster(atoll(uniformLagoon(2, 0)), { outline: RIM, islands: [], reefs }, []);
    expect(raster.kind[cellAt(raster, 3.95, 73.6)]).toBe(KIND_LAND);
    expect(raster.kind[cellAt(raster, 4.0, 73.6)]).not.toBe(KIND_LAND);
    const flock = new FlowParticles(400, 4, seeded(17));
    let out = 0;
    for (let step = 0; step < 400; step += 1) {
      const sides = Array.from(flock.lat, (lat, index) => (flock.rasterOf_(index) < 0 ? -1 : raster.kind[cellAt(raster, lat, flock.lon[index])]));
      flock.step(0.05, [raster], view, 0.001, true);
      for (let index = 0; index < flock.count; index += 1) {
        if (flock.rasterOf_(index) < 0) continue;
        const cell = cellAt(raster, flock.lat[index], flock.lon[index]);
        expect(raster.kind[cell]).not.toBe(KIND_LAND);
        if (sides[index] === KIND_LAGOON && raster.kind[cell] === KIND_SEA && flock.filled[index] >= 2) {
          out += 1;
          // Out through the open stretch only.
          expect(flock.lat[index]).toBeGreaterThan(3.96);
          expect(flock.lat[index]).toBeLessThan(4.04);
        }
      }
    }
    expect(out).toBeGreaterThan(0);
  });

  it("keeps a channel's gate open through a reef top along the whole rim", () => {
    const solid = [reefTop(3.9, 73.598, 4.1, 73.602)];
    const raster = buildFlowRaster(atoll(uniformLagoon(0, 0)), { outline: RIM, islands: [], reefs: solid }, [EAST_PASS]);
    expect(raster.kind[cellAt(raster, 4.0, 73.6)]).not.toBe(KIND_LAND);
    expect(raster.kind[cellAt(raster, 3.95, 73.6)]).toBe(KIND_LAND);
  });
});

describe("buildSeaRaster", () => {
  it("fills the sea between two atolls from both sides' ring points", () => {
    const north = ringOf(5.0, 73.5, 10, 1, 0);
    const south = ringOf(4.0, 73.5, 10, -1, 0);
    const sea = buildSeaRaster([...north, ...south])!;
    expect(sea.regional).toBe(true);
    // Beside each atoll its own current; midway, the two cancel.
    expect(speedAt(sea, 5.0, 73.5).east).toBeGreaterThan(0.6);
    expect(speedAt(sea, 4.0, 73.5).east).toBeLessThan(-0.6);
    expect(Math.abs(speedAt(sea, 4.5, 73.5).east)).toBeLessThan(0.1);
    // It reaches past the outermost points.
    expect(sea.south).toBeLessThan(4.0 - 10 / 111 - 0.2);
  });

  it("stops a particle at an island out on the open sea", () => {
    // The sea runs east at 2 knots onto an island 4 km across, with no atoll raster anywhere.
    const island = { south: 4.48, north: 4.52, west: 73.58, east: 73.62 };
    const sea = buildSeaRaster(ringOf(4.5, 73.5, 20, 2, 0), [island])!;
    expect(sea.kind[cellAt(sea, 4.5, 73.6)]).toBe(KIND_LAND);
    expect(sea.kind[cellAt(sea, 4.5, 73.5)]).toBe(KIND_SEA);
    const near = { south: 4.45, west: 73.45, north: 4.55, east: 73.65 };
    const flock = new FlowParticles(300, 4, seeded(9));
    for (let step = 0; step < 300; step += 1) {
      flock.step(0.1, [sea], near, 0.001, true);
      for (let index = 0; index < flock.count; index += 1) {
        if (flock.rasterOf_(index) < 0) continue;
        expect(sea.kind[cellAt(sea, flock.lat[index], flock.lon[index])]).not.toBe(KIND_LAND);
      }
    }
  });

  it("has no raster with no points", () => {
    expect(buildSeaRaster([])).toBeNull();
  });
});

/** Twelve ring points `km` from a centre, all with the same current (knots). */
function ringOf(lat: number, lon: number, km: number, east: number, north: number): OceanPoint[] {
  return Array.from({ length: 12 }, (_, index) => {
    const angle = (index / 12) * 2 * Math.PI;
    return { lat: lat + (km * Math.cos(angle)) / 110.57, lon: lon + (km * Math.sin(angle)) / 111, east, north };
  });
}

/** A fixed sequence, so the particles' random places repeat. */
function seeded(seed = 1): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

describe("FlowParticles", () => {
  const degPerKnotSecond = 0.001;

  it("never takes a particle across the reef away from a gate", () => {
    // The lagoon runs east at 2 knots, straight at the east rim, which has no channel.
    const raster = buildFlowRaster(atoll(uniformLagoon(2, 0)), { outline: RIM, islands: [] }, []);
    const flock = new FlowParticles(300, 4, seeded(7));
    for (let step = 0; step < 400; step += 1) {
      const before = Array.from(flock.lat, (lat, index) => [lat, flock.lon[index]]);
      flock.step(0.05, [raster], view, degPerKnotSecond, true);
      for (let index = 0; index < flock.count; index += 1) {
        const [lat, lon] = before[index];
        // A particle that moved (not one placed afresh) stays on its side.
        if (flock.filled[index] < 2 || lat === 0) continue;
        const from = raster.kind[cellAt(raster, lat, lon)];
        const to = raster.kind[cellAt(raster, flock.lat[index], flock.lon[index])];
        expect(to).toBe(from);
      }
    }
  });

  it("carries particles from the sea into the lagoon through an incoming channel", () => {
    const raster = buildFlowRaster(atoll(uniformLagoon(-0.4, 0)), { outline: RIM, islands: [] }, [EAST_PASS]);
    // Close round the pass, so most new particles are fed into it.
    const near = { south: 3.97, west: 73.55, north: 4.03, east: 73.65 };
    const flock = new FlowParticles(200, 4, seeded(3));
    let crossed = 0;
    for (let step = 0; step < 300; step += 1) {
      const sides = Array.from(flock.lat, (lat, index) => (lat === 0 ? -1 : raster.kind[cellAt(raster, lat, flock.lon[index])]));
      flock.step(0.05, [raster], near, degPerKnotSecond, true);
      for (let index = 0; index < flock.count; index += 1) {
        if (flock.filled[index] < 2) continue;
        if (sides[index] === KIND_SEA && raster.kind[cellAt(raster, flock.lat[index], flock.lon[index])] === KIND_LAGOON) crossed += 1;
      }
    }
    expect(crossed).toBeGreaterThan(20);
  });

  it("carries particles from the open sea onto an atoll's raster and never across its reef", () => {
    // The open sea heads west at 2 knots, straight at the east rim, which has no channel.
    const points = ringOf(4.0, 73.5, 14, -2, 0);
    const sea = buildSeaRaster(points)!;
    const raster = buildFlowRaster(atoll(uniformLagoon(0, 0), points), { outline: RIM, islands: [] }, []);
    const rasters = [raster, sea];
    const wide = { south: 3.8, west: 73.3, north: 4.2, east: 73.9 };
    const flock = new FlowParticles(300, 4, seeded(5));
    let handed = 0;
    for (let step = 0; step < 300; step += 1) {
      const before = Array.from({ length: flock.count }, (_, index) => flock.rasterOf_(index));
      const ages = Float32Array.from(flock.age);
      flock.step(0.1, rasters, wide, degPerKnotSecond, true);
      for (let index = 0; index < flock.count; index += 1) {
        // Handed over, not placed anew (a new particle starts its age again).
        if (before[index] !== 1 || flock.rasterOf_(index) !== 0 || flock.age[index] < ages[index]) continue;
        handed += 1;
        // A particle that came from the sea is on the atoll raster's sea, never inside the lagoon.
        expect(raster.kind[cellAt(raster, flock.lat[index], flock.lon[index])]).toBe(KIND_SEA);
      }
    }
    expect(handed).toBeGreaterThan(0);
    for (let index = 0; index < flock.count; index += 1) {
      if (flock.rasterOf_(index) !== 1) continue;
      // On the open sea's raster, never over the atoll's.
      expect(cellAt(raster, flock.lat[index], flock.lon[index])).toBe(-1);
    }
  });

  it("keeps a particle on one atoll's margin off its neighbour's reef, and hands it on to the neighbour's raster", () => {
    // A second square atoll 3 km east of the first, inside the first's sea margin; the sea runs east at 2 knots.
    const shift = 0.23;
    const east: RimRing = RIM.map(([lat, lon]) => [lat, lon + shift]);
    const points = [...ringOf(4.0, 73.5, 14, 2, 0), ...ringOf(4.0, 73.5 + shift, 14, 2, 0)];
    const a = buildFlowRaster(atoll(uniformLagoon(0, 0), points), { outline: RIM, islands: [] }, []);
    const b = buildFlowRaster({ ...atoll(uniformLagoon(0, 0), points), wayId: "2" }, { outline: east, islands: [] }, []);
    const boxes = [RIM, east].map((ring) => ({
      south: Math.min(...ring.map((p) => p[0])),
      north: Math.max(...ring.map((p) => p[0])),
      west: Math.min(...ring.map((p) => p[1])),
      east: Math.max(...ring.map((p) => p[1])),
    }));
    const sea = buildSeaRaster(points, boxes)!;
    const rasters = [a, b, sea];
    // The strip between them, where the first's margin reaches the neighbour's reef, and the sea south of both, where
    // the first's margin ends on the neighbour's.
    const strip = { south: 3.86, west: 73.6, north: 4.05, east: 73.68 };
    const flock = new FlowParticles(300, 4, seeded(13));
    let handed = 0;
    for (let step = 0; step < 300; step += 1) {
      const before = Array.from({ length: flock.count }, (_, index) => flock.rasterOf_(index));
      const ages = Float32Array.from(flock.age);
      flock.step(0.1, rasters, strip, 0.001, true);
      for (let index = 0; index < flock.count; index += 1) {
        if (flock.rasterOf_(index) === 0) {
          const cell = cellAt(b, flock.lat[index], flock.lon[index]);
          if (cell >= 0) expect(b.kind[cell]).toBe(KIND_SEA);
        }
        if (before[index] === 0 && flock.rasterOf_(index) === 1 && flock.age[index] >= ages[index]) handed += 1;
      }
    }
    expect(handed).toBeGreaterThan(0);
  });

  it("never places a particle on an island", () => {
    const raster = buildFlowRaster(atoll(uniformLagoon(0.3, 0.3)), { outline: RIM, islands: [ISLAND] }, []);
    const flock = new FlowParticles(500, 3, seeded(11));
    for (let step = 0; step < 50; step += 1) {
      flock.step(0.05, [raster], view, degPerKnotSecond, true);
      for (let index = 0; index < flock.count; index += 1) {
        const cell = cellAt(raster, flock.lat[index], flock.lon[index]);
        if (cell >= 0) expect(raster.kind[cell]).not.toBe(KIND_LAND);
      }
    }
  });
});
