import { describe, expect, it } from "vitest";
import { forecastHours } from "./forecast";
import { replayReports } from "./replay";
import type { Direction, MarineHour, Report, Strength } from "./types";

const TARGET = "2026-09-23T13:00";
const hours = fixedSeries();
const earlier = earlierReports();

describe("replayReports", () => {
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
