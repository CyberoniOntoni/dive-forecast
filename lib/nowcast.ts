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
};

/** Closest hour to a Maldives wall clock. Equal distance keeps the earlier hour. */
export function nearestForecastHour(
  hours: readonly HourForecast[],
  maldivesWall: string,
): HourForecast | null {
  if (hours.length === 0) return null;
  const target = parseWall(maldivesWall);
  if (Number.isNaN(target)) return null;

  let best: HourForecast | null = null;
  let bestAbs = Number.POSITIVE_INFINITY;
  for (const hour of hours) {
    const ms = parseWall(hour.time);
    if (Number.isNaN(ms)) continue;
    const delta = Math.abs(ms - target);
    if (delta < bestAbs) {
      best = hour;
      bestAbs = delta;
    }
  }
  return best;
}

export async function nowcastSites(
  sites: readonly Site[],
  atolls: readonly Atoll[],
  maldivesWall: string,
): Promise<SiteNowcast[]> {
  const atollById = new Map(atolls.map((atoll) => [atoll.id, atoll]));
  const mates = readCatalog().sites;
  return Promise.all(
    sites.map(async (site) => {
      const loaded = await loadSite(site, mates, atollById.get(site.atollId), reportsForSite(site.id));
      return {
        siteId: site.id,
        atollId: site.atollId,
        inwardBearingDeg: loaded.bearing ?? 0,
        hour: loaded.unavailable ? null : nearestForecastHour(loaded.hours, maldivesWall),
        unavailable: loaded.unavailable,
      };
    }),
  );
}
