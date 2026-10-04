import { parseWall } from "./forecast";
import { loadSite } from "./load-site";
import { readCatalog, reportsForSite } from "./store";
import type { Atoll, BearingSource, ForecastRoute, HourForecast, Site } from "./types";

export type SiteNowcast = {
  siteId: string;
  atollId: string;
  /** Null when the site has no atoll, so there is no arrow to point. */
  inwardBearingDeg: number | null;
  /** The outgoing arrow's heading at a curved channel (Site.outgoingBearingDeg); null when outgoing is opposite incoming. */
  outgoingBearingDeg: number | null;
  /** Where the bearing came from. Absent or null draws no estimate note. */
  bearingSource?: BearingSource | null;
  /** Which model made the hours, and so how their direction reads. */
  forecastRoute: ForecastRoute;
  /** Set on every route but "channel": the heading its "incoming" means. */
  alongHeadingDeg?: number | null;
  hour: HourForecast | null;
  unavailable: boolean;
  /** True when this hour is the last cached series. */
  stale?: boolean;
  /** Unix ms when the marine series was fetched. Null when there is no hour. */
  fetchedAt?: number | null;
};

const MAX_NOWCAST_DELTA_MS = 90 * 60 * 1000;

/** Closest hour to a Maldives wall clock. Equal distance keeps the earlier hour. Farther than 90 minutes is none. */
export function nearestForecastHour(
  hours: readonly HourForecast[],
  maldivesWall: string,
): HourForecast | null {
  if (hours.length === 0) return null;
  const target = parseWall(maldivesWall);
  if (Number.isNaN(target)) return null;

  let closest: HourForecast | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const hour of hours) {
    const hourMs = parseWall(hour.time);
    if (Number.isNaN(hourMs)) continue;
    const distance = Math.abs(hourMs - target);
    if (distance < closestDistance) {
      closest = hour;
      closestDistance = distance;
    }
  }
  if (closestDistance > MAX_NOWCAST_DELTA_MS) return null;
  return closest;
}

export async function nowcastSites(
  sites: readonly Site[],
  atolls: readonly Atoll[],
  maldivesWall: string,
): Promise<SiteNowcast[]> {
  const atollById = new Map(atolls.map((atoll) => [atoll.id, atoll]));
  // The map list can include a pin the diver just added. The centroid uses the published catalog.
  const mates = readCatalog().sites;
  return Promise.all(sites.map((site) => nowcastOne(site, mates, atollById.get(site.atollId), maldivesWall)));
}

async function nowcastOne(
  site: Site,
  mates: readonly Site[],
  atoll: Atoll | undefined,
  maldivesWall: string,
): Promise<SiteNowcast> {
  // The map never waits for a first fetch: a site with no cache yet shows no forecast until its fetch lands.
  const loaded = await loadSite(site, mates, atoll, reportsForSite(site.id), { wait: false });
  const hour = nearestForecastHour(loaded.hours, maldivesWall);
  const hasHours = loaded.hours.length > 0;
  return {
    siteId: site.id,
    atollId: site.atollId,
    inwardBearingDeg: loaded.bearing,
    outgoingBearingDeg: site.outgoingBearingDeg ?? null,
    bearingSource: loaded.bearingSource,
    forecastRoute: loaded.forecastRoute,
    alongHeadingDeg: loaded.alongHeadingDeg,
    hour: hasHours ? hour : null,
    unavailable: !hasHours,
    stale: hasHours && loaded.stale,
    fetchedAt: hasHours ? loaded.fetchedAt : null,
  };
}