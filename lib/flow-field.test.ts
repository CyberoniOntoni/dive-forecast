import { describe, expect, it } from "vitest";
import { atollRoles, lagoonFlowGrid, lagoonGrid, oceanPoints } from "./flow-field";
import { decodeVectors } from "./flow-wire";
import { lagoonSink, lagoonSinkCells, sinkAt, type LagoonSource } from "./lagoon-flow";
import type { RimRing } from "./rim";
import type { Atoll, MarineHour, Site } from "./types";

const RIM: RimRing = [
  [3.9, 73.4],
  [3.9, 73.6],
  [4.1, 73.6],
  [4.1, 73.4],
  [3.9, 73.4],
];
const TIME = "2026-09-01T00:00";

describe("lagoon sink cells", () => {
  it("give the same pull as lagoonSink, built once for a whole grid", () => {
    const cells = lagoonSinkCells(RIM);
    for (const point of [{ lat: 4, lon: 73.5 }, { lat: 3.93, lon: 73.58 }, { lat: 4.2, lon: 73.3 }]) {
      const shared = sinkAt(point, cells);
      const own = lagoonSink(point, RIM);
      expect(shared.east).toBeCloseTo(own.east, 12);
      expect(shared.north).toBeCloseTo(own.north, 12);
      expect(shared.areaKm2).toBeCloseTo(own.areaKm2, 9);
    }
  });
});

describe("lagoonFlowGrid", () => {
  it("spreads the flood from an opening across the lagoon, in knots, and has nothing without the hour", () => {
    const grid = lagoonGrid(RIM);
    // One opening in the middle of the west rim, flooding in.
    const sources: LagoonSource[] = [{ lat: 4.0, lon: 73.4, weightKm: 4, flow: new Map([[TIME, 0.2]]) }];
    const field = lagoonFlowGrid(grid, sources, TIME);
    expect(field).not.toBeNull();
    const { east, north } = decodeVectors(field!.vectors);
    expect(east).toHaveLength(grid.rows * grid.columns);
    // A cell 3 km east of the opening runs east, away from it.
    const row = Math.floor((4.0 - grid.south) / grid.stepLat);
    const column = Math.floor((73.427 - grid.west) / grid.stepLon);
    const cell = row * grid.columns + column;
    expect(east[cell]).toBeGreaterThan(0.1);
    expect(Math.abs(north[cell])).toBeLessThan(east[cell]);
    expect(lagoonFlowGrid(grid, sources, "2026-09-01T05:00")).toBeNull();
  });
});

describe("oceanPoints", () => {
  it("turns the ocean model's speed and heading into knots east and north, leaving out points without the hour", () => {
    const hour = (velocity: number | null, direction: number | null): MarineHour[] => [
      { time: TIME, seaLevelM: 0, currentVelocityMs: velocity, currentDirectionDeg: direction },
    ];
    const samples = [
      { seaward: { lat: 4.0, lon: 73.7 } },
      { seaward: { lat: 4.2, lon: 73.5 } },
      { seaward: { lat: 3.8, lon: 73.5 } },
    ];
    const points = oceanPoints(samples, [hour(0.5, 90), hour(null, 90), null], TIME);
    expect(points).toHaveLength(1);
    expect(points[0].east).toBeCloseTo(0.97, 2);
    expect(points[0].north).toBeCloseTo(0, 2);
  });
});

describe("atollRoles", () => {
  const atoll: Atoll = { id: "square", name: "Square", oceanLat: 4, oceanLon: 73.7, rimSourceUrl: "https://www.openstreetmap.org/way/1" };
  const site = (id: string, siteType: Site["siteType"], extra: Partial<Site> = {}): Site => ({
    id,
    name: id,
    atollId: "square",
    lat: 4,
    lon: 73.6,
    sourceUrl: "https://example.org",
    siteType,
    ...extra,
  });

  it("gates the reef at channels only, and runs walls along it", () => {
    const sites = [
      site("pass", "pass", { channelWidthM: 250, atlasWidthM: 300 }),
      site("thila", "channel-thila", { lat: 4.002, atlasWidthM: 400 }),
      site("corner", "corner", { lat: 4.004 }),
      site("wall", "outer-reef", { lat: 4.05 }),
      site("strait", "strait-wall", { lat: 3.95 }),
      site("inside", "lagoon", { lon: 73.5 }),
      site("other-atoll", "pass", { atollId: "elsewhere" }),
    ];
    expect(atollRoles(atoll, sites)).toEqual({
      channels: [
        { id: "pass", widthM: 250 },
        { id: "thila", widthM: 400 },
        { id: "corner", widthM: null },
      ],
      walls: ["wall", "strait"],
    });
  });
});
