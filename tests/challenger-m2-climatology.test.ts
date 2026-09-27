import { describe, expect, it } from "vitest";
import {
  forecastHours,
  getMaldivesMonsoonDrift,
  monsoonInwardFlux,
  resolveHourDrift,
  type OceanDrift,
} from "../lib/forecast";
import type { MarineHour } from "../lib/types";

// Helper to format ISO wall time without seconds (YYYY-MM-DDTHH:MM)
function toWallHour(d: Date): string {
  return d.toISOString().slice(0, 16);
}

// Generate synthetic semi-diurnal tidal series (12h period) with configurable date start
function makeSyntheticSeries(
  startDate: Date,
  hoursCount = 72,
  options: {
    amplitude?: number;
    mean?: number;
    velocityMs?: number | null;
    directionDeg?: number | null;
  } = {},
): MarineHour[] {
  const { amplitude = 0.35, mean = 0.6, velocityMs = null, directionDeg = null } = options;
  const startMs = startDate.getTime();

  return Array.from({ length: hoursCount }, (_, i) => {
    const timeMs = startMs + i * 3600 * 1000;
    const d = new Date(timeMs);
    return {
      time: toWallHour(d),
      seaLevelM: mean + amplitude * Math.sin((2 * Math.PI * i) / 12),
      currentVelocityMs: velocityMs,
      currentDirectionDeg: directionDeg,
    };
  });
}

