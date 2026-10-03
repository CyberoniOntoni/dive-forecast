import fs from "fs";
import path from "path";
import type { Atoll, Site } from "./types";

export type RimRing = readonly (readonly [number, number])[];

const RIMS_PATH = path.join(process.cwd(), "data", "rims.json");
const KM_PER_DEG_LAT = 110.57;
const KM_PER_DEG_LON = 111.32;
/** Normals from rim segments this close to the pin are averaged. */
const SMOOTH_KM = 1.5;
/** A pin farther than this from the rim is not on the rim. Its rim normal says nothing about its channel. */
export const RIM_NEAR_KM = 0.8;
const PROBE_KM = 1;

let loaded: Map<string, RimRing> | null = null;

/** OSM outline for an atoll, or null when none is stored. Keyed by the way id in rimSourceUrl. */
export function rimForAtoll(atoll: Atoll | undefined): RimRing | null {
  if (!atoll) return null;
  const wayId = atoll.rimSourceUrl.split("/").pop() ?? "";
  return readRims().get(wayId) ?? null;
}

function readRims(): Map<string, RimRing> {
  if (loaded) return loaded;
  const rims = new Map<string, RimRing>();
  try {
    const parsed = JSON.parse(fs.readFileSync(RIMS_PATH, "utf8")) as { rims?: Record<string, RimRing> };
    for (const [wayId, ring] of Object.entries(parsed.rims ?? {})) rims.set(wayId, ring);
  } catch {
    // No rim file: every pin keeps the heuristic.
  }
  loaded = rims;
  return rims;
}

/** How far a site set by hand as a channel (pass, channel thila, corner) may sit from the outline and still take its normal. */
export const CHANNEL_RIM_REACH_KM = 3;

/**
 * Bearing of the rim's inward normal at the pin, degrees clockwise from north.
 * Null when the pin is not within `reachKm` of the rim (RIM_NEAR_KM by default). Past RIM_NEAR_KM, the normals are
 * averaged over the stretch of outline nearest the pin rather than within 1.5 km of it, so a channel pin the coarse
 * outline puts inside the lagoon still takes the shape of its stretch of rim.
 */
export function rimInwardBearing(
  site: Pick<Site, "lat" | "lon">,
  ring: RimRing,
  reachKm: number = RIM_NEAR_KM,
): number | null {
  const closest = rimEdgeKm(site, ring);
  if (closest > reachKm) return null;
  // The smoothing window is measured from the pin on the rim, as it always was; past RIM_NEAR_KM, from the nearest
  // stretch of outline, so a far pin still averages a 1.5 km stretch rather than nothing.
  const anchorKm = closest > RIM_NEAR_KM ? closest : 0;
  const points = ring.map(([lat, lon]) => toKm(lat, lon, site.lat));
  const pin = toKm(site.lat, site.lon, site.lat);
  let sumX = 0;
  let sumY = 0;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    const foot = footOnSegment(pin, from, to);
    const fromWindow = Math.hypot(pin[0] - foot[0], pin[1] - foot[1]) - anchorKm;
    if (fromWindow >= SMOOTH_KM) continue;
    let normal: [number, number] = [-dy / length, dx / length];
    if (!insideKm([foot[0] + normal[0] * PROBE_KM, foot[1] + normal[1] * PROBE_KM], points)) {
      normal = [-normal[0], -normal[1]];
    }
    const weight = length * (1 - fromWindow / SMOOTH_KM);
    sumX += weight * normal[0];
    sumY += weight * normal[1];
  }
  if (sumX === 0 && sumY === 0) return null;
  return (((Math.atan2(sumX, sumY) * 180) / Math.PI) % 360 + 360) % 360;
}

/** Km from the pin to the outline, 0 when the pin is inside it. */
export function rimDistanceKm(site: Pick<Site, "lat" | "lon">, ring: RimRing): number {
  if (pointInRing(site.lat, site.lon, ring)) return 0;
  return rimEdgeKm(site, ring);
}

/** Km from the pin to the nearest point of the outline, from inside or outside. */
export function rimEdgeKm(site: Pick<Site, "lat" | "lon">, ring: RimRing): number {
  const points = ring.map(([lat, lon]) => toKm(lat, lon, site.lat));
  const pin = toKm(site.lat, site.lon, site.lat);
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const foot = footOnSegment(pin, points[index], points[index + 1]);
    nearest = Math.min(nearest, Math.hypot(pin[0] - foot[0], pin[1] - foot[1]));
  }
  return nearest;
}

/** Closest point to `pin` on the segment from `from` to `to`, all in km. */
function footOnSegment(
  pin: readonly [number, number],
  from: readonly [number, number],
  to: readonly [number, number],
): [number, number] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return [from[0], from[1]];
  const along = Math.max(0, Math.min(1, ((pin[0] - from[0]) * dx + (pin[1] - from[1]) * dy) / lengthSq));
  return [from[0] + along * dx, from[1] + along * dy];
}

/** True when the point is inside the ring (ray casting on lat/lon). */
export function pointInRing(lat: number, lon: number, ring: RimRing): boolean {
  let inside = false;
  for (let index = 0; index + 1 < ring.length; index += 1) {
    const [lat1, lon1] = ring[index];
    const [lat2, lon2] = ring[index + 1];
    if (lat1 > lat !== lat2 > lat && lon < ((lon2 - lon1) * (lat - lat1)) / (lat2 - lat1) + lon1) {
      inside = !inside;
    }
  }
  return inside;
}

function toKm(lat: number, lon: number, refLat: number): [number, number] {
  return [lon * KM_PER_DEG_LON * Math.cos((refLat * Math.PI) / 180), lat * KM_PER_DEG_LAT];
}

function insideKm(point: [number, number], ring: readonly [number, number][]): boolean {
  let inside = false;
  for (let index = 0; index + 1 < ring.length; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[index + 1];
    if (y1 > point[1] !== y2 > point[1] && point[0] < ((x2 - x1) * (point[1] - y1)) / (y2 - y1) + x1) {
      inside = !inside;
    }
  }
  return inside;
}
