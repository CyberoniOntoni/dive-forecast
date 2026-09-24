import { inwardBearingDeg } from "./bearing";
import { forecastHours } from "./forecast";
import { marineSeriesStale, siteMarineHours } from "./marine";
import type { Atoll, HourForecast, MarineHour, Report, Site } from "./types";

export type SiteLoad = {
  bearing: number | null;
  hours: HourForecast[];
  marineHours: MarineHour[];
  unavailable: boolean;
  fetchedAt: number | null;
};

function unavailableLoad(bearing: number | null): SiteLoad {
  return { bearing, hours: [], marineHours: [], unavailable: true, fetchedAt: null };
}

/** Inward bearing, marine fetch, one stale check, and forecast hours. A missing atoll is unavailable. */
export async function loadSite(
  site: Site,
  mates: readonly Site[],
  atoll: Atoll | undefined,
  reports: readonly Report[],
): Promise<SiteLoad> {
  if (!atoll) return unavailableLoad(null);
  const bearing = inwardBearingDeg(site, mates, { lat: atoll.oceanLat, lon: atoll.oceanLon });
  const marine = await siteMarineHours(site.lat, site.lon, bearing, atoll.oceanLat, atoll.oceanLon);
  if (!marine.ok || marineSeriesStale(marine.hours)) return unavailableLoad(bearing);
  return {
    bearing,
    hours: forecastHours({ hours: marine.hours, inwardBearingDeg: bearing, reports }),
    marineHours: marine.hours,
    unavailable: false,
    fetchedAt: marine.fetchedAt,
  };
}
