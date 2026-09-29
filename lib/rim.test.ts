import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { inwardBearingDeg, resolveBearing } from "./bearing";
import { pointInRing, rimForAtoll, rimInwardBearing, type RimRing } from "./rim";
import type { Catalog, Site } from "./types";

// A 0.2 degree square centered on the origin, closed.
const SQUARE: RimRing = [
  [-0.1, -0.1],
  [-0.1, 0.1],
  [0.1, 0.1],
  [0.1, -0.1],
  [-0.1, -0.1],
];

function pin(lat: number, lon: number, extra: Partial<Site> = {}): Site {
  return { id: "pin", name: "pin", atollId: "square", lat, lon, sourceUrl: "https://example.com/seed", ...extra };
}

describe("rimInwardBearing", () => {
  it("points a west-rim pin east and an east-rim pin west", () => {
    expect(rimInwardBearing(pin(0, -0.099), SQUARE)).toBeCloseTo(90, 0);
    expect(rimInwardBearing(pin(0, 0.099), SQUARE)).toBeCloseTo(270, 0);
  });

  it("points a north-rim pin south and a south-rim pin north", () => {
    expect(rimInwardBearing(pin(0.099, 0), SQUARE)).toBeCloseTo(180, 0);
    expect(rimInwardBearing(pin(-0.099, 0), SQUARE)).toBeCloseTo(0, 0);
  });

  it("is the same on a reversed ring", () => {
    const reversed = [...SQUARE].reverse();
    expect(rimInwardBearing(pin(0, -0.099), reversed)).toBeCloseTo(90, 0);
  });

  it("returns null for a pin far from the rim", () => {
    expect(rimInwardBearing(pin(0, 0), SQUARE)).toBeNull();
  });
});

describe("resolveBearing with a rim", () => {
  const outside = { lat: 0, lon: 5 };

  it("prefers an override, then the rim, then the heuristic", () => {
    const onRim = pin(0, -0.099);
    expect(resolveBearing({ ...onRim, inwardBearingDeg: 12 }, [onRim], outside, SQUARE)).toEqual({
      deg: 12,
      source: "override",
    });
    const derived = resolveBearing(onRim, [onRim], outside, SQUARE);
    expect(derived.source).toBe("rim-derived");
    expect(derived.deg).toBeCloseTo(90, 0);
    const inland = pin(0, 0);
    expect(resolveBearing(inland, [inland], outside, SQUARE).source).toBe("fallback");
  });

  it("keeps the heuristic when no rim is given", () => {
    const onRim = pin(0, -0.099);
    expect(resolveBearing(onRim, [onRim], outside).source).toBe("fallback");
  });

  it("does not depend on which other sites are in the atoll", () => {
    const site = pin(0, -0.099);
    const alone = inwardBearingDeg(site, [site], outside, SQUARE);
    const crowded = inwardBearingDeg(site, [site, pin(0.05, 0.05, { id: "a" }), pin(-0.05, 0.05, { id: "b" })], outside, SQUARE);
    expect(crowded).toBeCloseTo(alone, 9);
  });
});

// The OSM outline is a thin spike at Vaavu's east tip, so no heading from this pin stays inside it.
const THIN_OUTLINE_SITES = new Set(["fotteyo-kandu"]);

describe("seeded catalog bearings", () => {
  const catalog = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "data", "sites.json"), "utf8"),
  ) as Catalog;

  it("has a stored rim for every atoll", () => {
    for (const atoll of catalog.atolls) {
      expect(rimForAtoll(atoll), atoll.id).not.toBeNull();
    }
  });

  it("points every seeded site into its atoll, one km along the inward bearing", () => {
    for (const site of catalog.sites) {
      if (THIN_OUTLINE_SITES.has(site.id)) continue;
      const atoll = catalog.atolls.find((item) => item.id === site.atollId)!;
      const rim = rimForAtoll(atoll)!;
      const { deg } = resolveBearing(site, catalog.sites, { lat: atoll.oceanLat, lon: atoll.oceanLon }, rim);
      const radians = (deg * Math.PI) / 180;
      const lat = site.lat + (Math.cos(radians) * 1) / 110.57;
      const lon = site.lon + (Math.sin(radians) * 1) / (111.32 * Math.cos((site.lat * Math.PI) / 180));
      expect(pointInRing(lat, lon, rim), `${site.id} at ${deg.toFixed(0)} deg`).toBe(true);
    }
  });
});