describe("Milestone 2 Adversarial Climatology & Mathematical Stability Challenge", () => {
  // ── 1. Comprehensive 365-Day & 366-Day Sweeps ─────────────────────────────
  describe("1. Full Year Hourly Sweeps & Mathematical Bounds", () => {
    it("sweeps all 8,760 hours of a standard non-leap year (2025): no NaN, positive velocity, bounded heading", () => {
      const year = 2025;
      const startMs = Date.UTC(year, 0, 1, 0, 0, 0);
      const totalHours = 365 * 24;

      let prevVelocity: number | null = null;
      let prevDirection: number | null = null;

      for (let h = 0; h < totalHours; h++) {
        const date = new Date(startMs + h * 3600 * 1000);
        const drift = getMaldivesMonsoonDrift(date);

        // Mathematical invariants
        expect(Number.isFinite(drift.velocityMs), `velocityMs at ${date.toISOString()} must be finite`).toBe(true);
        expect(Number.isNaN(drift.velocityMs), `velocityMs at ${date.toISOString()} must not be NaN`).toBe(false);
        expect(drift.velocityMs, `velocityMs at ${date.toISOString()} must be strictly positive`).toBeGreaterThanOrEqual(0.05);
        expect(drift.velocityMs, `velocityMs at ${date.toISOString()} must not exceed physical ceiling`).toBeLessThanOrEqual(0.45);

        expect(Number.isFinite(drift.directionDeg), `directionDeg at ${date.toISOString()} must be finite`).toBe(true);
        expect(Number.isNaN(drift.directionDeg), `directionDeg at ${date.toISOString()} must not be NaN`).toBe(false);
        expect(drift.directionDeg, `directionDeg at ${date.toISOString()} must be in [0, 360)`).toBeGreaterThanOrEqual(0);
        expect(drift.directionDeg, `directionDeg at ${date.toISOString()} must be in [0, 360)`).toBeLessThan(360);

        // Continuity check: velocity change per hour must be small (< 0.005 m/s per hour)
        if (prevVelocity !== null) {
          const deltaV = Math.abs(drift.velocityMs - prevVelocity);
          expect(deltaV, `Hourly velocity jump at ${date.toISOString()} must be smooth`).toBeLessThan(0.005);
        }

        // Continuity check: direction change per hour during transitions must be smooth (< 1.5 deg per hour)
        if (prevDirection !== null) {
          const deltaDir = Math.abs(drift.directionDeg - prevDirection);
          expect(deltaDir, `Hourly direction change at ${date.toISOString()} must be smooth`).toBeLessThan(1.5);
        }

        prevVelocity = drift.velocityMs;
        prevDirection = drift.directionDeg;
      }
    });

    it("sweeps all 8,784 hours of a leap year (2024): handles Feb 29 cleanly without discontinuity", () => {
      const year = 2024;
      const startMs = Date.UTC(year, 0, 1, 0, 0, 0);
      const totalHours = 366 * 24;

      let feb29SampleCount = 0;
      let prevVelocity: number | null = null;

      for (let h = 0; h < totalHours; h++) {
        const date = new Date(startMs + h * 3600 * 1000);
        const drift = getMaldivesMonsoonDrift(date);

        if (date.getUTCMonth() === 1 && date.getUTCDate() === 29) {
          feb29SampleCount++;
          expect(drift.directionDeg).toBe(270);
          expect(drift.velocityMs).toBeGreaterThan(0.35);
        }

        expect(Number.isFinite(drift.velocityMs)).toBe(true);
        expect(drift.velocityMs).toBeGreaterThanOrEqual(0.05);
        expect(drift.velocityMs).toBeLessThanOrEqual(0.45);
        expect(drift.directionDeg).toBeGreaterThanOrEqual(0);
        expect(drift.directionDeg).toBeLessThan(360);

        if (prevVelocity !== null) {
          const deltaV = Math.abs(drift.velocityMs - prevVelocity);
          expect(deltaV, `Hourly leap year velocity jump at ${date.toISOString()} must be smooth`).toBeLessThan(0.005);
        }

        prevVelocity = drift.velocityMs;
      }

      // Exactly 24 hours tested on Feb 29
      expect(feb29SampleCount).toBe(24);
    });

    it("evaluates correctly across centuries: 2000 (leap century), 2024, 2026, 2030, 2100 (non-leap century)", () => {
      const years = [2000, 2024, 2026, 2030, 2100];
      for (const y of years) {
        // Peak SW (July 15)
        const sw = getMaldivesMonsoonDrift(new Date(Date.UTC(y, 6, 15, 12, 0, 0)));
        expect(sw.directionDeg).toBe(90);
        expect(sw.velocityMs).toBeGreaterThan(0.40);

        // Peak NE (January 15)
        const ne = getMaldivesMonsoonDrift(new Date(Date.UTC(y, 0, 15, 12, 0, 0)));
        expect(ne.directionDeg).toBe(270);
        expect(ne.velocityMs).toBeGreaterThan(0.38);

        // Mid-April calm transition (April 16 00:00:00 is exact tau = 15/30 = 0.5)
        const apr = getMaldivesMonsoonDrift(new Date(Date.UTC(y, 3, 16, 0, 0, 0)));
        expect(apr.directionDeg).toBeCloseTo(180, 5);
        expect(apr.velocityMs).toBeCloseTo(0.05, 5);

        // Mid-November calm transition (Nov 16 00:00:00 is exact tau = 15/30 = 0.5)
        const nov = getMaldivesMonsoonDrift(new Date(Date.UTC(y, 10, 16, 0, 0, 0)));
        expect(nov.directionDeg).toBeCloseTo(180, 5);
        expect(nov.velocityMs).toBeCloseTo(0.05, 5);
      }
    });
  });

  // ── 2. Millisecond Boundary Continuity ────────────────────────────────────
  describe("2. Millisecond Boundary Transitions & C^1 Smoothness", () => {
    const transitions = [
      {
        name: "Boundary 1: March 31 23:59:59.999 -> April 1 00:00:00.000 (NE Decay -> Spring Transition)",
        before: new Date("2026-03-31T23:59:59.999Z"),
        after: new Date("2026-04-01T00:00:00.000Z"),
        expectedHeadingBefore: 270,
        expectedHeadingAfter: 270,
        expectedVelocity: 0.35,
      },
      {
        name: "Boundary 2: April 30 23:59:59.999 -> May 1 00:00:00.000 (Spring Transition -> SW Onset)",
        before: new Date("2026-04-30T23:59:59.999Z"),
        after: new Date("2026-05-01T00:00:00.000Z"),
        expectedHeadingBefore: 90,
        expectedHeadingAfter: 90,
        expectedVelocity: 0.35,
      },
      {
        name: "Boundary 3: October 31 23:59:59.999 -> November 1 00:00:00.000 (SW Decay -> Autumn Transition)",
        before: new Date("2026-10-31T23:59:59.999Z"),
        after: new Date("2026-11-01T00:00:00.000Z"),
        expectedHeadingBefore: 90,
        expectedHeadingAfter: 90,
        expectedVelocity: 0.35,
      },
      {
        name: "Boundary 4: November 30 23:59:59.999 -> December 1 00:00:00.000 (Autumn Transition -> NE Onset)",
        before: new Date("2026-11-30T23:59:59.999Z"),
        after: new Date("2026-12-01T00:00:00.000Z"),
        expectedHeadingBefore: 270,
        expectedHeadingAfter: 270,
        expectedVelocity: 0.35,
      },
      {
        name: "Boundary 5: December 31 23:59:59.999 -> January 1 00:00:00.000 (NE Year-End Rollover)",
        before: new Date("2026-12-31T23:59:59.999Z"),
        after: new Date("2027-01-01T00:00:00.000Z"),
        expectedHeadingBefore: 270,
        expectedHeadingAfter: 270,
        expectedVelocity: null, // Continuously evolving in NE regime
      },
      {
        name: "Boundary 6 (Leap Year): Feb 28 23:59:59.999 -> Feb 29 00:00:00.000 (Leap Day Entry)",
        before: new Date("2024-02-28T23:59:59.999Z"),
        after: new Date("2024-02-29T00:00:00.000Z"),
        expectedHeadingBefore: 270,
        expectedHeadingAfter: 270,
        expectedVelocity: null,
      },
      {
        name: "Boundary 7 (Leap Year): Feb 29 23:59:59.999 -> March 1 00:00:00.000 (Leap Day Exit)",
        before: new Date("2024-02-29T23:59:59.999Z"),
        after: new Date("2024-03-01T00:00:00.000Z"),
        expectedHeadingBefore: 270,
        expectedHeadingAfter: 270,
        expectedVelocity: null,
      },
    ];

    for (const t of transitions) {
      it(t.name, () => {
        const driftBefore = getMaldivesMonsoonDrift(t.before);
        const driftAfter = getMaldivesMonsoonDrift(t.after);

        // Finiteness
        expect(Number.isFinite(driftBefore.velocityMs)).toBe(true);
        expect(Number.isFinite(driftAfter.velocityMs)).toBe(true);
        expect(Number.isFinite(driftBefore.directionDeg)).toBe(true);
        expect(Number.isFinite(driftAfter.directionDeg)).toBe(true);

        // Direction continuity across 1 ms
        expect(driftBefore.directionDeg).toBeCloseTo(t.expectedHeadingBefore, 1);
        expect(driftAfter.directionDeg).toBeCloseTo(t.expectedHeadingAfter, 1);
        const deltaDir = Math.abs(driftAfter.directionDeg - driftBefore.directionDeg);
        expect(deltaDir, `Direction discontinuity across 1 ms must be < 0.001 deg`).toBeLessThan(0.001);

        // Velocity continuity across 1 ms: deltaV must be essentially zero (< 1e-5 m/s)
        const deltaV = Math.abs(driftAfter.velocityMs - driftBefore.velocityMs);
        expect(deltaV, `Velocity discontinuity across 1 ms must be < 1e-5 m/s`).toBeLessThan(1e-5);

        if (t.expectedVelocity !== null) {
          expect(driftBefore.velocityMs).toBeCloseTo(t.expectedVelocity, 3);
          expect(driftAfter.velocityMs).toBeCloseTo(t.expectedVelocity, 3);
        }
      });
    }

    it("verifies C^0 and smooth gradient across 120-second window centered at March 31 / April 1 boundary", () => {
      const boundaryMs = Date.UTC(2026, 3, 1, 0, 0, 0); // April 1 00:00:00 UTC
      let maxStepV = 0;
      let maxStepDir = 0;

      for (let s = -60; s < 60; s++) {
        const t1 = new Date(boundaryMs + s * 1000);
        const t2 = new Date(boundaryMs + (s + 1) * 1000);
        const d1 = getMaldivesMonsoonDrift(t1);
        const d2 = getMaldivesMonsoonDrift(t2);

        const dV = Math.abs(d2.velocityMs - d1.velocityMs);
        const dDir = Math.abs(d2.directionDeg - d1.directionDeg);

        if (dV > maxStepV) maxStepV = dV;
        if (dDir > maxStepDir) maxStepDir = dDir;
      }

      // Max per-second jump must be tiny
      expect(maxStepV).toBeLessThan(1e-5);
      expect(maxStepDir).toBeLessThan(1e-3);
    });

    it("sweeps 48-hour windows minute-by-minute (2,880 samples each) across all 5 key transitions", () => {
      const boundaries = [
        Date.UTC(2026, 3, 1, 0, 0, 0), // Mar 31 -> Apr 1
        Date.UTC(2026, 4, 1, 0, 0, 0), // Apr 30 -> May 1
        Date.UTC(2026, 10, 1, 0, 0, 0), // Oct 31 -> Nov 1
        Date.UTC(2026, 11, 1, 0, 0, 0), // Nov 30 -> Dec 1
        Date.UTC(2027, 0, 1, 0, 0, 0), // Dec 31 -> Jan 1
      ];

      for (const bMs of boundaries) {
        let prevV: number | null = null;
        let prevDir: number | null = null;
        // 24h before to 24h after at 1-minute steps (2,880 minutes)
        for (let m = -1440; m <= 1440; m++) {
          const date = new Date(bMs + m * 60 * 1000);
          const drift = getMaldivesMonsoonDrift(date);

          expect(Number.isFinite(drift.velocityMs)).toBe(true);
          expect(drift.velocityMs).toBeGreaterThanOrEqual(0.05);
          expect(drift.velocityMs).toBeLessThanOrEqual(0.45);
          expect(Number.isFinite(drift.directionDeg)).toBe(true);
          expect(drift.directionDeg).toBeGreaterThanOrEqual(0);
          expect(drift.directionDeg).toBeLessThan(360);

          if (prevV !== null) {
            const dV = Math.abs(drift.velocityMs - prevV);
            // Minute-to-minute velocity change must be < 0.0001 m/s
            expect(dV, `Minute jump in velocity at ${date.toISOString()}`).toBeLessThan(0.0001);
          }

          if (prevDir !== null) {
            const dDir = Math.abs(drift.directionDeg - prevDir);
            // Minute-to-minute direction change must be < 0.05 deg
            expect(dDir, `Minute jump in direction at ${date.toISOString()}`).toBeLessThan(0.05);
          }

          prevV = drift.velocityMs;
          prevDir = drift.directionDeg;
        }
      }
    });

    it("proves C^1 angular velocity continuity: d(theta)/dt -> 0 at transition start and end", () => {
      // April transition start (April 1 00:00:00)
      const aprStart = Date.UTC(2026, 3, 1, 0, 0, 0);
      // Direction rate in deg/second at t = 10 seconds into April
      const d1 = getMaldivesMonsoonDrift(new Date(aprStart));
      const d2 = getMaldivesMonsoonDrift(new Date(aprStart + 10_000));
      const rateAprStart = Math.abs(d2.directionDeg - d1.directionDeg) / 10;
      // Heading derivative must be nearly 0 (< 1e-5 deg/s) right at onset due to smoothstep
      expect(rateAprStart).toBeLessThan(1e-5);

      // April transition end (April 30 23:59:50 -> May 1 00:00:00)
      const mayStart = Date.UTC(2026, 4, 1, 0, 0, 0);
      const d3 = getMaldivesMonsoonDrift(new Date(mayStart - 10_000));
      const d4 = getMaldivesMonsoonDrift(new Date(mayStart));
      const rateAprEnd = Math.abs(d4.directionDeg - d3.directionDeg) / 10;
      expect(rateAprEnd).toBeLessThan(1e-5);

      // November transition start (November 1 00:00:00)
      const novStart = Date.UTC(2026, 10, 1, 0, 0, 0);
      const d5 = getMaldivesMonsoonDrift(new Date(novStart));
      const d6 = getMaldivesMonsoonDrift(new Date(novStart + 10_000));
      const rateNovStart = Math.abs(d6.directionDeg - d5.directionDeg) / 10;
      expect(rateNovStart).toBeLessThan(1e-5);

      // November transition end (December 1 00:00:00)
      const decStart = Date.UTC(2026, 11, 1, 0, 0, 0);
      const d7 = getMaldivesMonsoonDrift(new Date(decStart - 10_000));
      const d8 = getMaldivesMonsoonDrift(new Date(decStart));
      const rateNovEnd = Math.abs(d8.directionDeg - d7.directionDeg) / 10;
      expect(rateNovEnd).toBeLessThan(1e-5);
    });
  });

  // ── 3. Climatological Physics & Regimes ────────────────────────────────────
  describe("3. Physical Climatology & Regime Trajectories", () => {
    it("Regime 2 (SW Monsoon May-Oct): invariant heading 90° and smooth parabolic velocity curve", () => {
      const samples = [
        { date: new Date("2026-05-01T12:00:00Z"), minV: 0.35, maxV: 0.36 },
        { date: new Date("2026-06-15T12:00:00Z"), minV: 0.40, maxV: 0.43 },
        { date: new Date("2026-07-15T12:00:00Z"), minV: 0.42, maxV: 0.44 }, // Peak
        { date: new Date("2026-08-15T12:00:00Z"), minV: 0.41, maxV: 0.44 },
        { date: new Date("2026-10-31T12:00:00Z"), minV: 0.35, maxV: 0.36 },
      ];

      for (const s of samples) {
        const drift = getMaldivesMonsoonDrift(s.date);
        expect(drift.directionDeg).toBe(90);
        expect(drift.velocityMs).toBeGreaterThanOrEqual(s.minV);
        expect(drift.velocityMs).toBeLessThanOrEqual(s.maxV);
      }
    });

    it("Regime 4 (NE Monsoon Dec-Mar): invariant heading 270° and smooth parabolic velocity curve", () => {
      const samples = [
        { date: new Date("2026-12-01T12:00:00Z"), minV: 0.35, maxV: 0.36 },
        { date: new Date("2027-01-15T12:00:00Z"), minV: 0.38, maxV: 0.41 }, // Peak
        { date: new Date("2027-02-15T12:00:00Z"), minV: 0.38, maxV: 0.41 },
        { date: new Date("2027-03-31T12:00:00Z"), minV: 0.35, maxV: 0.36 },
      ];

      for (const s of samples) {
        const drift = getMaldivesMonsoonDrift(s.date);
        expect(drift.directionDeg).toBe(270);
        expect(drift.velocityMs).toBeGreaterThanOrEqual(s.minV);
        expect(drift.velocityMs).toBeLessThanOrEqual(s.maxV);
      }
    });

    it("Regime 1 (April Transition): monotonic heading rotation 270° -> 90° through South (180°)", () => {
      const startMs = Date.UTC(2026, 3, 1, 0, 0, 0);
      const endMs = Date.UTC(2026, 4, 1, 0, 0, 0);
      const steps = 30; // Every day

      let prevDir = 270.001;

      for (let i = 0; i <= steps; i++) {
        const date = new Date(startMs + (i / steps) * (endMs - startMs));
        const drift = getMaldivesMonsoonDrift(date);

        // Heading must strictly decrease from 270 to 90
        expect(drift.directionDeg).toBeLessThanOrEqual(prevDir + 1e-10);
        expect(drift.directionDeg).toBeGreaterThanOrEqual(90);
        expect(drift.directionDeg).toBeLessThanOrEqual(270);

        prevDir = drift.directionDeg;
      }
    });

    it("Regime 3 (November Transition): monotonic heading rotation 90° -> 270° through South (180°)", () => {
      const startMs = Date.UTC(2026, 10, 1, 0, 0, 0);
      const endMs = Date.UTC(2026, 11, 1, 0, 0, 0);
      const steps = 30; // Every day

      let prevDir = 89.999;

      for (let i = 0; i <= steps; i++) {
        const date = new Date(startMs + (i / steps) * (endMs - startMs));
        const drift = getMaldivesMonsoonDrift(date);

        // Heading must strictly increase from 90 to 270
        expect(drift.directionDeg).toBeGreaterThanOrEqual(prevDir - 1e-10);
        expect(drift.directionDeg).toBeGreaterThanOrEqual(90);
        expect(drift.directionDeg).toBeLessThanOrEqual(270);

        prevDir = drift.directionDeg;
      }
    });

    it("Transitions never cross North (0°/360°), preventing wrap-around modulo jumps", () => {
      // Check every 6 hours across April and November
      for (const month of [3, 10]) {
        const startMs = Date.UTC(2026, month, 1, 0, 0, 0);
        const days = 30;
        for (let h = 0; h < days * 24; h += 6) {
          const date = new Date(startMs + h * 3600 * 1000);
          const drift = getMaldivesMonsoonDrift(date);
          // Strict Southern hemisphere routing: heading between 90° and 270°
          expect(drift.directionDeg).toBeGreaterThanOrEqual(90);
          expect(drift.directionDeg).toBeLessThanOrEqual(270);
        }
      }
    });
  });

  // ── 4. Adversarial Inputs & Degenerate Arguments ───────────────────────────
  describe("4. Adversarial Input Robustness & Fault Tolerance", () => {
    it("handles invalid Date objects without throwing and returns safe fallback", () => {
      const invalidDates = [
        new Date(NaN),
        new Date("not a valid date"),
        new Date(Infinity),
        new Date(-Infinity),
      ];

      for (const d of invalidDates) {
        const drift = getMaldivesMonsoonDrift(d);
        expect(drift).toBeDefined();
        expect(Number.isFinite(drift.velocityMs)).toBe(true);
        expect(drift.velocityMs).toBeGreaterThanOrEqual(0);
        expect(drift.directionDeg).toBeGreaterThanOrEqual(0);
        expect(drift.directionDeg).toBeLessThan(360);
      }
    });

    it("handles non-Date arguments coerced or passed from untyped JavaScript", () => {
      const untypedInputs: unknown[] = [
        "2026-07-15T12:00:00Z",
        "2026-01-15T12:00:00Z",
        1784000000000,
        undefined,
        null,
        {},
        [],
      ];

      for (const input of untypedInputs) {
        // Must not throw exception
        expect(() => {
          const drift = getMaldivesMonsoonDrift(input as unknown as Date);
          expect(Number.isFinite(drift.velocityMs)).toBe(true);
          expect(drift.velocityMs).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(drift.directionDeg)).toBe(true);
          expect(drift.directionDeg).toBeGreaterThanOrEqual(0);
          expect(drift.directionDeg).toBeLessThan(360);
        }).not.toThrow();
      }
    });

    it("handles extreme historical and future dates (1900 to 9999) safely", () => {
      const dates = [
        new Date(0), // 1970-01-01
        new Date(Date.UTC(1900, 0, 1)), // 1900-01-01
        new Date(Date.UTC(1960, 6, 15)), // 1960-07-15
        new Date(Date.UTC(2024, 1, 29)), // 2024-02-29
        new Date(Date.UTC(2099, 6, 15)), // 2099-07-15
        new Date(Date.UTC(2100, 2, 31)), // 2100-03-31
        new Date(Date.UTC(9999, 11, 31)), // 9999-12-31
      ];

      for (const d of dates) {
        const drift = getMaldivesMonsoonDrift(d);
        expect(drift).toBeDefined();
        expect(Number.isFinite(drift.velocityMs), `velocityMs at ${d.toISOString()} must be finite`).toBe(true);
        expect(drift.velocityMs).toBeGreaterThanOrEqual(0.05);
        expect(drift.velocityMs).toBeLessThanOrEqual(0.45);
        expect(Number.isFinite(drift.directionDeg), `directionDeg at ${d.toISOString()} must be finite`).toBe(true);
        expect(drift.directionDeg).toBeGreaterThanOrEqual(0);
        expect(drift.directionDeg).toBeLessThan(360);
      }
    });

    it("surfaces astronomical date limit behavior at JS Date extrema (+/- 8.64e15 ms)", () => {
      // Adversarial probe at the absolute JavaScript Date representation limit (year 275760):
      // In JS, Date.UTC(275760, 10, 1) overflows past 8.64e15 ms, producing NaN for t1.
      const maxDate = new Date(8640000000000000); // 275760-09-13
      const minDate = new Date(-8640000000000000); // -271821-04-20
      const driftMax = getMaldivesMonsoonDrift(maxDate);
      const driftMin = getMaldivesMonsoonDrift(minDate);

      expect(driftMax).toBeDefined();
      expect(driftMin).toBeDefined();
      // Both evaluate without throwing runtime unhandled exceptions
      expect(typeof driftMax.velocityMs).toBe("number");
      expect(typeof driftMin.velocityMs).toBe("number");
    });
  });

  // ── 5. Hydrodynamic Pass Flux & Marine Integration ────────────────────────
  describe("5. Hydrodynamic Inward Flux & Marine Hour Integration", () => {
    it("monsoonInwardFlux: mathematically bounded within [-v, +v] for all 360 compass headings", () => {
      const drift: OceanDrift = { velocityMs: 0.42, directionDeg: 90 };

      for (let bearing = 0; bearing < 360; bearing++) {
        const flux = monsoonInwardFlux(drift, bearing);
        expect(Number.isFinite(flux)).toBe(true);
        expect(flux).toBeLessThanOrEqual(drift.velocityMs + 1e-12);
        expect(flux).toBeGreaterThanOrEqual(-drift.velocityMs - 1e-12);
      }

      // Exact cardinal points
      expect(monsoonInwardFlux(drift, 90)).toBeCloseTo(0.42, 6); // Aligned push (+v)
      expect(monsoonInwardFlux(drift, 270)).toBeCloseTo(-0.42, 6); // Antiparallel draw (-v)
      expect(monsoonInwardFlux(drift, 0)).toBeCloseTo(0, 6); // Orthogonal (0)
      expect(monsoonInwardFlux(drift, 180)).toBeCloseTo(0, 6); // Orthogonal (0)
    });

    it("resolveHourDrift: seamlessly falls back to climatology when marine velocity/direction is missing or corrupted", () => {
      const testDate = new Date("2026-07-15T12:00:00Z");
      const expectedClimatology = getMaldivesMonsoonDrift(testDate);

      const corruptedHours: MarineHour[] = [
        { time: "2026-07-15T12:00", seaLevelM: 0.5, currentVelocityMs: null, currentDirectionDeg: null },
        { time: "2026-07-15T12:00", seaLevelM: 0.5, currentVelocityMs: undefined as unknown as null, currentDirectionDeg: undefined as unknown as null },
        { time: "2026-07-15T12:00", seaLevelM: 0.5, currentVelocityMs: Number.NaN, currentDirectionDeg: 90 },
        { time: "2026-07-15T12:00", seaLevelM: 0.5, currentVelocityMs: 0.4, currentDirectionDeg: Number.NaN },
        { time: "2026-07-15T12:00", seaLevelM: 0.5, currentVelocityMs: Number.POSITIVE_INFINITY, currentDirectionDeg: 90 },
      ];

      for (const h of corruptedHours) {
        const resolved = resolveHourDrift(h);
        expect(resolved.directionDeg).toBe(expectedClimatology.directionDeg);
        expect(resolved.velocityMs).toBeCloseTo(expectedClimatology.velocityMs, 5);
      }
    });

    it("resolveHourDrift: preserves valid measured marine vectors when available", () => {
      const measuredHour: MarineHour = {
        time: "2026-07-15T12:00",
        seaLevelM: 0.5,
        currentVelocityMs: 0.62,
        currentDirectionDeg: 135,
      };

      const resolved = resolveHourDrift(measuredHour);
      expect(resolved.velocityMs).toBe(0.62);
      expect(resolved.directionDeg).toBe(135);
    });

    it("forecastHours executes cleanly across all 12 calendar months with climatology fallback", () => {
      for (let month = 0; month < 12; month++) {
        const start = new Date(Date.UTC(2026, month, 10, 0, 0, 0));
        // Marine series with null current vectors (triggers climatology fallback for all 72 hours)
        const series = makeSyntheticSeries(start, 72, { velocityMs: null, directionDeg: null });

        const forecast = forecastHours({
          hours: series,
          inwardBearingDeg: 90,
          channelWidthM: 800,
          channelDepthM: 30,
        });

        expect(forecast.length).toBeGreaterThan(0);
        for (const f of forecast) {
          expect(Number.isFinite(f.levelM)).toBe(true);
          expect(["slack", "mild", "strong", "too_strong"]).toContain(f.strength);
          expect(["incoming", "outgoing"]).toContain(f.direction);
        }
      }
    });

    it("forecastHours preserves slack and calm condition when currentVelocityMs is explicitly 0", () => {
      const start = new Date("2026-07-15T00:00:00Z");
      // Explicit calm current
      const calmSeries = makeSyntheticSeries(start, 72, { amplitude: 0.0, mean: 0.5, velocityMs: 0, directionDeg: 0 });

      const forecast = forecastHours({
        hours: calmSeries,
        inwardBearingDeg: 90,
      });

      // Flat zero tide + zero current must strictly produce slack
      for (const f of forecast) {
        expect(f.strength).toBe("slack");
      }
    });
  });
});
