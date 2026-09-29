import { describe, expect, it } from "vitest";
import { inwardBearingDeg, resolveBearing, wrapDegrees } from "./bearing";
import { forecastHours } from "./forecast";
import type { MarineHour, Site } from "./types";

function seeded(id: string, lat: number, lon: number, atollId = "cross"): Site {
  return { id, name: id, atollId, lat, lon, sourceUrl: "https://example.com/seed" };
}

describe("inwardBearingDeg", () => {
  it("nudges opposite sides of one centroid in opposite ways for one regional current", () => {
    const west = seeded("west", 0, -2);
    const east = seeded("east", 0, 2);
    const mates = [
      west,
      east,
      seeded("north", 2, 0),
      seeded("south", -2, 0),
      { ...seeded("visitor", 0, 40), sourceUrl: "user" },
      seeded("elsewhere", 0, 40, "other-atoll"),
    ];

    const outside = { lat: -8, lon: -2 };
    const westBearing = inwardBearingDeg(west, mates, outside);
    const eastBearing = inwardBearingDeg(east, mates, outside);
    expect(westBearing).toBeCloseTo(90, 5);
    expect(eastBearing).toBeCloseTo(270, 5);

    const hours: MarineHour[] = Array.from({ length: 11 }, (_, index) => ({
      time: `2026-09-23T${String(index).padStart(2, "0")}:00`,
      seaLevelM: index * 0.045,
      currentVelocityMs: 0.4,
      currentDirectionDeg: 90,
    }));
    const westHours = forecastHours({ hours, inwardBearingDeg: westBearing, reports: [] });
    const eastHours = forecastHours({ hours, inwardBearingDeg: eastBearing, reports: [] });

    expect(westHours.length).toBeGreaterThan(0);
    expect(westHours.every((hour) => hour.direction === "incoming")).toBe(true);
    expect(eastHours.every((hour) => hour.direction === "incoming")).toBe(true);
    expect(westHours.every((hour) => hour.strength === "strong")).toBe(true);
    expect(eastHours.every((hour) => hour.strength === "slack")).toBe(true);
  });

  it("bears from an outside point toward the pin when that is the only seeded site", () => {
    const pin = seeded("pin", 0, 2);
    expect(inwardBearingDeg(pin, [pin], { lat: 0, lon: -2 })).toBeCloseTo(90, 5);
  });
});

describe("resolveBearing", () => {
  const outside = { lat: 0, lon: -2 };

  it("uses a measured site bearing over the heuristic", () => {
    const pin = { ...seeded("pin", 0, 2), inwardBearingDeg: 170 };
    expect(resolveBearing(pin, [pin], outside)).toEqual({ deg: 170, source: "override" });
  });

  it("wraps an out-of-range override into [0, 360)", () => {
    const pin = { ...seeded("pin", 0, 2), inwardBearingDeg: -10 };
    expect(resolveBearing(pin, [pin], outside).deg).toBeCloseTo(350, 5);
  });

  it("keeps the heuristic for a site without an override, including user-added pins", () => {
    const pin = seeded("pin", 0, 2);
    const result = resolveBearing(pin, [pin], outside);
    expect(result.source).toBe("fallback");
    expect(result.deg).toBeCloseTo(90, 5);
    const visitor = { ...seeded("visitor", 0, 2), sourceUrl: "user" };
    expect(resolveBearing(visitor, [visitor], outside).source).toBe("fallback");
  });

  it("ignores a non-finite override", () => {
    const pin = { ...seeded("pin", 0, 2), inwardBearingDeg: Number.NaN };
    expect(resolveBearing(pin, [pin], outside).source).toBe("fallback");
  });

  it("does not let a mate's override move this site's fallback centroid", () => {
    const a = seeded("a", 0, -2);
    const b = { ...seeded("b", 0, 2), inwardBearingDeg: 10 };
    const c = seeded("c", 2, 0);
    expect(inwardBearingDeg(a, [a, b, c], outside)).toBeCloseTo(
      inwardBearingDeg(a, [a, { ...b, inwardBearingDeg: undefined }, c], outside),
      9,
    );
  });
});

describe("wrapDegrees", () => {
  it("maps -450 into [0, 360)", () => {
    // W6: ((degrees % 360) + 360) % 360, not (degrees + 360) % 360
    const wrapped = wrapDegrees(-450);
    expect(wrapped).toBeGreaterThanOrEqual(0);
    expect(wrapped).toBeLessThan(360);
  });
});
