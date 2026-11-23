import { describe, expect, it } from "vitest";
import { getMaldivesMonsoonDrift } from "./seasonal";

// The climatology is only the fallback for an hour with no Open-Meteo current (resolveHourDrift), but a wrong
// fallback still moves every channel's through-flow on those hours.
const drift = (iso: string) => getMaldivesMonsoonDrift(new Date(iso));

describe("monsoon drift climatology", () => {
  it("runs east in the SW monsoon and west in the NE monsoon, strongest mid-season", () => {
    expect(drift("2026-05-01T00:00:00Z")).toEqual({ velocityMs: 0.35, directionDeg: 90 });
    // SW peaks at the middle of May–October (about 1 August): 0.35 + 0.08.
    expect(drift("2026-08-01T00:00:00Z").velocityMs).toBeCloseTo(0.43, 2);
    expect(drift("2026-08-01T00:00:00Z").directionDeg).toBe(90);
    expect(drift("2026-12-01T00:00:00Z")).toEqual({ velocityMs: 0.35, directionDeg: 270 });
    // NE peaks at the middle of December–March (mid-January to early February): 0.35 + 0.05.
    expect(drift("2027-01-30T12:00:00Z").velocityMs).toBeCloseTo(0.4, 2);
    expect(drift("2027-01-30T12:00:00Z").directionDeg).toBe(270);
    // Peaks are maxima, not minima: the edges of each season are slower.
    expect(drift("2026-10-31T00:00:00Z").velocityMs).toBeLessThan(drift("2026-08-01T00:00:00Z").velocityMs);
    expect(drift("2027-03-31T00:00:00Z").velocityMs).toBeLessThan(drift("2027-01-30T12:00:00Z").velocityMs);
  });

  it("calms and turns through south in the inter-monsoon months", () => {
    // Mid-April and mid-November: calm, heading half way round via south.
    expect(drift("2026-04-16T00:00:00Z").velocityMs).toBeCloseTo(0.05, 2);
    expect(drift("2026-04-16T00:00:00Z").directionDeg).toBeCloseTo(180, 0);
    expect(drift("2026-11-16T00:00:00Z").velocityMs).toBeCloseTo(0.05, 2);
    expect(drift("2026-11-16T00:00:00Z").directionDeg).toBeCloseTo(180, 0);
    // April turns west to east; November east to west.
    expect(drift("2026-04-08T00:00:00Z").directionDeg).toBeGreaterThan(180);
    expect(drift("2026-04-24T00:00:00Z").directionDeg).toBeLessThan(180);
    expect(drift("2026-11-08T00:00:00Z").directionDeg).toBeLessThan(180);
    expect(drift("2026-11-24T00:00:00Z").directionDeg).toBeGreaterThan(180);
  });

  it("stays bounded and has no jumps hour to hour through a leap year", () => {
    const start = Date.UTC(2024, 0, 1);
    let worstSpeedStep = 0;
    let worstHeadingStep = 0;
    let min = Infinity;
    let max = -Infinity;
    let headingsInRange = true;
    let previous = getMaldivesMonsoonDrift(new Date(start));
    for (let hour = 1; hour <= 366 * 24; hour += 1) {
      const next = getMaldivesMonsoonDrift(new Date(start + hour * 3_600_000));
      worstSpeedStep = Math.max(worstSpeedStep, Math.abs(next.velocityMs - previous.velocityMs));
      worstHeadingStep = Math.max(worstHeadingStep, Math.abs(next.directionDeg - previous.directionDeg));
      min = Math.min(min, next.velocityMs);
      max = Math.max(max, next.velocityMs);
      if (!(next.directionDeg >= 0 && next.directionDeg < 360)) headingsInRange = false;
      previous = next;
    }
    expect(headingsInRange).toBe(true);
    expect(min).toBeGreaterThanOrEqual(0.05);
    expect(max).toBeLessThanOrEqual(0.45);
    expect(worstSpeedStep).toBeLessThan(0.005);
    expect(worstHeadingStep).toBeLessThan(1.5);
  });

  it("falls back to no drift for an invalid date", () => {
    expect(getMaldivesMonsoonDrift(new Date("not a date"))).toEqual({ velocityMs: 0, directionDeg: 90 });
  });
});
