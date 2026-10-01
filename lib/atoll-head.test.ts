import { describe, expect, it } from "vitest";
import { MIN_RING_POINTS, RING_POINTS, ringLevelFromSeries, ringPoints } from "./atoll-ring";
import { ATOLL_HEAD_TAU_HOURS, forecastHours, headWindowAt } from "./forecast";
import { pointInRing, rimEdgeKm, type RimRing } from "./rim";
import type { MarineHour, RingLevel } from "./types";

// A square atoll about 22 km across: rim at 3.9 and 4.1, 73.4 and 73.6.
const RING: RimRing = [
  [3.9, 73.4],
  [3.9, 73.6],
  [4.1, 73.6],
  [4.1, 73.4],
  [3.9, 73.4],
];

function hours(level: (index: number) => number, count = 72): MarineHour[] {
  return Array.from({ length: count }, (_, index) => ({
    time: `2026-09-${String(1 + Math.floor(index / 24)).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:00`,
    seaLevelM: level(index),
    // Calm: no through-flow, so only the tide and the head drive the channel.
    currentVelocityMs: 0,
    currentDirectionDeg: 0,
  }));
}

/** A ring level at every hour of `series`, `offset` metres from that hour's residual (zero for a flat sea). */
function flatRing(series: MarineHour[], levelM: number): RingLevel[] {
  return series.map((hour) => ({ time: hour.time, levelM }));
}

describe("ringPoints", () => {
  it("spaces twelve points round the outline, each about 3 km outside it", () => {
    const points = ringPoints(RING);
    expect(points).toHaveLength(RING_POINTS);
    for (const point of points) {
      expect(pointInRing(point.lat, point.lon, RING)).toBe(false);
      expect(rimEdgeKm(point, RING)).toBeGreaterThan(2);
      expect(rimEdgeKm(point, RING)).toBeLessThan(3.5);
    }
    // Spread round the ring: points on all four sides.
    expect(points.some((point) => point.lat < 3.9)).toBe(true);
    expect(points.some((point) => point.lat > 4.1)).toBe(true);
    expect(points.some((point) => point.lon < 73.4)).toBe(true);
    expect(points.some((point) => point.lon > 73.6)).toBe(true);
  });
});

describe("ringLevelFromSeries", () => {
  const tide = (index: number) => 0.5 * Math.sin((2 * Math.PI * index) / 12.42);

  it("averages the ring points' residual levels by hour", () => {
    const series = Array.from({ length: RING_POINTS }, () => hours(tide));
    const level = ringLevelFromSeries(series);
    expect(level.length).toBeGreaterThan(24);
    // Identical points: the mean is each point's own residual, which follows the tide.
    expect(Math.max(...level.map((item) => item.levelM))).toBeGreaterThan(0.3);
  });

  it("leaves out hours with too few points", () => {
    expect(ringLevelFromSeries(Array.from({ length: MIN_RING_POINTS - 1 }, () => hours(tide)))).toEqual([]);
  });
});

describe("head across the atoll", () => {
  const flat = hours(() => 0);

  it("runs a flat-tide channel in when the ocean outside is above the lagoon, out when below", () => {
    const above = forecastHours({ hours: flat, inwardBearingDeg: 90, ringLevel: flatRing(flat, -0.05) });
    const below = forecastHours({ hours: flat, inwardBearingDeg: 90, ringLevel: flatRing(flat, 0.05) });
    expect(above.length).toBeGreaterThan(0);
    expect(above.every((hour) => hour.direction === "incoming" && hour.strength !== "slack")).toBe(true);
    expect(below.every((hour) => hour.direction === "outgoing" && hour.strength !== "slack")).toBe(true);
  });

  it("runs channels on opposite rims opposite ways when their heads mirror", () => {
    const tide = hours((index) => 0.4 * Math.sin((2 * Math.PI * index) / 12.42));
    const ring = (sign: number): RingLevel[] =>
      tide.map((hour, index) => ({ time: hour.time, levelM: sign * 0.08 * Math.cos((2 * Math.PI * index) / 12.42) }));
    const east = forecastHours({ hours: tide, inwardBearingDeg: 270, ringLevel: ring(1) });
    const west = forecastHours({ hours: tide, inwardBearingDeg: 90, ringLevel: ring(-1) });
    const westAt = new Map(west.map((hour) => [hour.time, hour.direction]));
    const opposite = east.filter((hour) => westAt.has(hour.time) && westAt.get(hour.time) !== hour.direction);
    expect(opposite.length).toBeGreaterThan(0);
  });

  it("gives today's forecast with no ring level, an empty one, or an infinite tau", () => {
    const tide = hours((index) => 0.4 * Math.sin((2 * Math.PI * index) / 12.42));
    const plain = forecastHours({ hours: tide, inwardBearingDeg: 90 });
    expect(forecastHours({ hours: tide, inwardBearingDeg: 90, ringLevel: [] })).toEqual(plain);
    const ring = flatRing(tide, 0.1);
    expect(
      forecastHours({ hours: tide, inwardBearingDeg: 90, ringLevel: ring, headTauHours: Number.POSITIVE_INFINITY }),
    ).toEqual(plain);
  });
});

describe("headWindowAt", () => {
  it("saves thirteen head values round the report hour, with the sign of the head", () => {
    const flat = hours(() => 0);
    const window = headWindowAt(flat, flat[36].time, flatRing(flat, -0.05));
    expect(window).toHaveLength(13);
    expect(window!.every((value) => value > 0)).toBe(true);
    expect(window![6]).toBeCloseTo(0.05 / ATOLL_HEAD_TAU_HOURS, 6);
  });

  it("saves nothing without a ring level", () => {
    const flat = hours(() => 0);
    expect(headWindowAt(flat, flat[36].time, undefined)).toBeNull();
  });
});
