import { describe, expect, it } from "vitest";
import { seaBand, seaStateHours, type OffshoreSide } from "./sea-state";
import { STEP_DEG, type SiteExposure } from "./wave-exposure";
import type { HourForecast } from "./types";
import type { WaveHour } from "./waves";

const FULL: SiteExposure = { swell: Array(360 / STEP_DEG).fill(1), wind: Array(360 / STEP_DEG).fill(1) };
/** Open to the east (from 45 to 135), sheltered to a tenth everywhere else. */
const EAST_ONLY: SiteExposure = {
  swell: Array.from({ length: 360 / STEP_DEG }, (_, index) => (index * STEP_DEG >= 45 && index * STEP_DEG <= 135 ? 1 : 0.1)),
  wind: Array.from({ length: 360 / STEP_DEG }, (_, index) => (index * STEP_DEG >= 45 && index * STEP_DEG <= 135 ? 1 : 0.1)),
};

function wave(time: string, swellM: number, fromDeg: number, windM = 0, windFromDeg = fromDeg): WaveHour {
  return {
    time,
    swell: { heightM: swellM, fromDeg, periodS: 10 },
    secondarySwell: null,
    windWave: { heightM: windM, fromDeg: windFromDeg, periodS: 4 },
  };
}

function hour(time: string, direction: HourForecast["direction"], strength: HourForecast["strength"]): HourForecast {
  return { time, direction, strength, confidence: "medium", levelM: 0 };
}

describe("seaBand", () => {
  it("bands the felt height", () => {
    expect(seaBand(0.3)).toBe("calm");
    expect(seaBand(0.7)).toBe("moderate");
    expect(seaBand(1.2)).toBe("choppy");
    expect(seaBand(1.8)).toBe("rough");
  });
});

describe("seaStateHours", () => {
  it("takes each sea from the offshore side it comes from", () => {
    // East side sees 1.6 m from the east; the west side, in the atoll's lee, a damped 0.6 m from the same way.
    const sides: OffshoreSide[] = [
      { sideDeg: 90, hours: [wave("2026-10-13T08:00", 1.6, 90)] },
      { sideDeg: 270, hours: [wave("2026-10-13T08:00", 0.6, 95)] },
    ];
    const [sea] = seaStateHours({ sides, exposure: FULL });
    expect(sea.swell?.heightM).toBe(1.6);
    expect(sea.band).toBe("rough");
  });

  it("cuts the swell a sheltered site gets", () => {
    const sides: OffshoreSide[] = [{ sideDeg: 270, hours: [wave("2026-10-13T08:00", 2, 270)] }];
    const [sea] = seaStateHours({ sides, exposure: EAST_ONLY });
    expect(sea.swell?.heightM).toBeCloseTo(0.2, 5);
    expect(sea.band).toBe("calm");
  });

  it("counts wind chop harder than swell of the same height", () => {
    const swellOnly = seaStateHours({ sides: [{ sideDeg: 90, hours: [wave("t", 0.8, 90)] }], exposure: FULL })[0];
    const chopOnly = seaStateHours({
      sides: [{ sideDeg: 90, hours: [{ time: "t", swell: null, secondarySwell: null, windWave: { heightM: 0.8, fromDeg: 90, periodS: 4 } }] }],
      exposure: FULL,
    })[0];
    expect(swellOnly.band).toBe("moderate");
    expect(chopOnly.band).toBe("choppy");
  });

  it("flags swell running in against a strong outgoing current at a channel", () => {
    const time = "2026-10-13T08:00";
    // The channel runs in toward the west (270), so swell from the east comes in through it.
    const base = { sides: [{ sideDeg: 90, hours: [wave(time, 1.2, 90)] }], exposure: FULL, route: "channel" as const, inwardBearingDeg: 270 };
    expect(seaStateHours({ ...base, current: [hour(time, "outgoing", "strong")] })[0].againstCurrent).toBe(true);
    expect(seaStateHours({ ...base, current: [hour(time, "incoming", "strong")] })[0].againstCurrent).toBe(false);
    expect(seaStateHours({ ...base, current: [hour(time, "outgoing", "mild")] })[0].againstCurrent).toBe(false);
    expect(seaStateHours({ ...base, route: "along-reef", current: [hour(time, "outgoing", "strong")] })[0].againstCurrent).toBe(false);
    expect(seaStateHours({ ...base, inwardBearingDeg: 90, current: [hour(time, "outgoing", "strong")] })[0].againstCurrent).toBe(false);
  });
});

describe("seaStateHours upstream side", () => {
  it("does not take a sea from a side in the atoll's lee", () => {
    // Only the west side loaded while an east swell runs: its damped sample is not used for the east swell.
    const sides: OffshoreSide[] = [{ sideDeg: 270, hours: [wave("2026-10-13T08:00", 0.5, 90)] }];
    expect(seaStateHours({ sides, exposure: FULL })).toEqual([]);
  });
});
