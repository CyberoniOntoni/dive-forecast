import { describe, expect, it } from "vitest";
import { inwardBearingDeg, wrapDegrees } from "./bearing";
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

describe("wrapDegrees", () => {
  it("maps -450 into [0, 360)", () => {
    // W6: ((degrees % 360) + 360) % 360, not (degrees + 360) % 360
    const wrapped = wrapDegrees(-450);
    expect(wrapped).toBeGreaterThanOrEqual(0);
    expect(wrapped).toBeLessThan(360);
  });
});
