import { describe, expect, it } from "vitest";
import {
  forecastHours,
  reportTemporalWeight,
  REPORT_HALF_LIFE_DAYS,
  REPORT_HALF_LIFE_MS,
  LAG_PENALTY_LAMBDA,
  CONSENSUS_RATIO_THRESHOLD,
  SEVEN_DAYS_MS,
  type ForecastInput,
} from "../lib/forecast";
import type { MarineHour, Report, Direction, Strength } from "../lib/types";

// Helper to generate a clean synthetic tidal series
function makeTidalSeries(
  startDateStr: string,
  numHours: number = 72,
  periodHours: number = 12,
  amplitudeM: number = 0.6,
): MarineHour[] {
  const startMs = Date.parse(startDateStr);
  return Array.from({ length: numHours }, (_, i) => {
    const time = new Date(startMs + i * 3600 * 1000).toISOString().slice(0, 16);
    const phase = (2 * Math.PI * i) / periodHours;
    const seaLevelM = 1.0 + amplitudeM * Math.sin(phase);
    return {
      time,
      seaLevelM,
      currentVelocityMs: 0.1,
      currentDirectionDeg: 90,
    };
  });
}

function findHour(forecast: ReturnType<typeof forecastHours>, timeStr: string) {
  return forecast.find((h) => h.time === timeStr || h.time.startsWith(timeStr));
}

