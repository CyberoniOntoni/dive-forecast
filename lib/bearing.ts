import type { Atoll, Site } from "./types";

/** Degrees clockwise from north. Two or more seeded mates: pin toward their centroid. Otherwise outside toward the pin. */
export function inwardBearingDeg(
  site: Site,
  mates: readonly Site[],
  outside: { lat: number; lon: number },
): number {
  const seeded = seededMates(site, mates);
  if (seeded.length >= 2) {
    const center = centroid(seeded);
    return bearingClockwiseFromNorth(site.lat, site.lon, center.lat, center.lon);
  }
  return bearingClockwiseFromNorth(outside.lat, outside.lon, site.lat, site.lon);
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

function bearingClockwiseFromNorth(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const startLat = toRadians(lat1);
  const endLat = toRadians(lat2);
  const deltaLon = toRadians(lon2 - lon1);
  const east = Math.sin(deltaLon) * Math.cos(endLat);
  const north =
    Math.cos(startLat) * Math.sin(endLat) - Math.sin(startLat) * Math.cos(endLat) * Math.cos(deltaLon);
  const degrees = toDegrees(Math.atan2(east, north));
  return wrapDegrees(degrees);
}

export function nearestAtoll(lat: number, lon: number, atolls: Atoll[]): Atoll {
  let best = atolls[0];
  let bestKm = Number.POSITIVE_INFINITY;
  for (const atoll of atolls) {
    const km = haversineKm(lat, lon, atoll.oceanLat, atoll.oceanLon);
    if (km < bestKm) {
      best = atoll;
      bestKm = km;
    }
  }
  return best;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const startLat = toRadians(lat1);
  const endLat = toRadians(lat2);
  const haversine =
    Math.sin(dLat / 2) ** 2 + Math.cos(startLat) * Math.cos(endLat) * Math.sin(dLon / 2) ** 2;
  const chord = Math.min(1, Math.sqrt(haversine));
  return 2 * 6371 * Math.asin(chord);
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

export function wrapDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}
