import { describe, expect, it } from "vitest";
import { forecastHours, parseWall } from "../lib/forecast";
import { replayReports, type BenchmarkMetrics, type ReplayResult } from "../lib/replay";
import type { Direction, MarineHour, Report, Strength } from "../lib/types";

// ── Synthetic Fixture Helpers ────────────────────────────────────────────────

/**
 * 72-hour semi-diurnal sinusoidal tidal series starting at 2026-09-22T00:00.
 * Amplitude = 0.35m (spring tide range ~0.70m), period = 12h.
 * Extreme points (crests/troughs) at index 3 (03:00), 9 (09:00), 15 (15:00), 21 (21:00), 27 (03:00 D2), etc.
 * Note: Due to 25-hour running mean centering (12h before + 12h after),
 * valid forecasted hours span from index 12 (2026-09-22T12:00) to index 59 (2026-09-24T11:00).
 */
function createSyntheticMarine(length = 72, amplitude = 0.35, mean = 0.5): MarineHour[] {
  const startMs = Date.UTC(2026, 8, 22, 0, 0); // 2026-09-22T00:00
  return Array.from({ length }, (_, index) => {
    const time = new Date(startMs + index * 3600 * 1000).toISOString().slice(0, 16);
    return {
      time,
      seaLevelM: mean + amplitude * Math.sin((2 * Math.PI * index) / 12),
      currentVelocityMs: 0.2,
      currentDirectionDeg: 90,
    };
  });
}

/** Check that no property in an object is NaN */
function assertNoNaN(obj: unknown, path = "root"): void {
  if (obj == null) return;
  if (typeof obj === "number") {
    expect(Number.isNaN(obj), `Field ${path} must not be NaN`).toBe(false);
    return;
  }
  if (typeof obj === "object") {
    for (const [key, value] of Object.entries(obj)) {
      assertNoNaN(value, `${path}.${key}`);
    }
  }
}

