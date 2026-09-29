import { FORECAST_MODEL_VERSION, NUDGE_SOURCE } from "./forecast";
import type { SiteLoad } from "./load-site";
import { nearestForecastHour } from "./nowcast";
import type { ForecastAtReport } from "./types";

/**
 * The prediction to save with a report filed for `time` (Maldives wall time).
 * `shown` is the site's forecast with its earlier reports, as the page displays it; `modelOnly` is the same
 * site loaded with no reports. Null when there is no forecast hour within 90 minutes, so there is nothing to score.
 */
export function forecastAtReport(shown: SiteLoad, modelOnly: SiteLoad, time: string): ForecastAtReport | null {
  const hour = nearestForecastHour(shown.hours, time);
  if (!hour || shown.bearing == null) return null;
  const plain = nearestForecastHour(modelOnly.hours, time);
  return {
    modelVersion: FORECAST_MODEL_VERSION,
    nudge: NUDGE_SOURCE,
    issuedAt: shown.fetchedAt,
    stale: shown.stale,
    bearingDeg: Math.round(shown.bearing),
    bearingSource: shown.bearingSource,
    shown: { direction: hour.direction, strength: hour.strength, confidence: hour.confidence },
    modelOnly: plain ? { direction: plain.direction, strength: plain.strength } : null,
  };
}
