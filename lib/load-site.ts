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

function forecastedLoad(
  bearing: number,
  marineHours: MarineHour[],
  reports: readonly Report[],
  fetchedAt: number,
): SiteLoad {
  const hours = forecastHours({ hours: marineHours, inwardBearingDeg: bearing, reports });
  return { bearing, hours, marineHours, unavailable: false, fetchedAt };
}

/** Inward bearing, marine fetch, one stale check, and forecast hours. A missing atoll is unavailable. */
export async function loadSite(
  site: Site,
  mates: readonly Site[],
  atoll: Atoll | undefined,
  reports: readonly Report[],
): Promise<SiteLoad> {
  if (!atoll) return unavailableLoad(null);

  const outside = { lat: atoll.oceanLat, lon: atoll.oceanLon };
  const bearing = inwardBearingDeg(site, mates, outside);
  const marine = await siteMarineHours(site.lat, site.lon, bearing, outside.lat, outside.lon);
  if (!marine.ok || marineSeriesStale(marine.hours)) return unavailableLoad(bearing);

  return forecastedLoad(bearing, marine.hours, reports, marine.fetchedAt);
}
