import { describe, expect, it } from "vitest";
import { bearingDeg, distanceKm, nearestOnPolyline } from "./geometry";

describe("bearingDeg", () => {
  it("bears east along the equator and north up a meridian", () => {
    expect(bearingDeg({ lat: 0, lon: 73 }, { lat: 0, lon: 74 })).toBeCloseTo(90, 6);
    expect(bearingDeg({ lat: 4, lon: 73 }, { lat: 5, lon: 73 })).toBeCloseTo(0, 6);
    expect(bearingDeg({ lat: 4, lon: 73 }, { lat: 4, lon: 72 })).toBeCloseTo(270, 0);
  });
});

describe("distanceKm", () => {
  it("measures a degree of latitude as about 111 km", () => {
    expect(distanceKm({ lat: 4, lon: 73 }, { lat: 5, lon: 73 })).toBeCloseTo(111.19, 1);
  });
});

describe("nearestOnPolyline", () => {
  it("finds the foot, its segment and the squared distance", () => {
    const line: [number, number][] = [
      [0, 0],
      [2, 0],
      [2, 2],
    ];
    expect(nearestOnPolyline([3, 1], line)).toEqual({ foot: [2, 1], segment: 1, distanceSq: 1 });
    expect(nearestOnPolyline([1, -1], line)).toEqual({ foot: [1, 0], segment: 0, distanceSq: 1 });
  });
});
