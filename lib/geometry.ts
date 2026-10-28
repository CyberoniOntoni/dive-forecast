/** Geometry shared by server and browser code (no file reads). */

export type LatLon = { lat: number; lon: number };

/** How far along a segment (0 to 1) the foot of a point lies, given the point and the segment's end from its start. */
function alongSegment(px: number, py: number, dx: number, dy: number): number {
  const lengthSq = dx * dx + dy * dy;
  return lengthSq === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSq));
}

/** Closest point to `pin` on the segment from `from` to `to`, all in the same plane units. */
export function footOnSegment(
  pin: readonly [number, number],
  from: readonly [number, number],
  to: readonly [number, number],
): [number, number] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const along = alongSegment(pin[0] - from[0], pin[1] - from[1], dx, dy);
  return [from[0] + along * dx, from[1] + along * dy];
}

/** Great-circle distance between two points, km. */
export function distanceKm(a: LatLon, b: LatLon): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Length of a [lat, lon] polyline, km. */
export function polylineKm(points: readonly (readonly [number, number])[]): number {
  let total = 0;
  for (let index = 0; index + 1 < points.length; index += 1) {
    total += distanceKm(
      { lat: points[index][0], lon: points[index][1] },
      { lat: points[index + 1][0], lon: points[index + 1][1] },
    );
  }
  return total;
}

/** Initial great-circle bearing from a to b, degrees clockwise from north, in [0, 360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const startLat = toRadians(a.lat);
  const endLat = toRadians(b.lat);
  const deltaLon = toRadians(b.lon - a.lon);
  const east = Math.sin(deltaLon) * Math.cos(endLat);
  const north = Math.cos(startLat) * Math.sin(endLat) - Math.sin(startLat) * Math.cos(endLat) * Math.cos(deltaLon);
  const degrees = (Math.atan2(east, north) * 180) / Math.PI;
  return ((degrees % 360) + 360) % 360;
}
