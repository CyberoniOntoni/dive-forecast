import { describe, expect, it } from "vitest";
import { nearestForecastHour, nowcastSites } from "./nowcast";
import { UNSEEDED_ATOLL_ID, type HourForecast } from "./types";

const hours: HourForecast[] = [
  {
    time: "2026-09-23T10:00",
    direction: "incoming",
    strength: "mild",
    confidence: "low",
    levelM: 0.1,
  },
  {
    time: "2026-09-23T11:00",
    direction: "outgoing",
    strength: "strong",
    confidence: "low",
    levelM: -0.1,
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

  // W8
  it("returns null when a lone hour is 3 hours away", () => {
    expect(nearestForecastHour(hours.slice(0, 1), "2026-09-23T13:00")).toBeNull();
  });
});

describe("nowcastSites", () => {
  it("gives a site with no atoll no bearing and no forecast", async () => {
    const pin = { id: "pin", name: "Pin", atollId: UNSEEDED_ATOLL_ID, lat: 5.2, lon: 72.95, sourceUrl: "user" };
    const [nowcast] = await nowcastSites([pin], [], "2026-09-23T10:00");
    expect(nowcast.inwardBearingDeg).toBeNull();
    expect(nowcast.bearingSource).toBeNull();
    expect(nowcast.unavailable).toBe(true);
    expect(nowcast.hour).toBeNull();
  });
});
