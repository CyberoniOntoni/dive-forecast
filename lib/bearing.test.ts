import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { atollForPin, inwardBearingDeg, resolveBearing, wrapDegrees } from "./bearing";
import { forecastHours } from "./forecast";
import type { Catalog, MarineHour, Site } from "./types";

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
    // Both start mild. The drift lifts the west side a band; on the east it runs against the tide, which slows
    // a flowing hour but never stops it, so mild is the floor.
    expect(westHours.every((hour) => hour.strength === "strong")).toBe(true);
    expect(eastHours.every((hour) => hour.strength === "mild")).toBe(true);
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

describe("atollForPin", () => {
  const { atolls } = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "data", "sites.json"), "utf8"),
  ) as Catalog;

  it("matches a pin on a seeded reef to its own atoll", () => {
    expect(atollForPin(4.2342, 73.534, atolls)?.id).toBe("north-male");
    expect(atollForPin(3.5996, 73.5042, atolls)?.id).toBe("vaavu");
    expect(atollForPin(5.5585, 73.4781, atolls)?.id).toBe("lhaviyani");
  });

  it("matches a pin just outside its outline", () => {
    // Miyaru Kandu sits about 26 m outside the OSM outline.
    expect(atollForPin(3.5996, 73.5042, atolls)?.id).toBe("vaavu");
  });

  it("splits North and South Ari, which share one outline, by the nearer ocean point", () => {
    expect(atollForPin(3.9994, 72.786, atolls)?.id).toBe("north-ari");
    expect(atollForPin(3.5955, 72.7189, atolls)?.id).toBe("south-ari");
  });

  it("returns null for a pin in an unseeded atoll instead of handing it to a far one", () => {
    // Baa Atoll, about 60 km north of Lhaviyani's nearest neighbor outline.
    expect(atollForPin(5.2, 72.95, atolls)).toBeNull();
    expect(atollForPin(0.5, 73.0, atolls)).toBeNull();
  });

  it("returns null with no atolls", () => {
    expect(atollForPin(4.2, 73.5, [])).toBeNull();
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
