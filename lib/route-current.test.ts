import { describe, expect, it } from "vitest";
import {
  crab,
  currentAt,
  currentHeading,
  currentKnots,
  currentVector,
  routeTime,
  waterKnots,
  type RouteCurrent,
} from "./route-current";

/** One nautical mile of latitude is one minute of arc. */
const NM_LAT = 1 / 60;
const T0 = Date.UTC(2026, 9, 30, 3, 0);
const HOUR = 3_600_000;

/** A route due north from 4°N, `nm` long. */
function northRoute(nm: number): [number, number][] {
  return [
    [4, 73.5],
    [4 + nm * NM_LAT, 73.5],
  ];
}

/** A whole route under one current source with these hours (heading, knots, strength). */
function steady(hours: { at: number; heading: number; knots: number; strength?: "too_strong" }[], samples = 50): RouteCurrent {
  return {
    stepKm: 0.25,
    samples: Array(samples).fill(0),
    sources: [
      {
        siteId: "pass",
        name: "Test Kandu",
        hours: hours.map(({ at, heading, knots, strength }) => ({
          timeMs: T0 + at * HOUR,
          strength: strength ?? "mild",
          ...currentVector(heading, knots),
        })),
      },
    ],
  };
}

describe("current vectors", () => {
  it("round-trips heading and speed", () => {
    const current = currentVector(135, 2);
    expect(currentKnots(current)).toBeCloseTo(2, 9);
    expect(currentHeading(current)).toBeCloseTo(135, 9);
  });
});

describe("crab", () => {
  it("steers straight down the track with no current", () => {
    expect(crab(90, 10, { eastKn: 0, northKn: 0 })).toEqual({ headingDeg: 90, groundKnots: 10 });
  });

  it("goes faster with the current behind and slower against it", () => {
    expect(crab(0, 10, currentVector(0, 2))?.groundKnots).toBeCloseTo(12, 9);
    expect(crab(0, 10, currentVector(180, 2))?.groundKnots).toBeCloseTo(8, 9);
  });

  it("points up into a cross current so the track holds", () => {
    // Heading north at 10 kn with 2 kn setting east: steer west of north by asin(0.2).
    const made = crab(0, 10, currentVector(90, 2));
    const expected = (Math.asin(0.2) * 180) / Math.PI;
    expect(made?.headingDeg).toBeCloseTo(360 - expected, 6);
    expect(made?.groundKnots).toBeCloseTo(Math.sqrt(96), 6);
    // The water track plus the current is the ground track: due north.
    const water = currentVector(made!.headingDeg, 10);
    expect(water.eastKn + 2).toBeCloseTo(0, 9);
  });

  it("gives up when the current is too much for the boat", () => {
    expect(crab(0, 2, currentVector(90, 3))).toBeNull();
    expect(crab(0, 2, currentVector(180, 2.5))).toBeNull();
  });
});

describe("waterKnots", () => {
  it("takes the current out of the speed over ground", () => {
    // 12 kn north over the ground with 2 kn setting north is 10 kn through the water.
    expect(waterKnots(12, 0, currentVector(0, 2))).toBeCloseTo(10, 9);
    expect(waterKnots(12, null, currentVector(0, 2))).toBe(12);
    expect(waterKnots(12, 0, null)).toBe(12);
  });
});

describe("currentAt", () => {
  it("reads the nearest hour within 90 minutes, and nothing beyond", () => {
    const route = steady([
      { at: 0, heading: 0, knots: 1 },
      { at: 1, heading: 180, knots: 1 },
    ]);
    expect(currentHeading(currentAt(route, 1, T0 + 20 * 60_000)!.current)).toBeCloseTo(0, 6);
    expect(currentHeading(currentAt(route, 1, T0 + 40 * 60_000)!.current)).toBeCloseTo(180, 6);
    expect(currentAt(route, 1, T0 + 3 * HOUR)).toBeNull();
  });

  it("has no current where no source covers the sample", () => {
    const route: RouteCurrent = { ...steady([{ at: 0, heading: 0, knots: 1 }]), samples: [0, -1, 0] };
    expect(currentAt(route, 0.25, T0)).toBeNull();
    expect(currentAt(route, 0.5, T0)).not.toBeNull();
  });
});

describe("routeTime", () => {
  it("is plain distance over speed with no current", () => {
    const time = routeTime(northRoute(5), 0, null, 10, T0);
    expect(time.minutes).toBeCloseTo(30, 1);
    expect(time.coveredKm).toBe(0);
  });

  it("is quicker with a following current and slower against one", () => {
    const behind = routeTime(northRoute(5), 0, steady([{ at: 0, heading: 0, knots: 2 }]), 10, T0);
    const against = routeTime(northRoute(5), 0, steady([{ at: 0, heading: 180, knots: 2 }]), 10, T0);
    expect(behind.minutes).toBeCloseTo(25, 1);
    expect(against.minutes).toBeCloseTo(37.5, 1);
    expect(behind.coveredKm).toBeCloseTo(5 * 1.852, 1);
  });

  it("counts only the route still ahead", () => {
    const time = routeTime(northRoute(5), 1.852 * 4, null, 10, T0);
    expect(time.minutes).toBeCloseTo(6, 1);
  });

  it("reads each stretch's current at the time the boat gets there", () => {
    // Slack for the first hour, then 2 kn against: 5 nm at 5 kn in the first hour, then 5 nm at 3 kn.
    const route = steady(
      [
        { at: 0, heading: 0, knots: 0 },
        { at: 1, heading: 0, knots: 0 },
        { at: 2, heading: 180, knots: 2 },
        { at: 3, heading: 180, knots: 2 },
        { at: 4, heading: 180, knots: 2 },
      ],
      100,
    );
    const time = routeTime(northRoute(10), 0, route, 5, T0);
    // The current turns where hours 1 and 2 meet, at 1.5 h: 7.5 nm done, 2.5 nm left at 3 kn.
    expect(time.minutes).toBeCloseTo(90 + 50, 0);
  });

  it("is null when the current ahead beats the boat, and names very strong sites once", () => {
    const route = steady([{ at: 0, heading: 180, knots: 2.5, strength: "too_strong" }]);
    const time = routeTime(northRoute(2), 0, route, 2, T0);
    expect(time.minutes).toBeNull();
    expect(time.veryStrong).toEqual([{ name: "Test Kandu", siteId: "pass", timeMs: T0 }]);
  });
});
