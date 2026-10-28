import { bearingDeg, distanceKm } from "./geometry";
import { CHANNEL_RIM_REACH_KM, rimDistanceKm, rimFilePresent, rimForAtoll, rimInwardBearing, type RimRing } from "./rim";
import type { Atoll, BearingSource, Site } from "./types";

/**
 * Degrees clockwise from north, with where it came from. A measured site bearing wins, then the atoll rim's
 * inward normal when the pin sits on the rim, then the mate-centroid heuristic.
 */
export function resolveBearing(
  site: Site,
  mates: readonly Site[],
  outside: { lat: number; lon: number },
  rim: RimRing | null = null,
): { deg: number; source: BearingSource } {
  if (typeof site.inwardBearingDeg === "number" && Number.isFinite(site.inwardBearingDeg)) {
    return { deg: wrapDegrees(site.inwardBearingDeg), source: "override" };
  }
  // A pin set by hand as a channel may sit where the coarse outline says "lagoon"; it still takes its rim's normal.
  const channel =
    site.siteTypeSource === "manual" &&
    (site.siteType === "pass" || site.siteType === "channel-thila" || site.siteType === "corner");
  const fromRim = rim ? rimInwardBearing(site, rim, channel ? CHANNEL_RIM_REACH_KM : undefined) : null;
  if (fromRim != null) return { deg: fromRim, source: "rim-derived" };
  return { deg: heuristicBearing(site, mates, outside), source: "fallback" };
}

/** Degrees clockwise from north. */
export function inwardBearingDeg(
  site: Site,
  mates: readonly Site[],
  outside: { lat: number; lon: number },
  rim: RimRing | null = null,
): number {
  return resolveBearing(site, mates, outside, rim).deg;
}

/** Two or more seeded mates: pin toward their centroid. Otherwise outside toward the pin. */
function heuristicBearing(
  site: Site,
  mates: readonly Site[],
  outside: { lat: number; lon: number },
): number {
  const seeded = seededMates(site, mates);
  if (seeded.length >= 2) {
    const center = centroid(seeded);
    return bearingDeg(site, center);
  }
  return bearingDeg(outside, site);
}

function seededMates(site: Site, mates: readonly Site[]): Site[] {
  return mates.filter((mate) => isSeededMate(site, mate));
}

function isSeededMate(site: Site, mate: Site): boolean {
  const otherPin = mate.id !== site.id;
  const sameAtoll = mate.atollId === site.atollId;
  const published = mate.sourceUrl !== "user";
  return otherPin && sameAtoll && published;
}

function centroid(sites: readonly Site[]): { lat: number; lon: number } {
  let latSum = 0;
  let lonSum = 0;
  for (const site of sites) {
    latSum += site.lat;
    lonSum += site.lon;
  }
  return { lat: latSum / sites.length, lon: lonSum / sites.length };
}

/** A pin farther than this from every stored atoll outline is not in a seeded atoll. */
export const ATOLL_MATCH_KM = 5;

/**
 * The seeded atoll a new pin belongs to, or null when it is not in or near one.
 * Matches by distance to the stored outline, so a pin in an unseeded atoll is not handed to a far one.
 * Atolls that share an outline (North and South Ari) are split by the nearer ocean point.
 * Only with no rim file at all does it fall back to the nearest ocean point.
 */
export function atollForPin(lat: number, lon: number, atolls: Atoll[]): Atoll | null {
  const withRim = atolls.flatMap((atoll) => {
    const ring = rimForAtoll(atoll);
    return ring ? [{ atoll, km: rimDistanceKm({ lat, lon }, ring) }] : [];
  });
  if (!rimFilePresent()) return atolls.length > 0 ? nearestAtoll(lat, lon, atolls) : null;
  const close = withRim.filter((item) => item.km <= ATOLL_MATCH_KM);
  if (close.length === 0) return null;
  const best = Math.min(...close.map((item) => item.km));
  const tied = close.filter((item) => item.km - best < 1e-6).map((item) => item.atoll);
  return nearestAtoll(lat, lon, tied);
}

export function nearestAtoll(lat: number, lon: number, atolls: Atoll[]): Atoll {
  let best = atolls[0];
  let bestKm = Number.POSITIVE_INFINITY;
  for (const atoll of atolls) {
    const km = distanceKm({ lat, lon }, { lat: atoll.oceanLat, lon: atoll.oceanLon });
    if (km < bestKm) {
      best = atoll;
      bestKm = km;
    }
  }
  return best;
}

export function wrapDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}
