/**
 * Sea current along a boat route, and what it does to the steer bearing and the ETA. Runs in the browser: the server
 * (lib/route-current-data.ts) sends the current at points along the route, hour by hour, and this works out the
 * heading that holds the boat on its track and how long each stretch takes with the current helping or against it.
 */

import { KM_PER_NM } from "./boat-nav";
import { bearingDeg, distanceKm, type LatLon } from "./geometry";
import type { Strength } from "./types";

/** A current in knots, as its east and north parts. */
export type CurrentVector = { eastKn: number; northKn: number };

export type RouteCurrentHour = CurrentVector & {
  /** Unix ms at the start of the forecast hour. */
  timeMs: number;
  /** The site forecast's band; null for the open-sea model, which gives a speed and no band. */
  strength: Strength | null;
};

/** Where a stretch of route takes its current from: a dive site's forecast, or the ocean model offshore. */
export type RouteCurrentSource = { siteId: string | null; name: string; hours: RouteCurrentHour[] };

export type RouteCurrent = {
  /** Distance between samples along the route, km; the first sample is at its start. */
  stepKm: number;
  /** One per sample: the index into `sources` of the current there, or -1 where no forecast covers it. */
  samples: number[];
  sources: RouteCurrentSource[];
};

/**
 * Knots for a site forecast's band. The forecast gives a band, not a speed, so these are typical speeds inside each
 * band, from the owner's dive speeds behind the strait bands (mild 0.8–1.5 kn, very strong from about 2.5 kn). A guess
 * to tune: a pass mouth at its peak can run faster than this.
 */
export const STRENGTH_KNOTS: Record<Strength, number> = { slack: 0, mild: 0.8, strong: 1.6, too_strong: 2.5 };

/** An hour's current counts for this long either side of its time. */
const HOUR_REACH_MS = 90 * 60 * 1000;
/** The ETA walks the route in steps this long at most, km. */
const ETA_STEP_KM = 0.1;

export function currentVector(headingDeg: number, knots: number): CurrentVector {
  const radians = (headingDeg * Math.PI) / 180;
  return { eastKn: knots * Math.sin(radians), northKn: knots * Math.cos(radians) };
}

export function currentKnots(current: CurrentVector): number {
  return Math.hypot(current.eastKn, current.northKn);
}

/** The heading the water runs toward, degrees. */
export function currentHeading(current: CurrentVector): number {
  return ((Math.atan2(current.eastKn, current.northKn) * 180) / Math.PI + 360) % 360;
}

export type CurrentHere = { current: CurrentVector; source: RouteCurrentSource; hour: RouteCurrentHour };

/** The current `km` along the route at `timeMs`, or null where no forecast covers that place and hour. */
export function currentAt(route: RouteCurrent, km: number, timeMs: number): CurrentHere | null {
  if (route.samples.length === 0) return null;
  const index = Math.min(route.samples.length - 1, Math.max(0, Math.round(km / route.stepKm)));
  const source = route.sources[route.samples[index]];
  if (!source) return null;
  let hour: RouteCurrentHour | null = null;
  for (const candidate of source.hours) {
    if (Math.abs(candidate.timeMs - timeMs) > HOUR_REACH_MS) continue;
    if (!hour || Math.abs(candidate.timeMs - timeMs) < Math.abs(hour.timeMs - timeMs)) hour = candidate;
  }
  return hour ? { current: { eastKn: hour.eastKn, northKn: hour.northKn }, source, hour } : null;
}

/**
 * The heading to steer so a boat making `speedKnots` through the water holds `trackDeg` over the ground, and its speed
 * along the track. Null when the current across the track is faster than the boat, or the current ahead stops it making way.
 */
export function crab(trackDeg: number, speedKnots: number, current: CurrentVector): { headingDeg: number; groundKnots: number } | null {
  const radians = (trackDeg * Math.PI) / 180;
  const along = current.eastKn * Math.sin(radians) + current.northKn * Math.cos(radians);
  // Positive when the current sets the boat to the right of its track.
  const right = current.eastKn * Math.cos(radians) - current.northKn * Math.sin(radians);
  if (!(speedKnots > 0) || Math.abs(right) >= speedKnots) return null;
  const groundKnots = along + Math.sqrt(speedKnots ** 2 - right ** 2);
  if (!(groundKnots > 0)) return null;
  const headingDeg = trackDeg - (Math.asin(right / speedKnots) * 180) / Math.PI;
  return { headingDeg: ((headingDeg % 360) + 360) % 360, groundKnots };
}

/**
 * The boat's speed through the water: its speed and course over ground less the current under it. Without a course or
 * a current, the speed over ground stands in for it.
 */
export function waterKnots(groundKnots: number, courseDeg: number | null, current: CurrentVector | null): number {
  if (courseDeg == null || !current) return groundKnots;
  const ground = currentVector(courseDeg, groundKnots);
  return Math.hypot(ground.eastKn - current.eastKn, ground.northKn - current.northKn);
}

/** A site on the route whose forecast is very strong when the boat gets there. */
export type VeryStrongSite = { name: string; siteId: string | null; timeMs: number };

export type RouteTime = {
  /** Minutes to the end, or null when the current somewhere ahead is too much for the boat at this speed. */
  minutes: number | null;
  /** Sites ahead whose forecast is very strong when the boat gets there, in order, each once. */
  veryStrong: VeryStrongSite[];
  /** Km of the remaining route with a current forecast. */
  coveredKm: number;
};

/**
 * Time to run the route from `fromKm` to its end at `speedKnots` through the water, starting at `startMs`, with the
 * current each stretch has when the boat reaches it. A stretch with no forecast is run at the boat's own speed.
 */
export function routeTime(
  points: readonly (readonly [number, number])[],
  fromKm: number,
  route: RouteCurrent | null,
  speedKnots: number,
  startMs: number,
): RouteTime {
  let hours = 0;
  let atKm = 0;
  let coveredKm = 0;
  let blocked = false;
  const veryStrong: VeryStrongSite[] = [];
  for (let index = 0; index + 1 < points.length; index += 1) {
    const from: LatLon = { lat: points[index][0], lon: points[index][1] };
    const to: LatLon = { lat: points[index + 1][0], lon: points[index + 1][1] };
    const legKm = distanceKm(from, to);
    const legEnd = atKm + legKm;
    if (legEnd <= fromKm || legKm === 0) {
      atKm = legEnd;
      continue;
    }
    const trackDeg = bearingDeg(from, to);
    let km = Math.max(atKm, fromKm);
    while (km < legEnd - 1e-9) {
      const stepKm = Math.min(ETA_STEP_KM, legEnd - km);
      const nowMs = startMs + hours * 3_600_000;
      const here = route ? currentAt(route, km + stepKm / 2, nowMs) : null;
      let groundKnots = speedKnots;
      if (here) {
        coveredKm += stepKm;
        const made = crab(trackDeg, speedKnots, here.current);
        if (made) groundKnots = made.groundKnots;
        else blocked = true;
        if (here.hour.strength === "too_strong" && !veryStrong.some((site) => site.name === here.source.name)) {
          veryStrong.push({ name: here.source.name, siteId: here.source.siteId, timeMs: nowMs });
        }
      }
      if (groundKnots > 0) hours += stepKm / KM_PER_NM / groundKnots;
      km += stepKm;
    }
    atKm = legEnd;
  }
  return { minutes: blocked || !(speedKnots > 0) ? null : hours * 60, veryStrong, coveredKm };
}
