import { describe, expect, it } from "vitest";
import { DRIFT_SMOOTHING_MAX_KM, DRIFT_SMOOTHING_SIGMA_KM, driftWeight, smoothedDriftHours } from "./drift-smoothing";
import type { MarineHour } from "./types";

const hour = (time: string, speed: number | null, direction: number | null, level = 0.1): MarineHour => ({
  time,
  seaLevelM: level,
  currentVelocityMs: speed,
  currentDirectionDeg: direction,
});

const here = { lat: 4.5, lon: 73.7 };
/** About 0.9 km north of `here`. */
const near = { lat: 4.508, lon: 73.7 };
/** About 11 km north: past the cut-off. */
const far = { lat: 4.6, lon: 73.7 };

describe("driftWeight", () => {
  it("is 1 at the same point, falls with distance and is 0 past the cut-off", () => {
    expect(driftWeight(0)).toBe(1);
    expect(driftWeight(1)).toBeGreaterThan(driftWeight(3));
    expect(driftWeight(DRIFT_SMOOTHING_MAX_KM + 0.1)).toBe(0);
    expect(driftWeight(Number.NaN)).toBe(0);
  });

  it("is a Gaussian with sigma 3 km", () => {
    expect(DRIFT_SMOOTHING_SIGMA_KM).toBe(3);
    expect(driftWeight(3)).toBeCloseTo(Math.exp(-0.5), 12);
    expect(driftWeight(6)).toBeCloseTo(Math.exp(-2), 12);
    expect(driftWeight(1)).toBeCloseTo(Math.exp(-1 / 18), 12);
  });
});

describe("smoothedDriftHours", () => {
  it("brings two close sites in different ocean cells to nearly the same drift", () => {
    const a = { point: here, hours: [hour("2026-11-20T00:00", 0.3, 180)] };
    const b = { point: near, hours: [hour("2026-11-20T00:00", 0, 0)] };
    const sa = smoothedDriftHours(a, [b])[0];
    const sb = smoothedDriftHours(b, [a])[0];
    expect(Math.abs(sa.currentVelocityMs! - sb.currentVelocityMs!)).toBeLessThan(0.01);
    expect(sa.currentVelocityMs!).toBeGreaterThan(0.14);
    expect(sa.currentVelocityMs!).toBeLessThan(0.16);
    expect(sb.currentVelocityMs!).toBeGreaterThan(0.14);
    expect(sa.currentDirectionDeg!).toBeCloseTo(180, 5);
  });

  it("averages as vectors, so opposite currents of equal weight cancel", () => {
    const a = { point: here, hours: [hour("t", 0.2, 90)] };
    const b = { point: here, hours: [hour("t", 0.2, 270)] };
    expect(smoothedDriftHours(a, [b])[0].currentVelocityMs).toBeCloseTo(0, 10);
  });

  it("keeps a lone site's own hours, and its sea level always", () => {
    const own = { point: here, hours: [hour("t", 0.3, 45, 0.42)] };
    expect(smoothedDriftHours(own, [{ point: far, hours: [hour("t", 1, 225)] }])).toEqual(own.hours);
    const shared = smoothedDriftHours(own, [{ point: near, hours: [hour("t", 0.1, 45, -0.3)] }])[0];
    expect(shared.seaLevelM).toBe(0.42);
  });

  it("changes only the current: every hour keeps its time and sea level, so the tide and head are the site's own", () => {
    const own = { point: here, hours: [0, 1, 2, 3].map((i) => hour(`t${i}`, 0.1 * i, 30 * i, 0.2 * i - 0.3)) };
    const other = { point: near, hours: [0, 1, 2, 3].map((i) => hour(`t${i}`, 0.4, 200, 9)) };
    const out = smoothedDriftHours(own, [other]);
    expect(out.map((h) => [h.time, h.seaLevelM])).toEqual(own.hours.map((h) => [h.time, h.seaLevelM]));
    expect(out.some((h, i) => h.currentVelocityMs !== own.hours[i].currentVelocityMs)).toBe(true);
  });

  it("skips a neighbour's missing hour or current, and leaves an hour with no current of its own alone", () => {
    const own = { point: here, hours: [hour("t1", 0.3, 0), hour("t2", null, null)] };
    const other = { point: near, hours: [hour("t2", 0.5, 0), hour("t3", 0.5, 0)] };
    const out = smoothedDriftHours(own, [other]);
    expect(out[0].currentVelocityMs).toBeCloseTo(0.3, 10);
    expect(out[1].currentVelocityMs).toBeNull();
  });
});
