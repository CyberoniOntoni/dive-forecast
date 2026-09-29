import { describe, expect, it } from "vitest";
import { summarizeReports } from "./verify";
import type { ForecastAtReport, Report, Strength } from "./types";

function predicted(over: Partial<ForecastAtReport> = {}): ForecastAtReport {
  return {
    modelVersion: "m/1",
    nudge: "drift",
    issuedAt: 1,
    stale: false,
    bearingDeg: 90,
    bearingSource: "override",
    shown: { direction: "incoming", strength: "strong", confidence: "low" },
    modelOnly: { direction: "incoming", strength: "strong" },
    ...over,
  };
}

function report(direction: Report["direction"], strength: Strength, p?: ForecastAtReport): Report {
  return { id: crypto.randomUUID(), siteId: "s", time: "2026-09-27T08:00", direction, strength, ...(p ? { predicted: p } : {}) };
}

describe("summarizeReports", () => {
  it("leaves out reports with no saved prediction", () => {
    expect(summarizeReports([report("incoming", "strong")])).toEqual([]);
  });

  it("scores direction and strength for the shown and the model-alone predictions", () => {
    const [summary] = summarizeReports([
      report("incoming", "strong", predicted()),
      report("outgoing", "mild", predicted()),
      report("incoming", "too_strong", predicted({ shown: { direction: "incoming", strength: "strong", confidence: "low" }, modelOnly: { direction: "incoming", strength: "mild" } })),
    ]);
    expect(summary.reports).toBe(3);
    expect(summary.shown.directionN).toBe(3);
    expect(summary.shown.directionRight).toBe(2);
    expect(summary.shown.strengthExact).toBe(1);
    expect(summary.shown.tooStrong).toBe(1);
    expect(summary.shown.tooWeak).toBe(1);
    expect(summary.modelOnly.strengthWithinOne).toBe(2);
  });

  it("does not judge direction when either side says slack", () => {
    const slack = predicted({ shown: { direction: "outgoing", strength: "slack", confidence: "low" }, modelOnly: { direction: "outgoing", strength: "slack" } });
    const [summary] = summarizeReports([report("incoming", "strong", slack), report("incoming", "slack", predicted())]);
    expect(summary.shown.directionN).toBe(0);
    expect(summary.shown.n).toBe(2);
  });

  it("groups by model version and nudge setting", () => {
    const summaries = summarizeReports([
      report("incoming", "strong", predicted()),
      report("incoming", "strong", predicted({ modelVersion: "m/2" })),
      report("incoming", "strong", predicted({ nudge: "off" })),
    ]);
    expect(summaries.map((s) => `${s.modelVersion}|${s.nudge}`).sort()).toEqual(["m/1|drift", "m/1|off", "m/2|drift"]);
  });

  it("reports what always guessing the most common strength would score", () => {
    const [summary] = summarizeReports([
      report("incoming", "too_strong", predicted()),
      report("incoming", "too_strong", predicted()),
      report("incoming", "mild", predicted()),
      report("incoming", "strong", predicted()),
    ]);
    expect(summary.baselineExact).toBeCloseTo(0.5, 5);
  });
});
