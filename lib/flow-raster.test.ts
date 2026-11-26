import { describe, expect, it } from "vitest";
import {
  buildFlowRaster,
  cellAt,
  FlowParticles,
  KIND_LAGOON,
  KIND_LAND,
  KIND_SEA,
  velocityAt,
  type FlowRaster,
  type FlowVector,
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
const EAST_PASS: FlowVector = { lat: 4.0, lon: 73.6, headingDeg: 270, knots: 1.6 };

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
  it("marks the lagoon, the island and the sea, and takes the lagoon model's flow inside", () => {
    const raster = buildFlowRaster(atoll(uniformLagoon(0.5, 0)), { outline: RIM, islands: [ISLAND] }, [], []);
    expect(raster.kind[cellAt(raster, 4.05, 73.5)]).toBe(KIND_LAGOON);
    expect(raster.kind[cellAt(raster, 3.95, 73.5)]).toBe(KIND_LAND);
    expect(raster.kind[cellAt(raster, 4.0, 73.65)]).toBe(KIND_SEA);
    expect(speedAt(raster, 4.05, 73.5).east).toBeCloseTo(0.5, 1);
    // No ocean points and no sites: the sea is still.
    expect(Math.hypot(...Object.values(speedAt(raster, 4.0, 73.64)))).toBeLessThan(1e-6);
  });

  it("turns the ocean current to run along the reef next to it, and leaves it as it is far out", () => {
    // 1 knot toward the north-west everywhere round the atoll.
    const knots = 1 / Math.SQRT2;
    const ocean = [
      { lat: 4.0, lon: 73.7, east: -knots, north: knots },
      { lat: 4.0, lon: 73.3, east: -knots, north: knots },
    ];
    const raster = buildFlowRaster(atoll(null, ocean), { outline: RIM, islands: [] }, [], []);
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
    const raster = buildFlowRaster(atoll(uniformLagoon(0, 0)), { outline: RIM, islands: [] }, [EAST_PASS], []);
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

  it("lets a wall site's forecast hold the sea next to it, and not the lagoon behind it", () => {
    const wall: FlowVector = { lat: 4.05, lon: 73.601, headingDeg: 0, knots: 1.6 };
    const raster = buildFlowRaster(atoll(uniformLagoon(0, 0)), { outline: RIM, islands: [] }, [], [wall]);
    expect(speedAt(raster, 4.05, 73.605).north).toBeGreaterThan(1);
    expect(Math.hypot(...Object.values(speedAt(raster, 4.05, 73.59)))).toBeLessThan(0.05);
  });
});

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
    const raster = buildFlowRaster(atoll(uniformLagoon(2, 0)), { outline: RIM, islands: [] }, [], []);
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
    const raster = buildFlowRaster(atoll(uniformLagoon(-0.4, 0)), { outline: RIM, islands: [] }, [EAST_PASS], []);
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

  it("never places a particle on an island", () => {
    const raster = buildFlowRaster(atoll(uniformLagoon(0.3, 0.3)), { outline: RIM, islands: [ISLAND] }, [], []);
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
