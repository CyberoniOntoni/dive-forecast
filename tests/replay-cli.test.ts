import { describe, expect, it } from "vitest";
import type { ReplayResult } from "../lib/replay";
import { combineReplayResults, parseCliArgs, runBenchmarkSuite } from "../scripts/replay";

// The benchmark runner behind `npm run replay`, run in process: these never write data/replay.json or
// data/benchmark-results.json (only main() does), so `npm test` leaves the tree clean.
describe("benchmark replay runner", () => {
  it("passes on the fixture reports and scores only the site asked for", () => {
    const all = runBenchmarkSuite(parseCliArgs(["--benchmark"]));
    expect(all.ok).toBe(true);
    expect(all.failures).toBe(0);
    expect(all.metrics.totalReports).toBeGreaterThan(0);

    const one = runBenchmarkSuite(parseCliArgs(["--benchmark", "--site", "miyaru-kandu"]));
    expect(one.siteResults.map((site) => site.siteId)).toEqual(["miyaru-kandu"]);
    expect(one.metrics.totalReports).toBe(9);
  });

  it("fails on a site that does not exist, so CI cannot pass on a typo", () => {
    const result = runBenchmarkSuite(parseCliArgs(["--benchmark", "--site", "non-existent-site-id"]));
    expect(result.siteResults).toHaveLength(0);
    expect(result.ok).toBe(false);
    expect(result.failures).toBe(1);
    expect(result.siteNotFound).toBe(true);
  });

  it("pools directional matches by report, not by averaging site accuracies", () => {
    const siteResult = (totalReports: number, directionalAccuracyPct: number): ReplayResult => ({
      ok: true,
      failures: 0,
      strengthMismatches: 0,
      metrics: {
        totalReports,
        directionalAccuracyPct,
        slackTimingDeviationMins: 0,
        slackReports: 0,
        falseHighConfidenceRatePct: 0,
        confidenceBreakdown: {
          high: { count: 0, accuracyPct: 0 },
          medium: { count: 0, accuracyPct: 0 },
          low: { count: totalReports, accuracyPct: directionalAccuracyPct },
        },
      },
    });
    // Site A: 1 of 2 right (50%). Site B: 72 of 90 right (80%). By report 73 / 92; a mean of sites would be 65%.
    const combined = combineReplayResults([siteResult(2, 50), siteResult(90, 80)]);
    expect(combined.metrics.totalReports).toBe(92);
    expect(combined.metrics.directionalAccuracyPct).toBeCloseTo((73 / 92) * 100, 2);
    expect(combined.metrics.confidenceBreakdown.low.count).toBe(92);
  });
});
