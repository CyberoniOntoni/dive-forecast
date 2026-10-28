/**
 * Boat navigation helpers that run in the browser: speed and course over ground from GPS fixes, how far is left along
 * a route, and the words the panel shows. No file reads here; the route itself comes from lib/boat-route.ts.
 */

import { footOnSegment } from "./segment";

export type LatLon = { lat: number; lon: number };

/** One browser geolocation fix. `speedMs` and `headingDeg` are null when the device does not give them. */
export type Fix = LatLon & { timeMs: number; accuracyM: number; speedMs: number | null; headingDeg: number | null };

export const KM_PER_NM = 1.852;
const MS_PER_KNOT = KM_PER_NM / 3.6;

/** Fixes this old still count toward the speed worked out from positions. */
export const SPEED_WINDOW_MS = 30_000;
/** Positions this far apart in time at least, before a speed is worked out from them. */
const SPEED_MIN_SPAN_MS = 4_000;
/** Under this the boat counts as stopped: GPS drift, a drifting dhoni, no useful ETA. */
export const UNDERWAY_KNOTS = 2;
/** Cruising speeds the panel quotes while the boat is stopped: a dhoni and a speedboat. */
export const REFERENCE_KNOTS = [8, 20] as const;

/** Great-circle distance, km. */
export function distanceKm(a: LatLon, b: LatLon): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

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

/** Initial great-circle bearing from a to b, degrees clockwise from north. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const toRad = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * toRad) * Math.cos(b.lat * toRad);
  const x =
    Math.cos(a.lat * toRad) * Math.sin(b.lat * toRad) -
    Math.sin(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.cos((b.lon - a.lon) * toRad);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export type Motion = { knots: number; courseDeg: number | null };

/**
 * Speed and course over ground from the latest fixes. The device's own speed wins when it gives one; otherwise the
 * distance between the oldest fix in the last SPEED_WINDOW_MS and the newest, over the time between them. A move
 * smaller than the fixes' accuracy is drift, not way: speed 0. Null until there is enough to say.
 */
export function motionFrom(fixes: readonly Fix[]): Motion | null {
  const latest = fixes[fixes.length - 1];
  if (!latest) return null;
  const oldest = fixes.find((fix) => latest.timeMs - fix.timeMs <= SPEED_WINDOW_MS) ?? latest;
  const span = latest.timeMs - oldest.timeMs;
  const movedKm = distanceKm(oldest, latest);
  const derivedCourse = span >= SPEED_MIN_SPAN_MS && movedKm > 0 ? bearingDeg(oldest, latest) : null;
  if (latest.speedMs != null && Number.isFinite(latest.speedMs)) {
    const knots = Math.max(0, latest.speedMs) / MS_PER_KNOT;
    const deviceCourse = latest.headingDeg != null && Number.isFinite(latest.headingDeg) ? latest.headingDeg : null;
    return { knots, courseDeg: knots >= UNDERWAY_KNOTS ? (deviceCourse ?? derivedCourse) : null };
  }
  if (span < SPEED_MIN_SPAN_MS) return null;
  const driftM = (oldest.accuracyM + latest.accuracyM) / 2;
  if (movedKm * 1000 <= driftM) return { knots: 0, courseDeg: null };
  const knots = movedKm / KM_PER_NM / (span / 3_600_000);
  return { knots, courseDeg: knots >= UNDERWAY_KNOTS ? derivedCourse : null };
}

/** Fixes kept for motionFrom: those inside the window, plus the new one. */
export function keepFixes(fixes: readonly Fix[], next: Fix): Fix[] {
  return [...fixes.filter((fix) => next.timeMs - fix.timeMs <= SPEED_WINDOW_MS && fix.timeMs < next.timeMs), next];
}

export type AlongRoute = {
  /** Km left from the nearest point of the route to its end. */
  remainingKm: number;
  /** How far the boat is off the route. */
  offKm: number;
  /** The next turn (or the end) ahead of the nearest point: what to steer for. */
  next: LatLon;
};

/** Where the boat is along a route ([lat, lon] points, at least one). */
export function alongRoute(boat: LatLon, points: readonly (readonly [number, number])[]): AlongRoute {
  const last = { lat: points[points.length - 1][0], lon: points[points.length - 1][1] };
  if (points.length === 1) {
    const km = distanceKm(boat, last);
    return { remainingKm: km, offKm: km, next: last };
  }
  // A degree of longitude is cos(lat) of a degree of latitude, so legs are measured in degrees of latitude.
  const lonScale = Math.cos((boat.lat * Math.PI) / 180);
  const flat = ([lat, lon]: readonly [number, number]): [number, number] => [lon * lonScale, lat];
  let best = { offKm: Infinity, leg: 0, foot: points[0] as readonly [number, number] };
  for (let index = 0; index + 1 < points.length; index += 1) {
    const [x, lat] = footOnSegment(flat([boat.lat, boat.lon]), flat(points[index]), flat(points[index + 1]));
    const foot: [number, number] = [lat, x / lonScale];
    const offKm = distanceKm(boat, { lat: foot[0], lon: foot[1] });
    if (offKm < best.offKm) best = { offKm, leg: index, foot };
  }
  const foot = best.foot;
  const ahead = points[best.leg + 1];
  return {
    remainingKm: polylineKm([foot, ...points.slice(best.leg + 1)]),
    offKm: best.offKm,
    next: { lat: ahead[0], lon: ahead[1] },
  };
}

/** Minutes to cover `km` at `knots`, or null while the boat is stopped. */
export function etaMinutes(km: number, knots: number): number | null {
  if (!(knots >= UNDERWAY_KNOTS)) return null;
  return (km / KM_PER_NM / knots) * 60;
}

/** "0.4 nm", "12 nm": tenths below 10 nm. */
export function formatNm(km: number): string {
  const nm = km / KM_PER_NM;
  return nm < 10 ? `${nm.toFixed(1)} nm` : `${Math.round(nm)} nm`;
}

/** "under 1 min", "25 min", "1 h 05 min". */
export function formatDuration(minutes: number): string {
  const rounded = Math.round(minutes);
  if (rounded < 1) return "under 1 min";
  if (rounded < 60) return `${rounded} min`;
  return `${Math.floor(rounded / 60)} h ${String(rounded % 60).padStart(2, "0")} min`;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** "135° SE". */
export function formatBearing(deg: number): string {
  const whole = Math.round(deg) % 360;
  return `${String(whole).padStart(3, "0")}° ${COMPASS[Math.round(whole / 45) % 8]}`;
}
