import { describe, expect, it } from "vitest";
import { forecastHours } from "./forecast";
import { replayReports } from "./replay";
import type { Direction, MarineHour, Report, Strength } from "./types";

const TARGET = "2026-09-23T13:00";
const hours = fixedSeries();
const earlier = earlierReports();

describe("replayReports", () => {
  // ── Existing Baseline Regression Tests ────────────────────────────────────
  it("leaves the replay clean when the withheld report agrees", () => {
    const result = replayReports({
      hours,
      inwardBearingDeg: 0,
      reports: [...earlier, withheld("incoming", "strong")],
    });
    expect(result.ok).toBe(true);
    expect(result.failures).toBe(0);
    expect(result.strengthMismatches).toBe(0);
  });

  it("fails a high-confidence hour whose direction differs from the report", () => {
    const trained = forecastHours({ hours, inwardBearingDeg: 0, reports: earlier });
    const hour = trained.find((item) => item.time === TARGET);
    expect(hour?.confidence).toBe("high");
    expect(hour?.direction).toBe("incoming");

    const result = replayReports({
      hours,
      inwardBearingDeg: 0,
      reports: [...earlier, withheld("outgoing", "strong")],
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toBe(1);
  });

  it("counts a strength mismatch and does not fail", () => {
    const result = replayReports({
      hours,
      inwardBearingDeg: 0,
      reports: [...earlier, withheld("incoming", "mild")],
    });
    expect(result.ok).toBe(true);
    expect(result.failures).toBe(0);
    expect(result.strengthMismatches).toBe(1);
  });

  // ── Milestone 4 (F11): Quantitative Benchmark Metrics ──────────────────────
  describe("BenchmarkMetrics quantitative calculations", () => {
    it("produces full metrics payload with 100% directional accuracy on concordant reports", () => {
      const result = replayReports({
        hours,
        inwardBearingDeg: 0,
        reports: [...earlier, withheld("incoming", "strong")],
      });

      expect(result.metrics).toBeDefined();
      expect(result.metrics.totalReports).toBe(1);
      expect(result.metrics.directionalAccuracyPct).toBe(100);
      expect(result.metrics.falseHighConfidenceRatePct).toBe(0);
      expect(result.metrics.confidenceBreakdown.high.count).toBe(1);
      expect(result.metrics.confidenceBreakdown.high.accuracyPct).toBe(100);
      expect(
        result.metrics.confidenceBreakdown.high.count +
          result.metrics.confidenceBreakdown.medium.count +
          result.metrics.confidenceBreakdown.low.count,
      ).toBe(1);
    });

    it("tracks false-high-confidence rate when high confidence prediction fails", () => {
      const result = replayReports({
        hours,
        inwardBearingDeg: 0,
        reports: [...earlier, withheld("outgoing", "strong")],
      });

      expect(result.failures).toBe(1);
      expect(result.metrics.totalReports).toBe(1);
      expect(result.metrics.falseHighConfidenceRatePct).toBe(100); // 1 failure out of 1 evaluated report = 100%
      expect(result.metrics.confidenceBreakdown.high.count).toBe(1);
      expect(result.metrics.confidenceBreakdown.high.accuracyPct).toBe(0);
    });

    it("evaluates multiple in-series reports and tallies metrics across them", () => {
      const seriesReports: Report[] = [
        { id: "r1", siteId: "s", time: "2026-09-23T01:00", direction: "incoming", strength: "strong" },
        { id: "r2", siteId: "s", time: "2026-09-23T02:00", direction: "incoming", strength: "strong" },
        { id: "r3", siteId: "s", time: "2026-09-23T03:00", direction: "incoming", strength: "strong" },
        { id: "r4", siteId: "s", time: "2026-09-23T04:00", direction: "incoming", strength: "strong" },
        { id: "r5", siteId: "s", time: "2026-09-23T05:00", direction: "incoming", strength: "strong" },
      ];
      const result = replayReports({
        hours,
        inwardBearingDeg: 0,
        reports: seriesReports,
      });

      expect(result.metrics.totalReports).toBe(5);
      expect(result.metrics.directionalAccuracyPct).toBeGreaterThanOrEqual(0);
      expect(
        result.metrics.confidenceBreakdown.high.count +
          result.metrics.confidenceBreakdown.medium.count +
          result.metrics.confidenceBreakdown.low.count,
      ).toBe(5);
    });

    it("measures slackTimingDeviationMins accurately between report and slack turn", () => {
      // High/low water slack turn occurs near 09:00 in fixedSeries
      const slackReport: Report = {
        id: "slack-test",
        siteId: "s",
        time: "2026-09-23T08:45", // 15 minutes before 09:00 slack turn
        direction: "incoming",
        strength: "slack",
      };

      const result = replayReports({
        hours,
        inwardBearingDeg: 0,
        reports: [slackReport],
      });

      expect(result.metrics.totalReports).toBe(1);
      expect(result.metrics.slackTimingDeviationMins).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(result.metrics.slackTimingDeviationMins)).toBe(true);
      expect(result.metrics.slackTimingDeviationMins).toBeLessThanOrEqual(60);
    });

    it("leaves a slack report out of slack timing when the forecast has no slack or turn", () => {
      // A cubic rise leaves a residual that falls steadily: every shown hour is flowing out, with no slack and no turn.
      const start = Date.UTC(2026, 8, 22, 0, 0);
      const oneWay: MarineHour[] = Array.from({ length: 72 }, (_, index) => ({
        time: new Date(start + index * 60 * 60 * 1000).toISOString().slice(0, 16),
        seaLevelM: 0.001 * (index - 36) ** 3,
        currentVelocityMs: 0,
        currentDirectionDeg: 0,
      }));
      const shown = forecastHours({ hours: oneWay, inwardBearingDeg: 0 });
      expect(shown.length).toBeGreaterThan(0);
      expect(shown.every((hour) => hour.strength !== "slack" && hour.direction === "outgoing")).toBe(true);

      const result = replayReports({
        hours: oneWay,
        inwardBearingDeg: 0,
        reports: [{ id: "no-turn", siteId: "s", time: "2026-09-23T12:00", direction: "outgoing", strength: "slack" }],
      });

      expect(result.metrics.totalReports).toBe(1);
      expect(result.metrics.slackReports).toBe(0);
      expect(result.metrics.slackTimingDeviationMins).toBe(0);
    });

    it("evaluates slack condition reports without false directional penalties", () => {
      const slackOpposite: Report = {
        id: "slack-opp",
        siteId: "s",
        time: "2026-09-23T06:00",
        direction: "outgoing", // Arbitrary direction during slack
        strength: "slack",
      };

      const result = replayReports({
        hours,
        inwardBearingDeg: 0,
        reports: [slackOpposite],
      });

      expect(result.metrics.totalReports).toBe(1);
      expect(result.metrics.directionalAccuracyPct).toBe(100);
    });

    it("safely handles empty reports without NaN or divide-by-zero errors", () => {
      const result = replayReports({
        hours,
        inwardBearingDeg: 0,
        reports: [],
      });

      expect(result.ok).toBe(true);
      expect(result.failures).toBe(0);
      expect(result.metrics.totalReports).toBe(0);
      expect(result.metrics.directionalAccuracyPct).toBe(0);
      expect(result.metrics.slackTimingDeviationMins).toBe(0);
      expect(result.metrics.falseHighConfidenceRatePct).toBe(0);
      expect(result.metrics.confidenceBreakdown.high.count).toBe(0);
      expect(result.metrics.confidenceBreakdown.high.accuracyPct).toBe(0);
      expect(Number.isNaN(result.metrics.directionalAccuracyPct)).toBe(false);
    });

    it("safely ignores reports outside marine hours window", () => {
      const outsideReport: Report = {
        id: "outside",
        siteId: "s",
        time: "2020-01-01T00:00",
        direction: "incoming",
        strength: "strong",
      };

      const result = replayReports({
        hours,
        inwardBearingDeg: 0,
        reports: [outsideReport],
      });

      expect(result.ok).toBe(true);
      expect(result.failures).toBe(0);
      expect(result.metrics.totalReports).toBe(0);
    });
  });
});

function withheld(direction: Direction, strength: Strength): Report {
  return { id: "withheld", siteId: "s", time: TARGET, direction, strength };
}

function earlierReports(): Report[] {
  return [0, 1, 2, 3].map((id) => ({
    id: `earlier-${id}`,
    siteId: "s",
    time: `2026-08-02T0${id}:00`,
    direction: "incoming" as const,
    strength: "strong" as const,
    slopeM: 0.08,
  }));
}

/** Mild envelope: amplitude 0.22 keeps the day's residual range under 0.6 m. */
function fixedSeries(): MarineHour[] {
  const start = Date.UTC(2026, 8, 22, 0, 0);
  return Array.from({ length: 72 }, (_, index) => ({
    time: new Date(start + index * 60 * 60 * 1000).toISOString().slice(0, 16),
    seaLevelM: 0.25 + 0.22 * Math.sin((2 * Math.PI * index) / 12),
    currentVelocityMs: 0,
    currentDirectionDeg: 0,
  }));
}
