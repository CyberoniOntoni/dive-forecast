import type { Atoll, Site } from "./types";

/** Degrees clockwise from north. Two or more seeded mates: pin toward their centroid. Otherwise outside toward the pin. */
export function inwardBearingDeg(
  site: Site,
  mates: readonly Site[],
  outside: { lat: number; lon: number },
): number {
  const seeded = mates.filter(
    (mate) => mate.id !== site.id && mate.atollId === site.atollId && mate.sourceUrl !== "user",
  );
  if (seeded.length >= 2) {
    const lat = seeded.reduce((sum, mate) => sum + mate.lat, 0) / seeded.length;
    const lon = seeded.reduce((sum, mate) => sum + mate.lon, 0) / seeded.length;
    return bearingClockwiseFromNorth(site.lat, site.lon, lat, lon);
  }
  return bearingClockwiseFromNorth(outside.lat, outside.lon, site.lat, site.lon);
}

function bearingClockwiseFromNorth(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaLon = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(deltaLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLon);
  const degrees = (Math.atan2(y, x) * 180) / Math.PI;
  return (degrees + 360) % 360;
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
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}
