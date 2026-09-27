import { describe, expect, it } from "vitest";
import {
  aggregateReportPull,
  classifyReport,
  forecastHours,
  reportTemporalWeight,
  CONSENSUS_RATIO_THRESHOLD,
  REPORT_HALF_LIFE_DAYS,
  REPORT_HALF_LIFE_MS,
  SEVEN_DAYS_MS,
} from "../lib/forecast";
import { STRENGTHS, type Direction, type MarineHour, type Report, type Strength } from "../lib/types";

// Permutation generator for array order invariance testing
function getPermutations<T>(arr: readonly T[]): T[][] {
  if (arr.length <= 1) return [[...arr]];
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const current = arr[i];
    const remaining = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const perm of getPermutations(remaining)) {
      result.push([current, ...perm]);
    }
  }
  return result;
}

// Fisher-Yates shuffle with seedable/pseudo-random behavior
function shuffle<T>(array: readonly T[], seed: number): T[] {
  const result = [...array];
  let s = seed;
  const pseudoRand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(pseudoRand() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Generate 72-hour semi-diurnal tidal series (12-hour period)
function makeMarineSeries(
  startDateStr: string,
  numHours: number = 72,
  periodHours: number = 12,
  amplitudeM: number = 0.5,
  meanM: number = 0.8,
): MarineHour[] {
  const startMs = Date.parse(startDateStr.endsWith("Z") ? startDateStr : startDateStr + ":00Z");
  return Array.from({ length: numHours }, (_, i) => {
    const time = new Date(startMs + i * 3600 * 1000).toISOString().slice(0, 16);
    // Phase calculation: sin(0) = 0, sin(pi/2) = 1 (crest at 3h), sin(pi) = 0, sin(3pi/2) = -1 (trough at 9h)
    const phase = (2 * Math.PI * i) / periodHours;
    const seaLevelM = meanM + amplitudeM * Math.sin(phase);
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

describe("Milestone 3 Adversarial Verification: Diver Reports & Outlier Dampening", () => {
  const baseDate = "2026-07-14T00:00";
  const hours = makeMarineSeries(baseDate, 72, 12, 0.5, 0.8);

  // ────────────────────────────────────────────────────────────────────────────
  // 1. Array Order Invariance & Permutation Stress Testing
  // ────────────────────────────────────────────────────────────────────────────
  describe("1. Array Order Invariance (Permutations of Opposing Reports)", () => {
    it("1.1 Permutations of 3 opposing reports (3! = 6 runs) yield 100% identical forecast outputs across all 72 hours", () => {
      const reports3: Report[] = [
        { id: "p3-1", siteId: "s", time: "2026-07-15T02:00", direction: "incoming", strength: "mild" },
        { id: "p3-2", siteId: "s", time: "2026-07-15T03:00", direction: "incoming", strength: "strong" },
        { id: "p3-3", siteId: "s", time: "2026-07-15T03:00", direction: "outgoing", strength: "too_strong" },
      ];

      const perms = getPermutations(reports3);
      expect(perms).toHaveLength(6);

      const baseline = forecastHours({ hours, inwardBearingDeg: 90, reports: perms[0] });

      for (let p = 1; p < perms.length; p++) {
        const testRun = forecastHours({ hours, inwardBearingDeg: 90, reports: perms[p] });
        expect(testRun).toHaveLength(baseline.length);
        for (let i = 0; i < baseline.length; i++) {
          expect(testRun[i].time).toBe(baseline[i].time);
          expect(testRun[i].direction).toBe(baseline[i].direction);
          expect(testRun[i].strength).toBe(baseline[i].strength);
          expect(testRun[i].confidence).toBe(baseline[i].confidence);
          expect(testRun[i].levelM).toBe(baseline[i].levelM);
        }
      }
    });

    it("1.2 Permutations of 4 opposing reports (4! = 24 runs) with balanced tie yield 100% identical outputs", () => {
      const reports4Balanced: Report[] = [
        { id: "p4b-1", siteId: "s", time: "2026-07-15T03:00", direction: "incoming", strength: "mild" },
        { id: "p4b-2", siteId: "s", time: "2026-07-15T03:00", direction: "incoming", strength: "strong" },
        { id: "p4b-3", siteId: "s", time: "2026-07-15T03:00", direction: "outgoing", strength: "mild" },
        { id: "p4b-4", siteId: "s", time: "2026-07-15T03:00", direction: "outgoing", strength: "strong" },
      ];

      const perms = getPermutations(reports4Balanced);
      expect(perms).toHaveLength(24);

      const baseline = forecastHours({ hours, inwardBearingDeg: 90, reports: perms[0] });

      for (let p = 1; p < perms.length; p++) {
        const testRun = forecastHours({ hours, inwardBearingDeg: 90, reports: perms[p] });
        for (let i = 0; i < baseline.length; i++) {
          expect(testRun[i].direction).toBe(baseline[i].direction);
          expect(testRun[i].strength).toBe(baseline[i].strength);
          expect(testRun[i].confidence).toBe(baseline[i].confidence);
        }
      }
    });

    it("1.3 Permutations of 4 opposing reports (4! = 24 runs) with asymmetric 3 vs 1 consensus yield identical outputs", () => {
      const reports4Asym: Report[] = [
        { id: "p4a-1", siteId: "s", time: "2026-07-15T02:00", direction: "incoming", strength: "mild" },
        { id: "p4a-2", siteId: "s", time: "2026-07-15T03:00", direction: "incoming", strength: "strong" },
        { id: "p4a-3", siteId: "s", time: "2026-07-15T04:00", direction: "incoming", strength: "strong" },
        { id: "p4a-4", siteId: "s", time: "2026-07-15T03:00", direction: "outgoing", strength: "mild" },
      ];

      const perms = getPermutations(reports4Asym);
      expect(perms).toHaveLength(24);

      const baseline = forecastHours({ hours, inwardBearingDeg: 90, reports: perms[0] });

      for (let p = 1; p < perms.length; p++) {
        const testRun = forecastHours({ hours, inwardBearingDeg: 90, reports: perms[p] });
        for (let i = 0; i < baseline.length; i++) {
          expect(testRun[i].direction).toBe(baseline[i].direction);
          expect(testRun[i].strength).toBe(baseline[i].strength);
          expect(testRun[i].confidence).toBe(baseline[i].confidence);
        }
      }
    });

    it("1.4 Permutations of 5 opposing reports (5! = 120 runs) with multi-hour spread yield 100% identical outputs", () => {
      const reports5: Report[] = [
        { id: "p5-1", siteId: "s", time: "2026-07-15T01:00", direction: "incoming", strength: "mild" },
        { id: "p5-2", siteId: "s", time: "2026-07-15T02:00", direction: "incoming", strength: "strong" },
        { id: "p5-3", siteId: "s", time: "2026-07-15T03:00", direction: "incoming", strength: "too_strong" },
        { id: "p5-4", siteId: "s", time: "2026-07-15T02:00", direction: "outgoing", strength: "strong" },
        { id: "p5-5", siteId: "s", time: "2026-07-15T03:00", direction: "outgoing", strength: "mild" },
      ];

      const perms = getPermutations(reports5);
      expect(perms).toHaveLength(120);

      const baseline = forecastHours({ hours, inwardBearingDeg: 90, reports: perms[0] });

      for (let p = 1; p < perms.length; p++) {
        const testRun = forecastHours({ hours, inwardBearingDeg: 90, reports: perms[p] });
        for (let i = 0; i < baseline.length; i++) {
          expect(testRun[i].direction).toBe(baseline[i].direction);
          expect(testRun[i].strength).toBe(baseline[i].strength);
          expect(testRun[i].confidence).toBe(baseline[i].confidence);
        }
      }
    });

    it("1.5 Monte Carlo randomized shuffle (50 iterations) of 8 contradictory reports maintains bit-for-bit invariance", () => {
      const complexReports: Report[] = [
        { id: "mc-1", siteId: "s", time: "2026-07-15T01:00", direction: "incoming", strength: "slack" },
        { id: "mc-2", siteId: "s", time: "2026-07-15T02:00", direction: "incoming", strength: "mild" },
        { id: "mc-3", siteId: "s", time: "2026-07-15T03:00", direction: "incoming", strength: "strong" },
        { id: "mc-4", siteId: "s", time: "2026-07-15T04:00", direction: "incoming", strength: "too_strong" },
        { id: "mc-5", siteId: "s", time: "2026-07-15T02:00", direction: "outgoing", strength: "strong" },
        { id: "mc-6", siteId: "s", time: "2026-07-15T03:00", direction: "outgoing", strength: "mild" },
        { id: "mc-7", siteId: "s", time: "2026-06-15T03:00", direction: "incoming", strength: "strong" },
        { id: "mc-8", siteId: "s", time: "2026-05-15T03:00", direction: "outgoing", strength: "strong" },
      ];

      const baseline = forecastHours({ hours, inwardBearingDeg: 90, reports: complexReports });

      for (let seed = 1; seed <= 50; seed++) {
        const shuffled = shuffle(complexReports, seed);
        const testRun = forecastHours({ hours, inwardBearingDeg: 90, reports: shuffled });
        for (let i = 0; i < baseline.length; i++) {
          expect(testRun[i].direction).toBe(baseline[i].direction);
          expect(testRun[i].strength).toBe(baseline[i].strength);
          expect(testRun[i].confidence).toBe(baseline[i].confidence);
        }
      }
    });

    it("1.6 Direct aggregateReportPull unit permutation invariance across active classified reports", () => {
      const openHour = {
        time: "2026-07-15T03:00",
        direction: "incoming" as Direction,
        strength: "mild" as Strength,
        slope: 0.08,
        nudge: 0,
        index: 3,
        levelM: 0.9,
      };

      const rawReports: Report[] = [
        { id: "dir-1", siteId: "s", time: "2026-07-15T01:00", direction: "incoming", strength: "mild", slopeM: 0.07 },
        { id: "dir-2", siteId: "s", time: "2026-07-15T02:00", direction: "incoming", strength: "strong", slopeM: 0.08 },
        { id: "dir-3", siteId: "s", time: "2026-07-15T03:00", direction: "incoming", strength: "strong", slopeM: 0.08 },
        { id: "dir-4", siteId: "s", time: "2026-07-15T02:00", direction: "outgoing", strength: "mild", slopeM: 0.08 },
        { id: "dir-5", siteId: "s", time: "2026-07-15T03:00", direction: "outgoing", strength: "too_strong", slopeM: 0.08 },
      ];

      const classified = rawReports.map((r) => classifyReport(r, hours));
      const perms = getPermutations(classified);
      expect(perms).toHaveLength(120);

      // Cast openHour as any to satisfy internal OpenHour signature
      const baseline = aggregateReportPull(openHour as any, hours, perms[0]);

      for (let p = 1; p < perms.length; p++) {
        const pull = aggregateReportPull(openHour as any, hours, perms[p]);
        expect(pull.direction).toBe(baseline.direction);
        expect(pull.strength).toBe(baseline.strength);
        expect(pull.contradicted).toBe(baseline.contradicted);
      }
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 2. Outlier Dampening & Consensus Ratios
  // ────────────────────────────────────────────────────────────────────────────
  describe("2. Outlier Dampening Under Extreme Ratios (10 vs 1 & 1 vs 10)", () => {
    it("2.1 Co-located 10 incoming vs 1 outgoing: incoming consensus dampens outlier", () => {
      const incoming10: Report[] = Array.from({ length: 10 }, (_, i) => ({
        id: `inc-${i}`,
        siteId: "s",
        time: "2026-07-15T03:00",
        direction: "incoming",
        strength: "strong",
      }));
      const outlier1: Report = {
        id: "out-1",
        siteId: "s",
        time: "2026-07-15T03:00",
        direction: "outgoing",
        strength: "too_strong",
      };

      const forecast = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: [...incoming10, outlier1],
      });

      const hour = findHour(forecast, "2026-07-15T03:00");
      expect(hour).toBeDefined();
      expect(hour!.direction).toBe("incoming");
      expect(["strong", "too_strong"]).toContain(hour!.strength);
    });

    it("2.2 Co-located 10 outgoing vs 1 incoming: outgoing consensus dampens outlier", () => {
      // Hour 09:00 is falling tide (cos(3pi/2) = 0, falling slope, astronomical outgoing)
      const outgoing10: Report[] = Array.from({ length: 10 }, (_, i) => ({
        id: `outg-${i}`,
        siteId: "s",
        time: "2026-07-15T09:00",
        direction: "outgoing",
        strength: "strong",
      }));
      const outlier1: Report = {
        id: "inc-outlier",
        siteId: "s",
        time: "2026-07-15T09:00",
        direction: "incoming",
        strength: "too_strong",
      };

      const forecast = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: [...outgoing10, outlier1],
      });

      const hour = findHour(forecast, "2026-07-15T09:00");
      expect(hour).toBeDefined();
      expect(hour!.direction).toBe("outgoing");
      expect(["strong", "too_strong"]).toContain(hour!.strength);
    });

    it("2.3 Temporally spread: 10 incoming reports across past 1–5 hours dampen 1 fresh outgoing outlier at 0h", () => {
      // Target hour: 2026-07-15T05:00
      // 1 outgoing report at 05:00 (age 0h, fade weight 1.0)
      // 10 incoming reports spread over past 1h..5h:
      // 2 reports at 04:00 (age 1h, fade weight 5/6 ≈ 0.833) -> 1.666
      // 2 reports at 03:00 (age 2h, fade weight 4/6 ≈ 0.667) -> 1.333
      // 2 reports at 02:00 (age 3h, fade weight 3/6 = 0.500) -> 1.000
      // 2 reports at 01:00 (age 4h, fade weight 2/6 ≈ 0.333) -> 0.666
      // 2 reports at 00:00 (age 5h, fade weight 1/6 ≈ 0.167) -> 0.333
      // Total incoming fade weight ≈ 5.0 vs outgoing weight = 1.0
      // Ratio = 5.0 / 6.0 ≈ 83.3% >= 60%
      const spreadIncoming: Report[] = [
        { id: "sp-1a", siteId: "s", time: "2026-07-15T04:00", direction: "incoming", strength: "strong", slopeM: 0.08 },
        { id: "sp-1b", siteId: "s", time: "2026-07-15T04:00", direction: "incoming", strength: "strong", slopeM: 0.08 },
        { id: "sp-2a", siteId: "s", time: "2026-07-15T03:00", direction: "incoming", strength: "strong", slopeM: 0.08 },
        { id: "sp-2b", siteId: "s", time: "2026-07-15T03:00", direction: "incoming", strength: "strong", slopeM: 0.08 },
        { id: "sp-3a", siteId: "s", time: "2026-07-15T02:00", direction: "incoming", strength: "strong", slopeM: 0.08 },
        { id: "sp-3b", siteId: "s", time: "2026-07-15T02:00", direction: "incoming", strength: "strong", slopeM: 0.08 },
        { id: "sp-4a", siteId: "s", time: "2026-07-15T01:00", direction: "incoming", strength: "strong", slopeM: 0.08 },
        { id: "sp-4b", siteId: "s", time: "2026-07-15T01:00", direction: "incoming", strength: "strong", slopeM: 0.08 },
        { id: "sp-5a", siteId: "s", time: "2026-07-15T00:00", direction: "incoming", strength: "strong", slopeM: 0.08 },
        { id: "sp-5b", siteId: "s", time: "2026-07-15T00:00", direction: "incoming", strength: "strong", slopeM: 0.08 },
      ];
      const freshOutlier: Report = {
        id: "fresh-outlier",
        siteId: "s",
        time: "2026-07-15T05:00",
        direction: "outgoing",
        strength: "too_strong",
        slopeM: 0.08,
      };

      const openHour = {
        time: "2026-07-15T05:00",
        direction: "incoming" as Direction,
        strength: "strong" as Strength,
        slope: 0.08,
        nudge: 0,
        index: 5,
        levelM: 0.9,
      };
      const classified = [...spreadIncoming, freshOutlier].map((r) => classifyReport(r, hours));
      const pull = aggregateReportPull(openHour as any, hours, classified);
      // Fresh outlier is dampened by accumulated consensus
      expect(pull.direction).toBe("incoming");
    });

    it("2.4 Symmetrical spread: 10 outgoing reports across past 1–5 hours dampen 1 fresh incoming outlier at 0h", () => {
      // Ebb phase: 06:00 to 11:00
      const spreadOutgoing: Report[] = [
        { id: "spo-1a", siteId: "s", time: "2026-07-15T10:00", direction: "outgoing", strength: "strong", slopeM: -0.08 },
        { id: "spo-1b", siteId: "s", time: "2026-07-15T10:00", direction: "outgoing", strength: "strong", slopeM: -0.08 },
        { id: "spo-2a", siteId: "s", time: "2026-07-15T09:00", direction: "outgoing", strength: "strong", slopeM: -0.08 },
        { id: "spo-2b", siteId: "s", time: "2026-07-15T09:00", direction: "outgoing", strength: "strong", slopeM: -0.08 },
        { id: "spo-3a", siteId: "s", time: "2026-07-15T08:00", direction: "outgoing", strength: "strong", slopeM: -0.08 },
        { id: "spo-3b", siteId: "s", time: "2026-07-15T08:00", direction: "outgoing", strength: "strong", slopeM: -0.08 },
        { id: "spo-4a", siteId: "s", time: "2026-07-15T07:00", direction: "outgoing", strength: "strong", slopeM: -0.08 },
        { id: "spo-4b", siteId: "s", time: "2026-07-15T07:00", direction: "outgoing", strength: "strong", slopeM: -0.08 },
        { id: "spo-5a", siteId: "s", time: "2026-07-15T06:00", direction: "outgoing", strength: "strong", slopeM: -0.08 },
        { id: "spo-5b", siteId: "s", time: "2026-07-15T06:00", direction: "outgoing", strength: "strong", slopeM: -0.08 },
      ];
      const freshIncoming: Report = {
        id: "fresh-incoming",
        siteId: "s",
        time: "2026-07-15T11:00",
        direction: "incoming",
        strength: "too_strong",
        slopeM: -0.08,
      };

      const openHour = {
        time: "2026-07-15T11:00",
        direction: "outgoing" as Direction,
        strength: "strong" as Strength,
        slope: -0.08,
        nudge: 0,
        index: 11,
        levelM: 0.5,
      };
      const classified = [...spreadOutgoing, freshIncoming].map((r) => classifyReport(r, hours));
      const pull = aggregateReportPull(openHour as any, hours, classified);
      expect(pull.direction).toBe("outgoing");
    });

    it("2.5 Consensus ratio boundary: 3 incoming vs 2 outgoing (ratio = 60.0%) achieves consensus and adopts incoming", () => {
      // 3 vs 2 at exact same hour: incoming ratio is 3 / 5 = 60.0% == CONSENSUS_RATIO_THRESHOLD (0.6)
      const reports3vs2: Report[] = [
        { id: "r3-1", siteId: "s", time: "2026-07-15T03:00", direction: "incoming", strength: "strong" },
        { id: "r3-2", siteId: "s", time: "2026-07-15T03:00", direction: "incoming", strength: "strong" },
        { id: "r3-3", siteId: "s", time: "2026-07-15T03:00", direction: "incoming", strength: "strong" },
        { id: "r2-1", siteId: "s", time: "2026-07-15T03:00", direction: "outgoing", strength: "mild" },
        { id: "r2-2", siteId: "s", time: "2026-07-15T03:00", direction: "outgoing", strength: "mild" },
      ];

      const forecast = forecastHours({ hours, inwardBearingDeg: 90, reports: reports3vs2 });
      const hour = findHour(forecast, "2026-07-15T03:00");
      expect(hour).toBeDefined();
      // Exactly 60% reaches threshold
      expect(hour!.direction).toBe("incoming");
    });

    it("2.6 Consensus ratio boundary: 5 incoming vs 4 outgoing (ratio = 55.5% < 60.0%) falls back to astronomical tide", () => {
      // 5 vs 4: incoming ratio is 5 / 9 ≈ 55.5% < 60%
      // On an outgoing tide (hour 09:00), reports cannot overcome tidal direction because 55.5% < 60%
      const reports5vs4: Report[] = [
        { id: "r5-1", siteId: "s", time: "2026-07-15T09:00", direction: "incoming", strength: "strong" },
        { id: "r5-2", siteId: "s", time: "2026-07-15T09:00", direction: "incoming", strength: "strong" },
        { id: "r5-3", siteId: "s", time: "2026-07-15T09:00", direction: "incoming", strength: "strong" },
        { id: "r5-4", siteId: "s", time: "2026-07-15T09:00", direction: "incoming", strength: "strong" },
        { id: "r5-5", siteId: "s", time: "2026-07-15T09:00", direction: "incoming", strength: "strong" },
        { id: "r4-1", siteId: "s", time: "2026-07-15T09:00", direction: "outgoing", strength: "strong" },
        { id: "r4-2", siteId: "s", time: "2026-07-15T09:00", direction: "outgoing", strength: "strong" },
        { id: "r4-3", siteId: "s", time: "2026-07-15T09:00", direction: "outgoing", strength: "strong" },
        { id: "r4-4", siteId: "s", time: "2026-07-15T09:00", direction: "outgoing", strength: "strong" },
      ];

      const forecast = forecastHours({ hours, inwardBearingDeg: 90, reports: reports5vs4 });
      const baseline = forecastHours({ hours, inwardBearingDeg: 90, reports: [] });

      const hourTest = findHour(forecast, "2026-07-15T09:00");
      const hourBase = findHour(baseline, "2026-07-15T09:00");

      expect(hourTest).toBeDefined();
      expect(hourBase).toBeDefined();
      // Under sub-threshold consensus, safely falls back to astronomical tidal model
      expect(hourTest!.direction).toBe(hourBase!.direction);
    });

    it("2.7 Symmetrical 50/50 tie defaults cleanly to astronomical direction with zero strength bias", () => {
      const reportsTie: Report[] = [
        { id: "tie-in", siteId: "s", time: "2026-07-15T03:00", direction: "incoming", strength: "too_strong" },
        { id: "tie-out", siteId: "s", time: "2026-07-15T03:00", direction: "outgoing", strength: "too_strong" },
      ];

      const forecastTie = forecastHours({ hours, inwardBearingDeg: 90, reports: reportsTie });
      const forecastBase = forecastHours({ hours, inwardBearingDeg: 90, reports: [] });

      const hourTie = findHour(forecastTie, "2026-07-15T03:00");
      const hourBase = findHour(forecastBase, "2026-07-15T03:00");

      expect(hourTie).toBeDefined();
      expect(hourBase).toBeDefined();
      expect(hourTie!.direction).toBe(hourBase!.direction);
      expect(hourTie!.strength).toBe(hourBase!.strength);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 3. Temporal Decay Bounds & Multi-Year Drift
  // ────────────────────────────────────────────────────────────────────────────
  describe("3. Temporal Decay Bounds (Exponential Decay Invariants)", () => {
    it("3.1 reportTemporalWeight adheres strictly to 90-day half life formula across all intervals", () => {
      const refMs = Date.parse("2026-07-15T00:00:00Z");

      // 0 days
      expect(reportTemporalWeight("2026-07-15T00:00", refMs)).toBeCloseTo(1.0, 6);
      // 45 days (0.5 half-lives => 2^-0.5 ≈ 0.7071)
      const t45 = new Date(refMs - 45 * 24 * 3600 * 1000).toISOString().slice(0, 16);
      expect(reportTemporalWeight(t45, refMs)).toBeCloseTo(Math.pow(2, -0.5), 5);
      // 90 days (1 half-life => 0.5)
      const t90 = new Date(refMs - 90 * 24 * 3600 * 1000).toISOString().slice(0, 16);
      expect(reportTemporalWeight(t90, refMs)).toBeCloseTo(0.5, 6);
      // 180 days (2 half-lives => 0.25)
      const t180 = new Date(refMs - 180 * 24 * 3600 * 1000).toISOString().slice(0, 16);
      expect(reportTemporalWeight(t180, refMs)).toBeCloseTo(0.25, 6);
      // 270 days (3 half-lives => 0.125)
      const t270 = new Date(refMs - 270 * 24 * 3600 * 1000).toISOString().slice(0, 16);
      expect(reportTemporalWeight(t270, refMs)).toBeCloseTo(0.125, 6);
      // 360 days (4 half-lives => 0.0625)
      const t360 = new Date(refMs - 360 * 24 * 3600 * 1000).toISOString().slice(0, 16);
      expect(reportTemporalWeight(t360, refMs)).toBeCloseTo(0.0625, 6);
      // 730 days (~8.11 half-lives => ~0.003606)
      const t730 = new Date(refMs - 730 * 24 * 3600 * 1000).toISOString().slice(0, 16);
      expect(reportTemporalWeight(t730, refMs)).toBeCloseTo(Math.pow(2, -730 / 90), 6);
    });

    it("3.2 Future reports (delta < 0) clamp delta to 0 and return weight 1.0", () => {
      const refMs = Date.parse("2026-07-15T00:00:00Z");
      const futureTime = new Date(refMs + 30 * 24 * 3600 * 1000).toISOString().slice(0, 16);
      expect(reportTemporalWeight(futureTime, refMs)).toBe(1.0);
    });

    it("3.3 Invalid report timestamp returns 0, NaN reference time returns 1.0 fallback", () => {
      const refMs = Date.parse("2026-07-15T00:00:00Z");
      expect(reportTemporalWeight("invalid-date-string", refMs)).toBe(0);
      expect(reportTemporalWeight("2026-07-15T00:00", Number.NaN)).toBe(1.0);
    });

    it("3.4 1 fresh report (today, weight 1.0) overrides 1 ancient report from 180 days ago (weight 0.25)", () => {
      const freshIncoming: Report = {
        id: "fresh-inc",
        siteId: "s",
        time: "2026-07-15T03:00",
        direction: "incoming",
        strength: "strong",
      };
      const oldOutgoing: Report = {
        id: "old-outg",
        siteId: "s",
        time: "2026-01-16T03:00", // ~180 days ago
        direction: "outgoing",
        strength: "strong",
      };

      const forecast = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: [freshIncoming, oldOutgoing],
      });

      const hour = findHour(forecast, "2026-07-15T03:00");
      expect(hour).toBeDefined();
      // Fresh report weight (1.0) / (1.0 + 0.25) = 80.0% >= 60%
      expect(hour!.direction).toBe("incoming");
    });

    it("3.5 1 fresh report (weight 1.0) overrides 10 ancient reports from 360 days ago (total weight 0.625)", () => {
      // 360 days ago: weight per report is 2^(-4) = 0.0625.
      // 10 reports * 0.0625 = 0.625.
      // Fresh report weight = 1.0.
      // Ratio = 1.0 / (1.0 + 0.625) = 1.0 / 1.625 ≈ 61.5% >= 60.0%
      const freshIncoming: Report = {
        id: "fresh-single",
        siteId: "s",
        time: "2026-07-15T03:00",
        direction: "incoming",
        strength: "strong",
      };
      const ancientOutgoing10: Report[] = Array.from({ length: 10 }, (_, i) => ({
        id: `anc-${i}`,
        siteId: "s",
        time: "2025-07-20T03:00", // ~360 days ago
        direction: "outgoing",
        strength: "strong",
      }));

      const forecast = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: [freshIncoming, ...ancientOutgoing10],
      });

      const hour = findHour(forecast, "2026-07-15T03:00");
      expect(hour).toBeDefined();
      // 1 fresh report successfully wins consensus over 10 1-year-old reports
      expect(hour!.direction).toBe("incoming");
    });

    it("3.6 1 fresh report (weight 1.0) completely dampens 50 2-year-old reports (730 days ago, total weight ≈ 0.18)", () => {
      // 730 days ago: weight per report is 2^(-730/90) ≈ 0.003606
      // 50 reports * 0.003606 ≈ 0.1803
      // Consensus ratio = 1.0 / (1.0 + 0.1803) ≈ 84.7% >= 60%
      const freshIncoming: Report = {
        id: "fresh-dom",
        siteId: "s",
        time: "2026-07-15T03:00",
        direction: "incoming",
        strength: "strong",
      };
      const ancient50: Report[] = Array.from({ length: 50 }, (_, i) => ({
        id: `anc-50-${i}`,
        siteId: "s",
        time: "2024-07-15T03:00", // exactly 730 days ago
        direction: "outgoing",
        strength: "too_strong",
      }));

      const forecast = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: [freshIncoming, ...ancient50],
      });

      const hour = findHour(forecast, "2026-07-15T03:00");
      expect(hour).toBeDefined();
      expect(hour!.direction).toBe("incoming");
    });

    it("3.7 Reference time anchor is deterministic relative to hours[0].time regardless of live execution date", () => {
      // Test two series anchored in 2024: results should be identical regardless of when test executes
      const series2024 = makeMarineSeries("2024-01-01T00:00", 24);
      const repA: Report = { id: "a", siteId: "s", time: "2023-10-03T03:00", direction: "incoming", strength: "strong" };
      const repB: Report = { id: "b", siteId: "s", time: "2023-07-05T03:00", direction: "outgoing", strength: "mild" };

      const res1 = forecastHours({ hours: series2024, inwardBearingDeg: 90, reports: [repA, repB] });
      const res2 = forecastHours({ hours: series2024, inwardBearingDeg: 90, reports: [repA, repB] });

      for (let i = 0; i < res1.length; i++) {
        expect(res1[i].direction).toBe(res2[i].direction);
        expect(res1[i].strength).toBe(res2[i].strength);
        expect(res1[i].confidence).toBe(res2[i].confidence);
      }
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 4. Hard Confidence Invariant under Outliers
  // ────────────────────────────────────────────────────────────────────────────
  describe("4. Calibrated Confidence Scoring Under Contradiction & Outliers", () => {
    it("4.1 In 10 incoming vs 1 outgoing scenario: consensus picks incoming, but confidence is NEVER 'high'", () => {
      const incoming10: Report[] = Array.from({ length: 10 }, (_, i) => ({
        id: `inc-conf-${i}`,
        siteId: "s",
        time: "2026-07-15T03:00",
        direction: "incoming",
        strength: "strong",
      }));
      const outlier1: Report = {
        id: "out-conf-1",
        siteId: "s",
        time: "2026-07-15T03:00",
        direction: "outgoing",
        strength: "strong",
      };

      const forecast = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: [...incoming10, outlier1],
        allowHighConfidence: true,
      });

      const hour = findHour(forecast, "2026-07-15T03:00");
      expect(hour).toBeDefined();
      expect(hour!.direction).toBe("incoming");
      // Hard invariant: presence of 1 recent contradiction strictly caps confidence at medium/low
      expect(hour!.confidence).not.toBe("high");
      expect(["low", "medium"]).toContain(hour!.confidence);
    });

    it("4.2 Uncontested 5 concordant reports yield 'high' confidence, but adding 1 contradiction drops it immediately", () => {
      const concordantReports: Report[] = [
        { id: "c1", siteId: "s", time: "2026-07-15T01:00", direction: "incoming", strength: "strong" },
        { id: "c2", siteId: "s", time: "2026-07-15T02:00", direction: "incoming", strength: "strong" },
        { id: "c3", siteId: "s", time: "2026-07-15T03:00", direction: "incoming", strength: "strong" },
        { id: "c4", siteId: "s", time: "2026-07-15T04:00", direction: "incoming", strength: "strong" },
        { id: "c5", siteId: "s", time: "2026-07-15T05:00", direction: "incoming", strength: "strong" },
      ];

      const forecastClean = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: concordantReports,
        allowHighConfidence: true,
      });
      const hourClean = findHour(forecastClean, "2026-07-15T03:00");
      expect(hourClean).toBeDefined();
      expect(hourClean!.confidence).toBe("high");

      // Now add 1 contradiction at same hour
      const noisyReport: Report = {
        id: "noise",
        siteId: "s",
        time: "2026-07-15T03:00",
        direction: "outgoing",
        strength: "strong",
      };

      const forecastContaminated = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: [...concordantReports, noisyReport],
        allowHighConfidence: true,
      });
      const hourContaminated = findHour(forecastContaminated, "2026-07-15T03:00");
      expect(hourContaminated).toBeDefined();
      expect(hourContaminated!.confidence).not.toBe("high");
      expect(["low", "medium"]).toContain(hourContaminated!.confidence);
    });

    it("4.3 Contradiction older than 7 days does NOT block 'high' confidence for fresh concordant reports", () => {
      // 5 fresh agreeing reports today
      const concordantToday: Report[] = [
        { id: "ct-1", siteId: "s", time: "2026-07-15T01:00", direction: "incoming", strength: "strong" },
        { id: "ct-2", siteId: "s", time: "2026-07-15T02:00", direction: "incoming", strength: "strong" },
        { id: "ct-3", siteId: "s", time: "2026-07-15T03:00", direction: "incoming", strength: "strong" },
        { id: "ct-4", siteId: "s", time: "2026-07-15T04:00", direction: "incoming", strength: "strong" },
        { id: "ct-5", siteId: "s", time: "2026-07-15T05:00", direction: "incoming", strength: "strong" },
      ];

      // Contradiction from 14 days ago (> 7 days)
      const oldContradiction: Report = {
        id: "old-contra",
        siteId: "s",
        time: "2026-07-01T03:00",
        direction: "outgoing",
        strength: "strong",
      };

      const forecast = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: [...concordantToday, oldContradiction],
        allowHighConfidence: true,
      });

      const hour = findHour(forecast, "2026-07-15T03:00");
      expect(hour).toBeDefined();
      // Historical contradiction past 7-day boundary does not trigger recent contradiction invariant
      expect(hour!.confidence).toBe("high");
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 5. Turn Filtering, Fade Horizon & Robustness Boundaries
  // ────────────────────────────────────────────────────────────────────────────
  describe("5. Turn Boundary Filtering & Numerical Robustness", () => {
    it("5.1 Physical turn boundary: report on falling slope does NOT pull across slack turn onto rising slope", () => {
      // In 12h cycle:
      // Index 3 (03:00) is rising slope (+0.08m) -> incoming
      // Index 6 (06:00) is crest / turn -> slack
      // Index 9 (09:00) is falling slope (-0.08m) -> outgoing
      // A report at 07:00 (falling slope) is only 2 hours away from 05:00 (rising slope).
      // But because slopes are opposite, it must NOT pull direction across the turn.
      const ebbReport: Report = {
        id: "turn-ebb",
        siteId: "s",
        time: "2026-07-15T07:00",
        direction: "outgoing",
        strength: "too_strong",
      };

      const forecastWithReport = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: [ebbReport],
      });
      const forecastBaseline = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: [],
      });

      // Target hour 05:00 is rising tide (incoming)
      const test05 = findHour(forecastWithReport, "2026-07-15T05:00");
      const base05 = findHour(forecastBaseline, "2026-07-15T05:00");

      expect(test05).toBeDefined();
      expect(base05).toBeDefined();
      expect(test05!.direction).toBe(base05!.direction);
    });

    it("5.2 Fade horizon cutoff: report at t - 5.5h is active, report at t - 6.0h or future report is excluded", () => {
      const openHour = {
        time: "2026-07-15T06:00",
        direction: "incoming" as Direction,
        strength: "mild" as Strength,
        slope: 0.08,
        nudge: 0,
        index: 6,
        levelM: 0.9,
      };

      // 5.5 hours before 06:00 -> 00:30 (active)
      const repActive: Report = {
        id: "fade-active",
        siteId: "s",
        time: "2026-07-15T00:30",
        direction: "outgoing",
        strength: "strong",
        slopeM: 0.08,
      };
      // 6.0 hours before 06:00 -> 00:00 (excluded: sinceHours >= 6.0)
      const repExactCutoff: Report = {
        id: "fade-cutoff",
        siteId: "s",
        time: "2026-07-15T00:00",
        direction: "outgoing",
        strength: "strong",
        slopeM: 0.08,
      };
      // 1.0 hour in future relative to 06:00 -> 07:00 (excluded: sinceHours < 0)
      const repFuture: Report = {
        id: "fade-future",
        siteId: "s",
        time: "2026-07-15T07:00",
        direction: "outgoing",
        strength: "strong",
        slopeM: 0.08,
      };

      const classifiedActive = [classifyReport(repActive, hours)];
      const pullActive = aggregateReportPull(openHour as any, hours, classifiedActive);
      expect(pullActive.direction).toBe("outgoing");

      const classifiedCutoff = [classifyReport(repExactCutoff, hours)];
      const pullCutoff = aggregateReportPull(openHour as any, hours, classifiedCutoff);
      expect(pullCutoff.direction).toBe("incoming"); // unchanged

      const classifiedFuture = [classifyReport(repFuture, hours)];
      const pullFuture = aggregateReportPull(openHour as any, hours, classifiedFuture);
      expect(pullFuture.direction).toBe("incoming"); // unchanged
    });

    it("5.3 Strength shifting under consensus clamps safely between 'slack' and 'too_strong' without NaN", () => {
      // 5 reports of "too_strong" on a slack hour
      const extremeReports: Report[] = Array.from({ length: 5 }, (_, i) => ({
        id: `ext-${i}`,
        siteId: "s",
        time: "2026-07-15T03:00",
        direction: "incoming",
        strength: "too_strong",
      }));

      const forecast = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: extremeReports,
      });

      for (const h of forecast) {
        expect(STRENGTHS).toContain(h.strength);
        expect(Number.isFinite(h.levelM)).toBe(true);
        expect(Number.isNaN(h.levelM)).toBe(false);
      }
    });

    it("5.4 Malformed reports (null slopes, unusable fields) are filtered without crashing or corrupting forecast", () => {
      const malformedReports: Report[] = [
        { id: "m-1", siteId: "s", time: "not-a-date", direction: "incoming", strength: "strong" },
        { id: "m-2", siteId: "s", time: "2026-07-15T03:00", direction: "incoming", strength: "strong", slopeM: null },
      ];

      const forecast = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: malformedReports,
      });

      expect(forecast.length).toBeGreaterThan(0);
      for (const h of forecast) {
        expect(["incoming", "outgoing"]).toContain(h.direction);
        expect(STRENGTHS).toContain(h.strength);
        expect(["low", "medium", "high"]).toContain(h.confidence);
      }
    });
  });
});
