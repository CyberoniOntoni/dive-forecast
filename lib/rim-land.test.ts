import { describe, expect, it } from "vitest";
import { ringSamples } from "./atoll-ring";
import { openRimSources, type LagoonSource } from "./lagoon-flow";
import type { RimRing } from "./rim";
import { landBackedShares, LAND_BACK_KM } from "./rim-land";

// A square atoll about 22 km across, centred on 4°N 73.5°E, as in lagoon-flow.test.ts.
const RIM: RimRing = [
  [3.9, 73.4],
  [3.9, 73.6],
  [4.1, 73.6],
  [4.1, 73.4],
  [3.9, 73.4],
];
// A long thin island along the inside of the whole west rim, 300 m in from the edge.
const WEST_ISLAND: RimRing = [
  [3.89, 73.4027],
  [3.89, 73.4045],
  [4.11, 73.4045],
  [4.11, 73.4027],
  [3.89, 73.4027],
];
// An island well inside the lagoon, 5 km in from the east rim: past LAND_BACK_KM, so it closes nothing.
const LAGOON_ISLAND: RimRing = [
  [3.98, 73.55],
  [3.98, 73.555],
  [4.02, 73.555],
  [4.02, 73.55],
  [3.98, 73.55],
];

const west = { lat: 4.0, lon: 73.4 };
const east = { lat: 4.0, lon: 73.6 };
const north = { lat: 4.1, lon: 73.5 };
const south = { lat: 3.9, lon: 73.5 };

describe("landBackedShares", () => {
  it("closes the stretch of rim an island backs and leaves the rest open", () => {
    const [w, e, n, s] = landBackedShares(RIM, [west, east, north, south], [WEST_ISLAND]);
    // The west point stands for the west side and a little round each corner.
    expect(w).toBeGreaterThan(0.9);
    expect(e).toBe(0);
    // At the corners the island is within reach of the north and south edges' last steps.
    expect(n).toBeLessThan(0.05);
    expect(s).toBeLessThan(0.05);
  });

  it("ignores an island further in than LAND_BACK_KM", () => {
    expect(LAND_BACK_KM).toBeLessThan(5);
    expect(landBackedShares(RIM, [west, east, north], [LAGOON_ISLAND])).toEqual([0, 0, 0]);
  });

  it("is all open with no islands", () => {
    expect(landBackedShares(RIM, [west, east], [])).toEqual([0, 0]);
  });
});

describe("openRimSources", () => {
  const TIME = "2026-09-01T00:00";
  const sources: LagoonSource[] = ringSamples(RIM).map((sample) => ({
    lat: sample.on.lat,
    lon: sample.on.lon,
    weightKm: 7,
    flow: new Map([[TIME, 0.3]]),
  }));

  it("scales each opening's weight by the open share of its stretch, keeping every opening and its flow", () => {
    const open = openRimSources(sources, RIM, [WEST_ISLAND]);
    expect(open).toHaveLength(sources.length);
    open.forEach((source, index) => {
      expect(source.flow).toBe(sources[index].flow);
      expect(source.weightKm).toBeLessThanOrEqual(7);
    });
    const westOpenings = open.filter((source) => source.lon < 73.401 && source.lat > 3.92 && source.lat < 4.08);
    expect(westOpenings.length).toBeGreaterThan(0);
    for (const source of westOpenings) expect(source.weightKm).toBeLessThan(0.5);
    const eastOpenings = open.filter((source) => source.lon > 73.599);
    for (const source of eastOpenings) expect(source.weightKm).toBe(7);
  });
});