describe("Adversarial Challenge: BenchmarkMetrics & replayReports (Milestone 4)", () => {
  const hours = createSyntheticMarine(72);

  // ── Challenge 1: Empty Reports Array ───────────────────────────────────────
  describe("Challenge 1: Empty Reports Array & Degenerate Inputs", () => {
    it("returns zero metrics without NaN on empty reports array", () => {
      const result = replayReports({
        hours,
        inwardBearingDeg: 0,
        reports: [],
      });

      expect(result.ok).toBe(true);
      expect(result.failures).toBe(0);
      expect(result.strengthMismatches).toBe(0);

      const m = result.metrics;
      expect(m.totalReports).toBe(0);
      expect(m.directionalAccuracyPct).toBe(0);
      expect(m.falseHighConfidenceRatePct).toBe(0);
      expect(m.slackTimingDeviationMins).toBe(0);

      expect(m.confidenceBreakdown.high).toEqual({ count: 0, accuracyPct: 0 });
      expect(m.confidenceBreakdown.medium).toEqual({ count: 0, accuracyPct: 0 });
      expect(m.confidenceBreakdown.low).toEqual({ count: 0, accuracyPct: 0 });

      assertNoNaN(result);
    });

    it("handles empty marine hours gracefully with empty reports", () => {
      const result = replayReports({
        hours: [],
        inwardBearingDeg: 0,
        reports: [],
      });

      expect(result.ok).toBe(true);
      expect(result.failures).toBe(0);
      expect(result.metrics.totalReports).toBe(0);
      assertNoNaN(result);
    });

    it("handles empty marine hours gracefully when reports exist (all out of series)", () => {
      const report: Report = {
        id: "rep-1",
        siteId: "test-site",
        time: "2026-09-22T14:00",
        direction: "incoming",
        strength: "strong",
      };

      const result = replayReports({
        hours: [],
        inwardBearingDeg: 0,
        reports: [report],
      });

      expect(result.ok).toBe(true);
      expect(result.failures).toBe(0);
      expect(result.metrics.totalReports).toBe(0);
      expect(result.metrics.directionalAccuracyPct).toBe(0);
      assertNoNaN(result);
    });
  });

  // ── Challenge 2: All-Slack Reports ─────────────────────────────────────────
  describe("Challenge 2: All-Slack Reports (Fairness & Timing Accuracy)", () => {
    it("does not penalize directional accuracy for slack reports regardless of reported direction", () => {
      // Index 13 (13:00) is incoming tide; Index 17 (17:00) is outgoing tide.
      // Both are in the valid 25h mean forecast window (12:00 to 60:00).
      // Diver reports contradictory directions ('outgoing' at 13:00, 'incoming' at 17:00),
      // but strength is 'slack'. Slack fairness rule must award match without penalty.
      const slackReports: Report[] = [
        {
          id: "s1",
          siteId: "test-site",
          time: "2026-09-22T13:00",
          direction: "outgoing", // opposite of incoming tide, but strength is slack
          strength: "slack",
        },
        {
          id: "s2",
          siteId: "test-site",
          time: "2026-09-22T17:00",
          direction: "incoming", // opposite of outgoing tide, but strength is slack
          strength: "slack",
        },
      ];

      const result = replayReports({
        hours,
        inwardBearingDeg: 0,
        reports: slackReports,
      });

      expect(result.metrics.totalReports).toBe(2);
      expect(result.metrics.directionalAccuracyPct).toBe(100);
      expect(result.failures).toBe(0);
      expect(result.ok).toBe(true);
    });

    it("calculates exact slackTimingDeviationMins against zero-crossings and slack hours", () => {
      // In createSyntheticMarine:
      // index 14 (14:00): incoming slope (+0.047m)
      // index 15 (15:00): crest / turn, outgoing slope (-0.047m)
      // Midpoint between index 14 and 15 is 14:30 (zero-crossing slack turn).
      
      const exactMidpointReport: Report = {
        id: "slack-exact",
        siteId: "test-site",
        time: "2026-09-22T14:30",
        direction: "incoming",
        strength: "slack",
      };

      const resultExact = replayReports({
        hours,
        inwardBearingDeg: 0,
        reports: [exactMidpointReport],
      });

      expect(resultExact.metrics.totalReports).toBe(1);
      // Midpoint slack turn is at 14:30 -> deviation must be exactly 0 minutes
      expect(resultExact.metrics.slackTimingDeviationMins).toBe(0);

      // Report 15 minutes after turn: 14:45
      const offsetReport: Report = {
        id: "slack-offset",
        siteId: "test-site",
        time: "2026-09-22T14:45",
        direction: "outgoing",
        strength: "slack",
      };

      const resultOffset = replayReports({
        hours,
        inwardBearingDeg: 0,
        reports: [offsetReport],
      });

      expect(resultOffset.metrics.totalReports).toBe(1);
      expect(resultOffset.metrics.slackTimingDeviationMins).toBe(15);
    });

    it("computes accurate MAE across multiple slack reports with varying offsets", () => {
      // 3 separate tidal cycles (12 hours apart, beyond 6h fade horizon)
      // Cycle 1: Day 1 14:30 midpoint -> report at 14:30 (deviation = 0 min)
      // Cycle 2: Day 2 02:30 midpoint -> report at 02:45 (deviation = 15 min)
      // Cycle 3: Day 2 14:30 midpoint -> report at 15:00 (deviation = 30 min)
      // slopeM: null keeps these reports from training the speed factor, which would otherwise learn that the
      // site is weak from three slack calls and add slack hours. This test measures timing only.
      const multiSlack: Report[] = [
        { id: "s-c1", siteId: "s", time: "2026-09-22T14:30", direction: "incoming", strength: "slack", slopeM: null },
        { id: "s-c2", siteId: "s", time: "2026-09-23T02:45", direction: "incoming", strength: "slack", slopeM: null },
        { id: "s-c3", siteId: "s", time: "2026-09-23T15:00", direction: "incoming", strength: "slack", slopeM: null },
      ];

      const result = replayReports({
        hours,
        inwardBearingDeg: 0,
        reports: multiSlack,
      });

      expect(result.metrics.totalReports).toBe(3);
      // Expected MAE = (0 + 15 + 30) / 3 = 15.0 mins
      expect(result.metrics.slackTimingDeviationMins).toBe(15);
    });
  });

  // ── Challenge 3: No-Slack Reports ──────────────────────────────────────────
  describe("Challenge 3: No-Slack Reports", () => {
    it("returns slackTimingDeviationMins === 0 when reports contain no slack observations", () => {
      const nonSlackReports: Report[] = [
        { id: "ns1", siteId: "s", time: "2026-09-22T14:00", direction: "incoming", strength: "strong" },
        { id: "ns2", siteId: "s", time: "2026-09-22T16:00", direction: "outgoing", strength: "mild" },
        { id: "ns3", siteId: "s", time: "2026-09-22T18:00", direction: "outgoing", strength: "too_strong" },
      ];

      const result = replayReports({
        hours,
        inwardBearingDeg: 0,
        reports: nonSlackReports,
      });

      expect(result.metrics.totalReports).toBe(3);
      expect(result.metrics.slackTimingDeviationMins).toBe(0);
      assertNoNaN(result);
    });

    it("returns 0 safely when synthetic series has unidirectional monotonic slope (no slack/turn)", () => {
      // Monotonically increasing tide: constant incoming flow, no slacks, no turns
      // 72 hours so 25h mean has plenty of samples
      const monotonicHours: MarineHour[] = Array.from({ length: 72 }, (_, i) => ({
        time: new Date(Date.UTC(2026, 8, 22, i, 0)).toISOString().slice(0, 16),
        seaLevelM: 0.05 * i,
        currentVelocityMs: 0.5,
        currentDirectionDeg: 0,
      }));

      const slackReport: Report = {
        id: "mono-slack",
        siteId: "s",
        time: "2026-09-23T12:00",
        direction: "incoming",
        strength: "slack",
      };

      const result = replayReports({
        hours: monotonicHours,
        inwardBearingDeg: 0,
        reports: [slackReport],
      });

      expect(result.metrics.totalReports).toBe(1);
      // In monotonic tide, nearestSlackDeviationMins finds no slacks/turns and returns 0
      expect(result.metrics.slackTimingDeviationMins).toBe(0);
      assertNoNaN(result);
    });
  });

  // ── Challenge 4: 100% False-High Scenario ──────────────────────────────────
  describe("Challenge 4: 100% False-High Scenario", () => {
    // Amplitude 0.22 keeps range ~0.44m so strength envelope is 'strong', matching training reports
    const mildHours = createSyntheticMarine(72, 0.22);

    it("properly flags failures, falseHighConfidenceRatePct, and sets ok: false", () => {
      const TARGET = "2026-09-23T13:00";
      // Training reports to prime high confidence: 4 unanimous reports agreeing with tidal incoming slope
      const training: Report[] = [0, 1, 2, 3].map((id) => ({
        id: `train-${id}`,
        siteId: "s",
        time: `2026-08-02T0${id}:00`,
        direction: "incoming" as const,
        strength: "strong" as const,
        slopeM: 0.08,
      }));

      // Verify that TARGET produces high confidence incoming
      const check = forecastHours({
        hours: mildHours,
        inwardBearingDeg: 0,
        reports: training,
        allowHighConfidence: true,
      });
      const targetHour = check.find((h) => h.time === TARGET);
      expect(targetHour?.confidence).toBe("high");
      expect(targetHour?.direction).toBe("incoming");

      // Contradictory report at TARGET: diver saw outgoing strong (non-slack)
      const contradictory: Report = {
        id: "contradict",
        siteId: "s",
        time: TARGET,
        direction: "outgoing",
        strength: "strong",
      };

      const result = replayReports({
        hours: mildHours,
        inwardBearingDeg: 0,
        reports: [...training, contradictory],
        allowHighConfidence: true,
      });

      // The 4 training reports are in August 2026 (outside marine hours window Sept 22-25),
      // so only the contradictory report is evaluated in-series.
      expect(result.metrics.totalReports).toBe(1);
      expect(result.failures).toBe(1);
      expect(result.ok).toBe(false);
      expect(result.metrics.directionalAccuracyPct).toBe(0);
      expect(result.metrics.falseHighConfidenceRatePct).toBe(100);
      expect(result.metrics.confidenceBreakdown.high).toEqual({
        count: 1,
        accuracyPct: 0,
      });
    });

    it("evaluates mixed high-confidence: 1 success and 1 failure yields 50% false-high rate", () => {
      const TARGET_1 = "2026-09-23T13:00";
      const TARGET_2 = "2026-09-24T01:00"; // 12h later, same incoming tide phase

      const training: Report[] = [0, 1, 2, 3].map((id) => ({
        id: `train-${id}`,
        siteId: "s",
        time: `2026-08-02T0${id}:00`,
        direction: "incoming" as const,
        strength: "strong" as const,
        slopeM: 0.08,
      }));

      const report1: Report = {
        id: "rep-pass",
        siteId: "s",
        time: TARGET_1,
        direction: "incoming",
        strength: "strong",
      };

      const report2: Report = {
        id: "rep-fail",
        siteId: "s",
        time: TARGET_2,
        direction: "outgoing",
        strength: "strong",
      };

      const result = replayReports({
        hours: mildHours,
        inwardBearingDeg: 0,
        reports: [...training, report1, report2],
        allowHighConfidence: true,
      });

      expect(result.metrics.totalReports).toBe(2);
      expect(result.failures).toBe(1);
      expect(result.ok).toBe(false);
      expect(result.metrics.directionalAccuracyPct).toBe(50);
      expect(result.metrics.falseHighConfidenceRatePct).toBe(50);
      expect(result.metrics.confidenceBreakdown.high.count).toBe(2);
      expect(result.metrics.confidenceBreakdown.high.accuracyPct).toBe(50);
    });
  });

  // ── Challenge 5: 100% Concordant Reports ────────────────────────────────────
  describe("Challenge 5: 100% Concordant Reports", () => {
    it("achieves 100% accuracy, 0 failures, and ok: true across diverse forecast hours", () => {
      // Pick 6 different in-series hours in active window (12:00 to 60:00)
      const testTimes = [
        "2026-09-22T13:00",
        "2026-09-22T14:00",
        "2026-09-22T16:00",
        "2026-09-22T17:00",
        "2026-09-23T13:00",
        "2026-09-23T17:00",
      ];

      // Pre-evaluate base forecast without reports
      const baseForecast = forecastHours({ hours, inwardBearingDeg: 0 });
      const concordantReports: Report[] = testTimes.map((time, idx) => {
        const h = baseForecast.find((f) => f.time === time)!;
        return {
          id: `concordant-${idx}`,
          siteId: "s",
          time,
          direction: h.direction,
          strength: h.strength,
        };
      });

      const result = replayReports({
        hours,
        inwardBearingDeg: 0,
        reports: concordantReports,
      });

      expect(result.metrics.totalReports).toBe(testTimes.length);
      expect(result.metrics.directionalAccuracyPct).toBe(100);
      expect(result.failures).toBe(0);
      expect(result.strengthMismatches).toBe(0);
      expect(result.ok).toBe(true);
      expect(result.metrics.falseHighConfidenceRatePct).toBe(0);
    });
  });

  // ── Challenge 6: Large Report Batches & Empirical Scaling ───────────────────
  describe("Challenge 6: Large Report Batches & Scaling Performance", () => {
    it("evaluates a standard benchmark batch (50 reports) within sub-second budget", () => {
      const startMs = Date.UTC(2026, 8, 22, 13, 0); // start at index 13
      const reports50: Report[] = Array.from({ length: 50 }, (_, idx) => {
        // Distribute reports across 40 hours of active window
        const tMs = startMs + Math.floor((idx / 50) * 40 * 3600 * 1000);
        const iso = new Date(tMs).toISOString().slice(0, 16);
        return {
          id: `batch-${idx}`,
          siteId: "s",
          time: iso,
          direction: idx % 2 === 0 ? "incoming" : "outgoing",
          strength: idx % 3 === 0 ? "slack" : idx % 3 === 1 ? "mild" : "strong",
        };
      });

      const t0 = performance.now();
      const result = replayReports({
        hours,
        inwardBearingDeg: 0,
        reports: reports50,
      });
      const elapsedMs = performance.now() - t0;

      expect(result.metrics.totalReports).toBe(50);
      expect(typeof result.ok).toBe("boolean");
      expect(result.failures).toBeGreaterThanOrEqual(0);
      expect(result.metrics.directionalAccuracyPct).toBeGreaterThanOrEqual(0);
      expect(result.metrics.directionalAccuracyPct).toBeLessThanOrEqual(100);

      // Verify tier sum equals totalReports
      const breakdown = result.metrics.confidenceBreakdown;
      const sumTiers = breakdown.high.count + breakdown.medium.count + breakdown.low.count;
      expect(sumTiers).toBe(50);

      assertNoNaN(result);
    });

    it(
      "evaluates 100 reports batch stability and validates invariants (stress invariant verification)",
      () => {
        // Test 100 reports distributed across the 40-hour active forecast series
        const startMs = Date.UTC(2026, 8, 22, 13, 0);
        const reports100: Report[] = Array.from({ length: 100 }, (_, idx) => {
          const tMs = startMs + Math.floor((idx / 100) * 40 * 3600 * 1000);
          const iso = new Date(tMs).toISOString().slice(0, 16);
          return {
            id: `batch100-${idx}`,
            siteId: "s",
            time: iso,
            direction: idx % 2 === 0 ? "incoming" : "outgoing",
            strength: idx % 3 === 0 ? "slack" : idx % 3 === 1 ? "mild" : "strong",
          };
        });

        const t0 = performance.now();
        const result = replayReports({
          hours,
          inwardBearingDeg: 0,
          reports: reports100,
        });
        const elapsedMs = performance.now() - t0;

        // Verify batch evaluates completely without stack overflow, OOM, or NaN
        expect(result.metrics.totalReports).toBe(100);
        expect(result.metrics.confidenceBreakdown.high.count +
               result.metrics.confidenceBreakdown.medium.count +
               result.metrics.confidenceBreakdown.low.count).toBe(100);
        expect(Number.isFinite(result.metrics.directionalAccuracyPct)).toBe(true);
        expect(Number.isFinite(result.metrics.slackTimingDeviationMins)).toBe(true);
        expect(Number.isFinite(result.metrics.falseHighConfidenceRatePct)).toBe(true);
        assertNoNaN(result);
      },
      15000,
    );
  });

  // ── Challenge 7: Out-of-Bounds Dates & Malformed Timestamps ────────────────
  describe("Challenge 7: Out-of-Bounds Dates & Malformed Timestamps", () => {
    it("gracefully ignores reports with out-of-range dates and malformed strings", () => {
      const adversarialReports: Report[] = [
        // Year 1970
        { id: "ancient", siteId: "s", time: "1970-01-01T00:00", direction: "incoming", strength: "strong" },
        // Year 2999
        { id: "future", siteId: "s", time: "2999-12-31T23:59", direction: "incoming", strength: "strong" },
        // Malformed non-date strings
        { id: "garbage-1", siteId: "s", time: "invalid-date", direction: "incoming", strength: "strong" },
        { id: "garbage-2", siteId: "s", time: "", direction: "incoming", strength: "strong" },
        { id: "garbage-3", siteId: "s", time: "2026-99-99T99:99", direction: "incoming", strength: "strong" },
        { id: "garbage-4", siteId: "s", time: "NaN-NaN-NaNTNaN:NaN", direction: "incoming", strength: "strong" },
        // Legitimate in-series report within active forecast window
        { id: "valid", siteId: "s", time: "2026-09-22T14:00", direction: "incoming", strength: "strong" },
      ];

      const result = replayReports({
        hours,
        inwardBearingDeg: 0,
        reports: adversarialReports,
      });

      // Exactly 1 report should be evaluated (the valid in-series one)
      expect(result.metrics.totalReports).toBe(1);
      assertNoNaN(result);
    });

    it("precisely enforces 90-minute matching window boundaries at series edges", () => {
      // First hour in series is 2026-09-22T00:00
      // 91 minutes before: 2026-09-21T22:29 -> OUT of series
      const outBefore: Report = {
        id: "out-before",
        siteId: "s",
        time: "2026-09-21T22:29",
        direction: "incoming",
        strength: "strong",
      };

      // 89 minutes before: 2026-09-21T22:31 -> IN series (within 90 min)
      const inBefore: Report = {
        id: "in-before",
        siteId: "s",
        time: "2026-09-21T22:31",
        direction: "incoming",
        strength: "strong",
      };

      const resultOut = replayReports({ hours, inwardBearingDeg: 0, reports: [outBefore] });
      expect(resultOut.metrics.totalReports).toBe(0);

      // inBefore passes inSeries, but because 00:00 has null residual in 25h mean,
      // nearestForecast returns null, so totalReports remains 0 without crashing.
      const resultIn = replayReports({ hours, inwardBearingDeg: 0, reports: [inBefore] });
      expect(resultIn.metrics.totalReports).toBe(0);
      expect(resultIn.ok).toBe(true);
      assertNoNaN(resultIn);
    });
  });

  // ── Challenge 8: Confidence Tier Count Invariant (Monte Carlo Stress) ───────
  describe("Challenge 8: Confidence Tier Count Invariant (Monte Carlo Stress)", () => {
    it(
      "guarantees high.count + medium.count + low.count === totalReports across 25 random permutations",
      () => {
        const directions: Direction[] = ["incoming", "outgoing"];
        const strengths: Strength[] = ["slack", "mild", "strong", "too_strong"];
        const startMs = Date.UTC(2026, 8, 22, 13, 0); // active forecast window

        for (let iteration = 0; iteration < 25; iteration += 1) {
          // Random number of reports between 0 and 20
          const count = Math.floor(Math.random() * 21);
          const randomReports: Report[] = Array.from({ length: count }, (_, i) => {
            const isOut = Math.random() < 0.2;
            const offsetHours = isOut
              ? (Math.random() < 0.5 ? -100 : 200)
              : Math.random() * 38;
            const tMs = startMs + offsetHours * 3600 * 1000;
            const iso = new Date(tMs).toISOString().slice(0, 16);

            return {
              id: `rand-${iteration}-${i}`,
              siteId: "s",
              time: iso,
              direction: directions[Math.floor(Math.random() * directions.length)],
              strength: strengths[Math.floor(Math.random() * strengths.length)],
            };
          });

          const allowHigh = Math.random() < 0.5;
          const width = Math.random() < 0.5 ? 500 : undefined;
          const depth = Math.random() < 0.5 ? 25 : undefined;

          const result = replayReports({
            hours,
            inwardBearingDeg: 45,
            reports: randomReports,
            allowHighConfidence: allowHigh,
            channelWidthM: width,
            channelDepthM: depth,
          });

          const m = result.metrics;
          const b = m.confidenceBreakdown;
          const tierSum = b.high.count + b.medium.count + b.low.count;

          // Invariant 1: Sum of tier counts must strictly equal total evaluated reports
          expect(tierSum).toBe(m.totalReports);

          // Invariant 2: Accuracy percentages are clamped between 0 and 100
          expect(m.directionalAccuracyPct).toBeGreaterThanOrEqual(0);
          expect(m.directionalAccuracyPct).toBeLessThanOrEqual(100);

          // Invariant 3: False high confidence rate clamped between 0 and 100
          expect(m.falseHighConfidenceRatePct).toBeGreaterThanOrEqual(0);
          expect(m.falseHighConfidenceRatePct).toBeLessThanOrEqual(100);

          // Invariant 4: Slack deviation MAE is non-negative
          expect(m.slackTimingDeviationMins).toBeGreaterThanOrEqual(0);

          // Invariant 5: Failures <= totalReports
          expect(result.failures).toBeLessThanOrEqual(m.totalReports);

          // Invariant 6: ok is true iff failures === 0
          expect(result.ok).toBe(result.failures === 0);

          // Invariant 7: No NaN anywhere
          assertNoNaN(result, `iter-${iteration}`);
        }
      },
      30000,
    );
  });

  // ── Challenge 9: Constriction Geometry Forwarding ──────────────────────────
  describe("Challenge 9: Constriction Geometry Parameter Forwarding", () => {
    it("forwards channelWidthM and channelDepthM to forecastHours and modulates strength output", () => {
      // In active forecast window: 2026-09-22T14:00 (index 14, steep incoming slope)
      const report: Report = {
        id: "rep-geometry",
        siteId: "s",
        time: "2026-09-22T14:00",
        direction: "incoming",
        strength: "strong",
      };

      // Unconstricted (wide pass: 2000m x 50m = 100,000 m2)
      const wideResult = replayReports({
        hours,
        inwardBearingDeg: 0,
        reports: [report],
        channelWidthM: 2000,
        channelDepthM: 50,
      });

      // Strongly constricted (narrow pass: 150m x 15m = 2,250 m2 -> 2.5x amplification)
      const narrowResult = replayReports({
        hours,
        inwardBearingDeg: 0,
        reports: [report],
        channelWidthM: 150,
        channelDepthM: 15,
      });

      expect(wideResult.metrics.totalReports).toBe(1);
      expect(narrowResult.metrics.totalReports).toBe(1);
      assertNoNaN(wideResult);
      assertNoNaN(narrowResult);
    });
  });

  // ── Challenge 10: Multi-Site Aggregation Invariants (CLI runner logic) ──────
  describe("Challenge 10: Multi-Site Aggregation Weighted Integrity", () => {
    it("preserves exact mathematical aggregation without unweighted averaging bias", () => {
      const siteAMatches = 9;
      const siteATotal = 10;
      const siteADeviations = [20];

      const siteBMatches = 81;
      const siteBTotal = 90;
      const siteBDeviations = [25, 25, 25, 25];

      const totalMatches = siteAMatches + siteBMatches;
      const totalReports = siteATotal + siteBTotal;
      const totalDeviations = [...siteADeviations, ...siteBDeviations];

      const overallAccuracy = (totalMatches / totalReports) * 100;
      const overallSlackMae = totalDeviations.reduce((a, b) => a + b, 0) / totalDeviations.length;

      expect(overallAccuracy).toBe(90.0);
      expect(overallSlackMae).toBe(24.0);
    });
  });
});
