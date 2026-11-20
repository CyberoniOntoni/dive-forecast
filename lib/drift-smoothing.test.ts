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

  it("holds a lender's 25-hour edge mean past the end of its series, so the last day stays shared", () => {
    const at = (i: number) => new Date(Date.UTC(2026, 10, 20, i)).toISOString().slice(0, 16);
    const own = { point: here, hours: Array.from({ length: 72 }, (_, i) => hour(at(i), 0.3, 180)) };
    // Fetched a day earlier: ends 24 hours before the site's series. Its tidal swing averages out at the edge.
    const other = {
      point: near,
      hours: Array.from({ length: 48 }, (_, i) => hour(at(i - 24), i % 2 === 0 ? 0.2 : 0, 0)),
    };
    const out = smoothedDriftHours(own, [other]);
    const north = (h: MarineHour) => h.currentVelocityMs! * Math.cos((h.currentDirectionDeg! * Math.PI) / 180);
    // Inside the lender's range and past its end the site's drift is shared, not its own -0.3 m/s.
    expect(north(out[10])).toBeGreaterThan(-0.3);
    expect(north(out[60])).toBeGreaterThan(-0.3);
    // Past the end it lends its last 25 hours' mean, steady from hour to hour.
    expect(out[60].currentVelocityMs).toBeCloseTo(out[70].currentVelocityMs!, 10);
  });

  it("lets a channel's pins split one weight", () => {
    const own = { point: here, hours: [hour("t", 0, 0)] };
    const lone = smoothedDriftHours(own, [{ point: here, hours: [hour("t", 0.4, 0)] }])[0];
    const split = smoothedDriftHours(own, [
      { point: here, hours: [hour("t", 0.4, 0)], share: 0.5 },
      { point: here, hours: [hour("t", 0.4, 0)], share: 0.5 },
    ])[0];
    expect(split.currentVelocityMs).toBeCloseTo(lone.currentVelocityMs!, 12);
    expect(lone.currentVelocityMs).toBeCloseTo(0.2, 12);
  });

  it("holds exactly the 25-hour mean at each end, for 48 hours and no longer", () => {
    const at = (i: number) => new Date(Date.UTC(2026, 10, 20, 0) + i * 3_600_000).toISOString().slice(0, 16);
    // The lender runs from hour 100 to 159, its northward current equal to its hour: every window has its own mean.
    const other = { point: here, hours: Array.from({ length: 60 }, (_, i) => hour(at(100 + i), 100 + i, 0)) };
    const own = { point: here, hours: Array.from({ length: 300 }, (_, i) => hour(at(i), 0, 0)) };
    const out = smoothedDriftHours(own, [other]);
    const north = (h: MarineHour) => h.currentVelocityMs! * Math.cos((h.currentDirectionDeg! * Math.PI) / 180);
    // Own weight 1 at zero current, lender weight 1: half the lender's value.
    const tail = (135 + 159) / 2; // mean of hours 135..159
    const head = (100 + 124) / 2; // mean of hours 100..124
    expect(north(out[130])).toBeCloseTo(130 / 2, 10); // inside: the hour's own value
    expect(north(out[160])).toBeCloseTo(tail / 2, 10);
    expect(north(out[159 + 48])).toBeCloseTo(tail / 2, 10);
    expect(out[159 + 49].currentVelocityMs).toBe(0);
    expect(north(out[99])).toBeCloseTo(head / 2, 10);
    expect(north(out[100 - 48])).toBeCloseTo(head / 2, 10);
    expect(out[100 - 49].currentVelocityMs).toBe(0);
  });
});
