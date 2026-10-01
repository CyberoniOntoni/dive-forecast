import { describe, expect, it } from "vitest";
import { STRAIT_BANDS_MS, straitFlow, straitHours, straitStrength } from "./forecast";
import { crossesRim, straitHeading } from "./site-type";
import { readCatalog } from "./store";
import type { MarineHour } from "./types";

const M2 = 12.42;

/** Three days: an M2 tide of the given amplitude, and a steady drift toward `driftDeg` at `driftMs`. */
function series(tideAmplitudeM: number, driftMs: number, driftDeg = 90): MarineHour[] {
  return Array.from({ length: 72 }, (_, index) => ({
    time: `2026-09-${String(1 + Math.floor(index / 24)).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:00`,
    seaLevelM: tideAmplitudeM * Math.sin((2 * Math.PI * index) / M2),
    currentVelocityMs: driftMs,
    currentDirectionDeg: driftDeg,
  }));
}

describe("straitHeading", () => {
  it("points the strait's axis east, whichever side of the strait the wall is on", () => {
    // South wall (faces north, inward bearing ~180): the reef line runs west, flipped to east.
    expect(straitHeading(180)).toBe(90);
    // North wall (faces south, inward bearing ~0): the reef line already runs east.
    expect(straitHeading(0)).toBe(90);
    expect(straitHeading(171)).toBeCloseTo(81, 6);
  });
});

describe("strait flow", () => {
  it("runs east on the rising tide and west on the falling tide when there is no drift", () => {
    const flow = straitFlow({ hours: series(0.5, 0), axisDeg: 90 });
    const rising = flow.filter((hour) => hour.slope > 0.1);
    const falling = flow.filter((hour) => hour.slope < -0.1);
    expect(rising.length).toBeGreaterThan(0);
    expect(rising.every((hour) => hour.speedMs > 0)).toBe(true);
    expect(falling.every((hour) => hour.speedMs < 0)).toBe(true);
  });

  it("lets the SW monsoon drift hold it east through a neap ebb, and the NE drift west through a flood", () => {
    const sw = straitHours({ hours: series(0.2, 0.25, 90), axisDeg: 90 });
    expect(sw.every((hour) => hour.direction === "incoming")).toBe(true);
    const ne = straitHours({ hours: series(0.2, 0.25, 270), axisDeg: 90 });
    expect(ne.every((hour) => hour.direction === "outgoing")).toBe(true);
  });

  it("rips on a spring flood with the monsoon: very strong", () => {
    const spring = straitHours({ hours: series(0.55, 0.3, 90), axisDeg: 90 });
    expect(spring.some((hour) => hour.strength === "too_strong")).toBe(true);
  });

  it("bands real speeds in m/s", () => {
    expect(straitStrength(0.1)).toBe("slack");
    expect(straitStrength(0.5)).toBe("mild");
    expect(straitStrength(1.0)).toBe("strong");
    expect(straitStrength(STRAIT_BANDS_MS.strong)).toBe("too_strong");
  });

  it("is always low confidence", () => {
    expect(straitHours({ hours: series(0.4, 0.1), axisDeg: 90 }).every((hour) => hour.confidence === "low")).toBe(true);
  });
});

describe("the Vaadhoo Kandu walls", () => {
  const catalog = readCatalog();
  const strait = catalog.sites.filter((site) => site.siteType === "strait-wall").map((site) => site.id).sort();

  it("are the seven walls the owner named, set by hand", () => {
    expect(strait).toEqual(
      ["coral-garden-3", "hans-hass-place", "lions-head", "old-shark-point", "vaadhoo-caves", "vaadhoo-housereef", "velassaru-caves"].sort(),
    );
    for (const site of catalog.sites.filter((item) => item.siteType === "strait-wall")) {
      expect(site.siteTypeSource).toBe("manual");
    }
  });

  it("do not count as channels or lagoon openings", () => {
    for (const site of catalog.sites.filter((item) => item.siteType === "strait-wall")) {
      expect(crossesRim(site, catalog.sites)).toBe(false);
    }
  });
});
