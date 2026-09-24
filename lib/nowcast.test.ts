import { describe, expect, it } from "vitest";
import { nearestForecastHour } from "./nowcast";
import type { HourForecast } from "./types";

const hours: HourForecast[] = [
  {
    time: "2026-09-23T10:00",
    direction: "incoming",
    strength: "mild",
    confidence: "low",
  },
  {
    time: "2026-09-23T11:00",
    direction: "outgoing",
    strength: "strong",
    confidence: "low",
  },
];

describe("nearestForecastHour", () => {
  it("returns null when there are no hours", () => {
    expect(nearestForecastHour([], "2026-09-23T10:20")).toBeNull();
  });

  it("picks 10:00 at 10:20 and 11:00 at 10:40", () => {
    expect(nearestForecastHour(hours, "2026-09-23T10:20")?.time).toBe("2026-09-23T10:00");
    expect(nearestForecastHour(hours, "2026-09-23T10:40")?.time).toBe("2026-09-23T11:00");
  });
});