describe("Adversarial Verification of Milestone 3: Confidence Scoring & Regularized Phase Fitting", () => {
  // ────────────────────────────────────────────────────────────────────────────
  // 1. Contradiction Safety Gate (7-Day Boundary Stress Testing)
  // ────────────────────────────────────────────────────────────────────────────
  describe("1. Contradiction Safety Gate: 7-Day Window Stress Testing", () => {
    const baseDate = "2026-07-20T00:00";
    const hours = makeTidalSeries(baseDate, 72, 12, 0.6);

    // Target hour at 2026-07-21T01:00 (index 25)
    // Sin series period 12h: forward residual at i=25 is positive (rising) => incoming.
    // Do not use i=27 (peak / falling) — that yields outgoing and breaks the baseline.
    const targetHourStr = "2026-07-21T01:00";
    const targetMs = Date.parse(targetHourStr + ":00Z");

    // Establish baseline high confidence using 4 agreeing concordant reports outside 7-day window
    // 15 days before targetHour
    const concordantTime = new Date(targetMs - 15 * 24 * 3600 * 1000).toISOString().slice(0, 16);
    const baselineReports: Report[] = [
      { id: "base-1", siteId: "s", time: concordantTime, direction: "incoming", strength: "too_strong", slopeM: 0.08 },
      { id: "base-2", siteId: "s", time: concordantTime, direction: "incoming", strength: "too_strong", slopeM: 0.08 },
      { id: "base-3", siteId: "s", time: concordantTime, direction: "incoming", strength: "too_strong", slopeM: 0.08 },
      { id: "base-4", siteId: "s", time: concordantTime, direction: "incoming", strength: "too_strong", slopeM: 0.08 },
      { id: "base-5", siteId: "s", time: concordantTime, direction: "incoming", strength: "too_strong", slopeM: 0.08 },
    ];

    it("1.1 Baseline establishes high confidence when allowHighConfidence=true and reports agree", () => {
      const forecast = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: baselineReports,
        allowHighConfidence: true,
      });
      const hour = findHour(forecast, targetHourStr);
      expect(hour).toBeDefined();
      expect(hour!.direction).toBe("incoming");
      expect(hour!.confidence).toBe("high");
    });

    it("1.2 Contradiction at exactly 6.99 days strictly forbids high confidence", () => {
      // 6.99 days before targetMs = 6.99 * 24 * 3600 * 1000 ms = 603,936,000 ms before targetMs
      const t699Ms = targetMs - Math.floor(6.99 * 24 * 3600 * 1000);
      const time699 = new Date(t699Ms).toISOString().slice(0, 16);

      const noisyReport699: Report = {
        id: "contra-6.99d",
        siteId: "s",
        time: time699,
        direction: "outgoing", // Contradicts incoming
        strength: "strong",
        slopeM: 0.08,
      };

      const forecast = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: [...baselineReports, noisyReport699],
        allowHighConfidence: true,
      });

      const hour = findHour(forecast, targetHourStr);
      expect(hour).toBeDefined();
      // Hard invariant: NEVER "high"
      expect(hour!.confidence).not.toBe("high");
      expect(["low", "medium"]).toContain(hour!.confidence);
    });

    it("1.3 Contradiction at 7 days minus 1 millisecond (inside 7d window) strictly forbids high confidence", () => {
      const tInsideMs = targetMs - (SEVEN_DAYS_MS - 1000); // 1 sec inside
      const timeInside = new Date(tInsideMs).toISOString().slice(0, 16);

      const reportInside: Report = {
        id: "contra-inside-7d",
        siteId: "s",
        time: timeInside,
        direction: "outgoing",
        strength: "strong",
        slopeM: 0.08,
      };

      const forecast = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: [...baselineReports, reportInside],
        allowHighConfidence: true,
      });

      const hour = findHour(forecast, targetHourStr);
      expect(hour).toBeDefined();
      expect(hour!.confidence).not.toBe("high");
    });

    it("1.4 Boundary at 7.01 days: evaluates outside 7-day contradiction gate", () => {
      // 7.01 days before targetMs = 605,664,000 ms before targetMs > SEVEN_DAYS_MS (604,800,000 ms)
      const t701Ms = targetMs - Math.ceil(7.01 * 24 * 3600 * 1000);
      const time701 = new Date(t701Ms).toISOString().slice(0, 16);

      // Verify mathematical relation to SEVEN_DAYS_MS
      expect(targetMs - t701Ms).toBeGreaterThan(SEVEN_DAYS_MS);

      const noisyReport701: Report = {
        id: "contra-7.01d",
        siteId: "s",
        time: time701,
        direction: "outgoing",
        strength: "strong",
        slopeM: 0.08,
      };

      const forecast = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: [...baselineReports, noisyReport701],
        allowHighConfidence: true,
      });

      const hour = findHour(forecast, targetHourStr);
      expect(hour).toBeDefined();
      // Because directionUnanimous checks all similar reports, a contradictory report at 7.01d
      // breaks unanimous agreement and caps confidence at medium (not crashing, graceful degradation)
      expect(hour!.confidence).toBe("medium");
    });

    it("1.5 Clock-hour contradiction (< 1 hour) forbids high confidence even without slope data", () => {
      const timeRecent = new Date(targetMs - 30 * 60 * 1000).toISOString().slice(0, 16); // 30 min before
      const unsizedReport: Report = {
        id: "recent-unsloped",
        siteId: "s",
        time: timeRecent,
        direction: "outgoing",
        strength: "strong",
      };

      const forecast = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: [...baselineReports, unsizedReport],
        allowHighConfidence: true,
      });

      const hour = findHour(forecast, targetHourStr);
      expect(hour).toBeDefined();
      expect(hour!.confidence).not.toBe("high");
    });

    it("1.6 Future clock-skew contradiction within 7 days is caught symmetrically", () => {
      // A report recorded 2 hours in the future due to clock skew
      const timeFuture = new Date(targetMs + 2 * 3600 * 1000).toISOString().slice(0, 16);
      const futureReport: Report = {
        id: "future-contra",
        siteId: "s",
        time: timeFuture,
        direction: "outgoing",
        strength: "strong",
        slopeM: 0.08,
      };

      const forecast = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: [...baselineReports, futureReport],
        allowHighConfidence: true,
      });

      const hour = findHour(forecast, targetHourStr);
      expect(hour).toBeDefined();
      expect(hour!.confidence).not.toBe("high");
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 2. Regularized Phase Offset Fitting & L1 Lag Penalty
  // ────────────────────────────────────────────────────────────────────────────
  describe("2. Regularized Phase Offset Fitting: L1 Lag Penalty & Anti-Jump", () => {
    const baseDate = "2026-07-20T00:00";
    const hours = makeTidalSeries(baseDate, 72, 12, 0.6);

    it("2.1 L1 penalty lambda is strictly positive and increases monotonically with |k|", () => {
      expect(LAG_PENALTY_LAMBDA).toBe(0.05);

      const lags = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6];
      const penalties = lags.map((k) => LAG_PENALTY_LAMBDA * Math.abs(k));

      // Check symmetry and monotonicity
      for (let i = 0; i <= 6; i++) {
        expect(LAG_PENALTY_LAMBDA * Math.abs(i)).toBeCloseTo(i * 0.05, 5);
        expect(LAG_PENALTY_LAMBDA * Math.abs(-i)).toBeCloseTo(i * 0.05, 5);
        if (i > 0) {
          expect(LAG_PENALTY_LAMBDA * i).toBeGreaterThan(LAG_PENALTY_LAMBDA * (i - 1));
        }
      }
    });

    it("2.2 Single random report cannot cause a spurious phase shift (voter count < 2 guard)", () => {
      // 1 single report desiring lag +3
      // Lag 3 incoming window:
      const singleReport: Report = {
        id: "lone-wolf",
        siteId: "s",
        time: "2026-07-21T03:00",
        direction: "outgoing",
        strength: "strong",
        slopeM: 0.08,
      };

      const baseline = forecastHours({ hours, inwardBearingDeg: 90, reports: [] });
      const withSingle = forecastHours({ hours, inwardBearingDeg: 90, reports: [singleReport] });

      // In-series hours must not jump phase offset
      // Compare direction patterns: since report fades after 6h, hour 24h later must match baseline
      const hourLaterBase = findHour(baseline, "2026-07-22T03:00");
      const hourLaterTest = findHour(withSingle, "2026-07-22T03:00");
      expect(hourLaterTest!.direction).toBe(hourLaterBase!.direction);
    });

    it("2.3 Weak or decayed reports cannot overcome L1 penalty against lag 0", () => {
      // Two ancient reports (e.g. 500 days old, weight = 2^(-500/90) ≈ 0.021) voting for lag +3
      const ancientTime = new Date(Date.parse("2026-07-20T00:00Z") - 500 * 24 * 3600 * 1000)
        .toISOString()
        .slice(0, 16);

      const ancientReports: Report[] = [
        { id: "anc-1", siteId: "s", time: ancientTime, direction: "outgoing", strength: "mild", slopeM: 0.08 },
        { id: "anc-2", siteId: "s", time: ancientTime, direction: "outgoing", strength: "mild", slopeM: 0.08 },
      ];

      const baseline = forecastHours({ hours, inwardBearingDeg: 90, reports: [] });
      const withAncient = forecastHours({ hours, inwardBearingDeg: 90, reports: ancientReports });

      // The raw score is ~0.042, which is < 0.5 minimum raw threshold and penalty 0.05 * 3 = 0.15 wipes it out
      expect(withAncient.map((h) => h.direction)).toEqual(baseline.map((h) => h.direction));
    });

    it("2.4 Genuine dual fresh reports overcome L1 penalty and shift phase offset", () => {
      // When 2 fresh reports with high weight (e.g. 2.0) favor a shifted window,
      // Regularized score = 2.0 - 0.05 * 2 = 1.90 > 0, so phase offset is adopted
      // Using outsideWindow helper pattern from forecast.test.ts
      const slopeWindowForLag = (targetLag: number) => {
        // window length 13 (indices 0..12, center 6)
        // Set slope positive only at index (6 + targetLag)
        const slopes = Array(13).fill(-0.08);
        slopes[6 + targetLag] = 0.08;
        return slopes;
      };

      const freshShiftedReports: Report[] = [
        {
          id: "shift-1",
          siteId: "s",
          time: "2026-06-01T00:00",
          direction: "incoming",
          strength: "strong",
          slopeM: 0.08,
          slopeWindowM: slopeWindowForLag(2),
        },
        {
          id: "shift-2",
          siteId: "s",
          time: "2026-06-01T01:00",
          direction: "incoming",
          strength: "strong",
          slopeM: 0.08,
          slopeWindowM: slopeWindowForLag(2),
        },
      ];

      const shiftedForecast = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: freshShiftedReports,
      });

      const baseline = forecastHours({ hours, inwardBearingDeg: 90, reports: [] });

      // There should be a phase shift relative to baseline
      const differences = shiftedForecast.filter((h, i) => h.direction !== baseline[i].direction);
      expect(differences.length).toBeGreaterThan(0);
    });

    it("2.5 Phase fitting is deterministic and commutative under report array reversal", () => {
      const reports: Report[] = [
        {
          id: "rep-A",
          siteId: "s",
          time: "2026-06-15T00:00",
          direction: "incoming",
          strength: "mild",
          slopeM: 0.08,
        },
        {
          id: "rep-B",
          siteId: "s",
          time: "2026-06-15T06:00",
          direction: "outgoing",
          strength: "strong",
          slopeM: -0.08,
        },
      ];

      const fwd = forecastHours({ hours, inwardBearingDeg: 90, reports });
      const rev = forecastHours({ hours, inwardBearingDeg: 90, reports: [...reports].reverse() });

      expect(fwd.map((h) => ({ t: h.time, d: h.direction, s: h.strength, c: h.confidence }))).toEqual(
        rev.map((h) => ({ t: h.time, d: h.direction, s: h.strength, c: h.confidence })),
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 3. Temporal Decay Weighting Mathematics
  // ────────────────────────────────────────────────────────────────────────────
  describe("3. Temporal Decay Weighting ($w = 2^{-\\Delta t / 90\\text{d}}$)", () => {
    const refMs = Date.parse("2026-07-20T00:00:00Z");

    it("3.1 Evaluates exact half-life decay at 0, 90, 180, 270, and 360 days", () => {
      expect(REPORT_HALF_LIFE_DAYS).toBe(90);
      expect(REPORT_HALF_LIFE_MS).toBe(90 * 24 * 3600 * 1000);

      const testDecay = (daysAgo: number) => {
        const time = new Date(refMs - daysAgo * 24 * 3600 * 1000).toISOString().slice(0, 16);
        return reportTemporalWeight(time, refMs);
      };

      expect(testDecay(0)).toBeCloseTo(1.0, 6);
      expect(testDecay(90)).toBeCloseTo(0.5, 6);
      expect(testDecay(180)).toBeCloseTo(0.25, 6);
      expect(testDecay(270)).toBeCloseTo(0.125, 6);
      expect(testDecay(360)).toBeCloseTo(0.0625, 6);
      expect(testDecay(730)).toBeCloseTo(Math.pow(2, -730 / 90), 6);
    });

    it("3.2 Clamps future timestamps to deltaMs=0 (weight=1.0) without overflow", () => {
      // Future report 10 days ahead
      const futureTime = new Date(refMs + 10 * 24 * 3600 * 1000).toISOString().slice(0, 16);
      expect(reportTemporalWeight(futureTime, refMs)).toBe(1.0);
    });

    it("3.3 Handles invalid, NaN, or non-finite inputs safely", () => {
      expect(reportTemporalWeight("invalid-date", refMs)).toBe(0);
      expect(reportTemporalWeight("2026-07-20T00:00", Number.NaN)).toBe(1.0);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 4. Consensus Ratio & Outlier Dampening
  // ────────────────────────────────────────────────────────────────────────────
  describe("4. Consensus Ratio & Outlier Dampening (60% Threshold)", () => {
    const baseDate = "2026-07-20T00:00";
    const hours = makeTidalSeries(baseDate, 24, 12, 0.6);

    it("4.1 Consensus ratio threshold is strictly 0.60 (60%)", () => {
      expect(CONSENSUS_RATIO_THRESHOLD).toBe(0.6);
    });

    it("4.2 Exactly 50/50 split cleanly cancels out to underlying astronomical tide", () => {
      const splitReports: Report[] = [
        { id: "s1", siteId: "s", time: "2026-07-20T03:00", direction: "incoming", strength: "too_strong" },
        { id: "s2", siteId: "s", time: "2026-07-20T03:00", direction: "outgoing", strength: "too_strong" },
      ];

      const baseline = forecastHours({ hours, inwardBearingDeg: 90, reports: [] });
      const forecast = forecastHours({ hours, inwardBearingDeg: 90, reports: splitReports });

      const targetBase = findHour(baseline, "2026-07-20T03:00");
      const targetTest = findHour(forecast, "2026-07-20T03:00");

      expect(targetTest!.direction).toBe(targetBase!.direction);
      expect(targetTest!.strength).toBe(targetBase!.strength);
    });

    it("4.3 Single outlier against 4 concordant reports is dampened (>60% consensus holds)", () => {
      // 4 incoming vs 1 outgoing at the same hour
      const reports: Report[] = [
        { id: "c1", siteId: "s", time: "2026-07-20T03:00", direction: "incoming", strength: "strong" },
        { id: "c2", siteId: "s", time: "2026-07-20T03:00", direction: "incoming", strength: "strong" },
        { id: "c3", siteId: "s", time: "2026-07-20T03:00", direction: "incoming", strength: "strong" },
        { id: "c4", siteId: "s", time: "2026-07-20T03:00", direction: "incoming", strength: "strong" },
        { id: "outlier", siteId: "s", time: "2026-07-20T03:00", direction: "outgoing", strength: "strong" },
      ];

      const forecast = forecastHours({ hours, inwardBearingDeg: 90, reports });
      const targetHour = findHour(forecast, "2026-07-20T03:00");

      // Consensus is 4 / 5 = 80% >= 60%
      expect(targetHour!.direction).toBe("incoming");
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 5. Massive Stress Harness & Numerical Stability
  // ────────────────────────────────────────────────────────────────────────────
  describe("5. Massive Stress Harness & Numerical Stability", () => {
    it("5.1 Simulates 500 conflicting and random reports without NaN, crash, or non-finite outputs", () => {
      const baseDate = "2026-07-20T00:00";
      const hours = makeTidalSeries(baseDate, 168, 12, 0.6); // 1 full week
      const startMs = Date.parse(baseDate + ":00Z");

      const randomReports: Report[] = Array.from({ length: 500 }, (_, i) => {
        // Spread reports across past 365 days up to series end
        const offsetHours = (i * 17) % (365 * 24);
        const reportMs = startMs - offsetHours * 3600 * 1000;
        const time = new Date(reportMs).toISOString().slice(0, 16);
        const direction: Direction = i % 2 === 0 ? "incoming" : "outgoing";
        const strengths: Strength[] = ["slack", "mild", "strong", "too_strong"];
        const strength = strengths[i % strengths.length];
        return {
          id: `stress-${i}`,
          siteId: "s",
          time,
          direction,
          strength,
          slopeM: (i % 3 === 0 ? 1 : -1) * 0.05,
        };
      });

      const startTime = performance.now();
      const forecast = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: randomReports,
        allowHighConfidence: true,
      });
      const durationMs = performance.now() - startTime;

      expect(forecast.length).toBe(138);
      for (const h of forecast) {
        expect(["incoming", "outgoing"]).toContain(h.direction);
        expect(["slack", "mild", "strong", "too_strong"]).toContain(h.strength);
        expect(["low", "medium", "high"]).toContain(h.confidence);
        if (h.levelM != null) {
          expect(Number.isFinite(h.levelM)).toBe(true);
        }
      }

      // Should complete quickly
      expect(durationMs).toBeLessThan(1000);
    });

    it("5.2 Empty reports array safely produces low confidence across entire forecast", () => {
      const hours = makeTidalSeries("2026-07-20T00:00", 24, 12, 0.6);
      const forecast = forecastHours({ hours, inwardBearingDeg: 90, reports: [] });
      expect(forecast.every((h) => h.confidence === "low")).toBe(true);
    });
  });
});
