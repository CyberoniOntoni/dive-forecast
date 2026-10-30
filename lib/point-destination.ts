/** A boat destination picked on the map rather than a dive site: its id, read back, and its name. Browser-safe. */

import type { LatLon } from "./geometry";

/**
 * A destination picked on the map instead of a site: its id is "lat,lon" to five decimals (about a metre), so it fits
 * the Navigate tab's address and saved destination like a site id. No site id holds a comma.
 */
export function pointDestinationId(point: LatLon): string {
  return `${point.lat.toFixed(5)},${point.lon.toFixed(5)}`;
}

/** pointDestinationId read back, or null for a site id or anything off the globe. */
export function readPointDestination(id: string): LatLon | null {
  const match = /^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/.exec(id);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

/** "Point 4.1234° N, 73.5123° E": what a picked point is called on the panel. */
export function pointDestinationName(point: LatLon): string {
  const ns = point.lat < 0 ? "S" : "N";
  const ew = point.lon < 0 ? "W" : "E";
  return `Point ${Math.abs(point.lat).toFixed(4)}° ${ns}, ${Math.abs(point.lon).toFixed(4)}° ${ew}`;
}
