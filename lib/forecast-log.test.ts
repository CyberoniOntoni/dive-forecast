import { describe, expect, it } from "vitest";
import { FORECAST_MODEL_VERSION, NUDGE_SOURCE } from "./forecast";
import { forecastAtReport } from "./forecast-log";
import type { SiteLoad } from "./load-site";
import type { HourForecast } from "./types";

function hour(time: string, direction: HourForecast["direction"], strength: HourForecast["strength"]): HourForecast {
  return { time, direction, strength, confidence: "low", levelM: 0.1 };
}

function load(hours: HourForecast[], extra: Partial<SiteLoad> = {}): SiteLoad {
  return {
    bearing: 284.6,
    bearingSource: "override",
    hours,
    unavailable: false,
    stale: false,
    fetchedAt: 1_790_000_000_000,
    ...extra,
  };
}

const shown = load([
  hour("2026-09-27T07:00", "incoming", "strong"),
  hour("2026-09-27T08:00", "incoming", "too_strong"),
]);
const modelOnly = load([
  hour("2026-09-27T07:00", "incoming", "mild"),
  hour("2026-09-27T08:00", "incoming", "strong"),
]);

describe("forecastAtReport", () => {
  it("saves what was shown and what the model alone said for the report hour", () => {
    const saved = forecastAtReport(shown, modelOnly, "2026-09-27T08:00");
    expect(saved).toEqual({
      modelVersion: FORECAST_MODEL_VERSION,
      nudge: NUDGE_SOURCE,
      issuedAt: 1_790_000_000_000,
      stale: false,
      bearingDeg: 285,
      bearingSource: "override",
      shown: { direction: "incoming", strength: "too_strong", confidence: "low" },
      modelOnly: { direction: "incoming", strength: "strong" },
    });
  });

  it("uses the nearest hour, so a report at 08:20 reads the 08:00 hour", () => {
    expect(forecastAtReport(shown, modelOnly, "2026-09-27T08:20")?.shown.strength).toBe("too_strong");
  });

  it("records that the data was stale and how the bearing was found", () => {
    const stale = load(shown.hours, { stale: true, bearingSource: "fallback" });
    const saved = forecastAtReport(stale, modelOnly, "2026-09-27T07:00");
    expect(saved?.stale).toBe(true);
    expect(saved?.bearingSource).toBe("fallback");
  });

  it("keeps the shown prediction when the model alone has no hour there", () => {
    const empty = load([]);
    const saved = forecastAtReport(shown, empty, "2026-09-27T08:00");
    expect(saved?.shown.strength).toBe("too_strong");
    expect(saved?.modelOnly).toBeNull();
  });

  it("saves nothing when there is no forecast hour within 90 minutes, or no bearing", () => {
    expect(forecastAtReport(shown, modelOnly, "2026-09-27T12:00")).toBeNull();
    expect(forecastAtReport(load([]), modelOnly, "2026-09-27T08:00")).toBeNull();
    expect(forecastAtReport(load(shown.hours, { bearing: null }), modelOnly, "2026-09-27T08:00")).toBeNull();
  });
});
