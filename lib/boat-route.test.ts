import { describe, expect, it } from "vitest";
import { pointInRing, type RimRing } from "./rim";
import { forCellsOnLine, planRoute, type RouteShapes } from "./boat-route";

/** A closed box ring, [lat, lon]. */
function box(south: number, west: number, north: number, east: number): RimRing {
  return [
    [south, west],
    [north, west],
    [north, east],
    [south, east],
    [south, west],
  ];
}

const NONE: RouteShapes = { blockers: [], rims: [], gaps: [] };
/** An atoll outline 11 km a side; its east edge runs along 73.5. */
const ATOLL = box(4.0, 73.4, 4.1, 73.5);
const EAST_GAP = { lat: 4.05, lon: 73.5, widthM: 400, shallow: false };

/** True when a leg of the route passes through the ring (sampled every ~10 m). */
function crosses(points: readonly [number, number][], ring: RimRing): boolean {
  for (let index = 0; index + 1 < points.length; index += 1) {
    const [lat1, lon1] = points[index];
    const [lat2, lon2] = points[index + 1];
    const steps = Math.ceil(Math.hypot(lat2 - lat1, lon2 - lon1) / 0.0001);
    for (let step = 0; step <= steps; step += 1) {
      if (pointInRing(lat1 + ((lat2 - lat1) * step) / steps, lon1 + ((lon2 - lon1) * step) / steps, ring)) return true;
    }
  }
  return false;
}

describe("planRoute", () => {
  it("goes straight across open water", () => {
    const route = planRoute({ lat: 4.0, lon: 73.4 }, { lat: 4.03, lon: 73.43 }, NONE);
    expect(route.routed).toBe(true);
    expect(route.points).toHaveLength(2);
    expect(route.lengthKm).toBeCloseTo(route.directKm, 6);
  });

  it("goes round an island in the way and keeps off it", () => {
    const island = box(4.01, 73.41, 4.02, 73.42);
    const route = planRoute({ lat: 4.015, lon: 73.40 }, { lat: 4.015, lon: 73.43 }, { ...NONE, blockers: [island] });
    expect(route.routed).toBe(true);
    expect(crosses(route.points, island)).toBe(false);
    expect(route.lengthKm).toBeGreaterThan(route.directKm);
    expect(route.lengthKm).toBeLessThan(route.directKm * 1.5);
  });

  it("enters an atoll only through a gap in its outline", () => {
    const route = planRoute({ lat: 4.02, lon: 73.52 }, { lat: 4.02, lon: 73.47 }, { blockers: [], rims: [ATOLL], gaps: [EAST_GAP] });
    expect(route.routed).toBe(true);
    expect(route.gaps).toEqual([EAST_GAP]);
    const nearGap = route.points.some(([lat, lon]) => Math.abs(lat - 4.05) < 0.003 && Math.abs(lon - 73.5) < 0.003);
    expect(nearGap).toBe(true);
  });

  it("falls back to the straight line when the outline has no way in", () => {
    const route = planRoute({ lat: 4.02, lon: 73.52 }, { lat: 4.02, lon: 73.47 }, { blockers: [], rims: [ATOLL], gaps: [] });
    expect(route.routed).toBe(false);
    expect(route.points).toEqual([
      [4.02, 73.52],
      [4.02, 73.47],
    ]);
  });

  it("takes a deep gap over a nearer reef-flat sill", () => {
    const sill = { lat: 4.02, lon: 73.5, widthM: 400, shallow: true };
    const route = planRoute({ lat: 4.02, lon: 73.52 }, { lat: 4.02, lon: 73.47 }, { blockers: [], rims: [ATOLL], gaps: [sill, EAST_GAP] });
    expect(route.gaps).toEqual([EAST_GAP]);
  });

  it("reaches a site that sits on its own reef", () => {
    const thila = box(4.049, 73.449, 4.051, 73.451);
    const route = planRoute({ lat: 4.05, lon: 73.43 }, { lat: 4.05, lon: 73.45 }, { ...NONE, blockers: [thila] });
    expect(route.routed).toBe(true);
    expect(route.points[route.points.length - 1]).toEqual([4.05, 73.45]);
  });

  it("never straightens a leg through a thin diagonal reef", () => {
    // A sliver a few metres wide from SW to NE: the grid sees it only as a chain of cells touching at their corners.
    const sliver: RimRing = [
      [4.0, 73.4],
      [4.03, 73.43],
      [4.03, 73.43003],
      [4.0, 73.40003],
      [4.0, 73.4],
    ];
    const route = planRoute({ lat: 4.02, lon: 73.405 }, { lat: 4.005, lon: 73.425 }, { ...NONE, blockers: [sliver] });
    expect(route.routed).toBe(true);
    expect(crosses(route.points, sliver)).toBe(false);
  });
});

describe("forCellsOnLine", () => {
  const grid = { width: 5, height: 3 };
  const cells = (from: [number, number], to: [number, number]) => {
    const seen: [number, number][] = [];
    forCellsOnLine(grid, from, to, (cell) => seen.push([cell % grid.width, Math.floor(cell / grid.width)]));
    return seen;
  };

  it("visits a cell the line only clips at its corner", () => {
    // Crosses y = 1 at x = 1.95, so it spends 0.05 of a cell in (1, 1).
    expect(cells([0, 0.5], [4, 0.5 + (0.5 / 1.95) * 4])).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1],
    ]);
  });

  it("counts both side cells when the line runs exactly through a corner", () => {
    expect(cells([0.5, 0.5], [2.5, 2.5])).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
    ]);
  });
});
