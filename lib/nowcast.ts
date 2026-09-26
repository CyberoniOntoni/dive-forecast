import { parseWall } from "./forecast";
import { loadSite } from "./load-site";
import { readCatalog, reportsForSite } from "./store";
import type { Atoll, HourForecast, Site } from "./types";

export type SiteNowcast = {
  siteId: string;
  atollId: string;
  inwardBearingDeg: number;
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
  const loaded = await loadSite(site, mates, atoll, reportsForSite(site.id));
  const hour = nearestForecastHour(loaded.hours, maldivesWall);
  const hasHours = loaded.hours.length > 0;
  return {
    siteId: site.id,
    atollId: site.atollId,
    // A missing atoll has no bearing. The pin still needs a number, and it draws no arrow.
    inwardBearingDeg: loaded.bearing ?? 0,
    hour: hasHours ? hour : null,
    unavailable: !hasHours,
    stale: hasHours && loaded.stale,
    fetchedAt: hasHours ? loaded.fetchedAt : null,
  };
}