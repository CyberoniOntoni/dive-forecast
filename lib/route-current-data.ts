import { alongRoute, MS_PER_KNOT } from "./boat-nav";
import { parseWall } from "./forecast";
import { distanceKm, type LatLon } from "./geometry";
import { loadSite } from "./load-site";
import { fetchMarine } from "./marine";
import { routeArrowBearing } from "./nowcast-glance";
import { allRims, boxesOverlap, pointInRing, ringBox, type RimRing, type RingBox } from "./rim";
import { currentVector, STRENGTH_KNOTS, type RouteCurrent, type RouteCurrentHour, type RouteCurrentSource } from "./route-current";
import { MALDIVES_TIME } from "./site-time";
import { readCatalog, reportsForSite } from "./store";
import type { ForecastRoute, MarineHour, Site } from "./types";

/**
 * The current along a planned route, from what the app already forecasts: near a dive site, that site's own forecast
 * (channel, along-reef, strait or lagoon) read as a heading and a typical speed for its band; out at sea, beyond every
 * atoll outline, the Open-Meteo ocean current. Inside a lagoon away from any site there is no forecast, and the route
 * runs there at the boat's own speed. The forecast model itself is not touched.
 */

/** How far from a site its forecast covers the route, km, by the model that made it. */
const SITE_REACH_KM: Record<ForecastRoute, number> = { channel: 0.6, "along-reef": 1, strait: 1, lagoon: 2 };
const FARTHEST_REACH_KM = Math.max(...Object.values(SITE_REACH_KM));
/** Samples along the route, at most; the spacing grows on a long route. */
const MAX_SAMPLES = 200;
const MIN_STEP_KM = 0.25;
/** The ocean current is read on a grid this many degrees apart: about the ocean model's own 1/12° cells. */
const OCEAN_GRID_DEG = 1 / 12;
/** Forecast hours sent, from an hour before now. Long enough for any trip the boat panel plans. */
const HOURS_AHEAD = 12;
const HOUR_MS = 3_600_000;

type Points = readonly (readonly [number, number])[];

/** The current along `points` for the next hours. Sites and sea points with no cached forecast yet are left out. */
export async function routeCurrent(points: Points, sites: readonly Site[], nowMs = Date.now()): Promise<RouteCurrent> {
  const samples = samplePoints(points);
  const stepKm = samples.stepKm;
  const window = { fromMs: nowMs - HOUR_MS, toMs: nowMs + HOURS_AHEAD * HOUR_MS };

  const near = sites.filter((site) => alongRoute(site, points).offKm <= FARTHEST_REACH_KM);
  const loaded = (await Promise.all(near.map((site) => siteSource(site, window)))).filter(
    (item): item is SiteCurrent => item != null,
  );

  const sources: RouteCurrentSource[] = [];
  const indexOf = new Map<string, number>();
  const ocean = new Map<string, Promise<RouteCurrentSource | null>>();
  const rims = rimBoxes();
  const picks = samples.points.map((point) => {
    let best: SiteCurrent | null = null;
    let bestKm = Infinity;
    for (const item of loaded) {
      const km = distanceKm(point, item.site);
      if (km <= SITE_REACH_KM[item.route] && km < bestKm) {
        best = item;
        bestKm = km;
      }
    }
    if (best) return { key: `site:${best.site.id}`, source: Promise.resolve<RouteCurrentSource | null>(best.source) };
    if (insideAnyRim(point, rims)) return null;
    const node = oceanNode(point);
    const key = `sea:${node.lat.toFixed(4)}_${node.lon.toFixed(4)}`;
    if (!ocean.has(key)) ocean.set(key, oceanSource(node, window));
    return { key, source: ocean.get(key) as Promise<RouteCurrentSource | null> };
  });

  const resolved = await Promise.all(picks.map((pick) => pick?.source ?? null));
  const sampleSources = picks.map((pick, index) => {
    const source = resolved[index];
    if (!pick || !source) return -1;
    let at = indexOf.get(pick.key);
    if (at == null) {
      at = sources.length;
      sources.push(source);
      indexOf.set(pick.key, at);
    }
    return at;
  });
  return { stepKm, samples: sampleSources, sources };
}

/** Points every stepKm along the route, from its start to its end. */
export function samplePoints(points: Points): { stepKm: number; points: LatLon[] } {
  const legs: { from: LatLon; to: LatLon; km: number }[] = [];
  for (let index = 0; index + 1 < points.length; index += 1) {
    const from = { lat: points[index][0], lon: points[index][1] };
    const to = { lat: points[index + 1][0], lon: points[index + 1][1] };
    legs.push({ from, to, km: distanceKm(from, to) });
  }
  const totalKm = legs.reduce((sum, leg) => sum + leg.km, 0);
  const stepKm = Math.max(MIN_STEP_KM, totalKm / (MAX_SAMPLES - 1));
  const count = Math.floor(totalKm / stepKm) + 1;
  const out: LatLon[] = [];
  let leg = 0;
  let legStart = 0;
  for (let sample = 0; sample < count; sample += 1) {
    const km = sample * stepKm;
    while (leg < legs.length - 1 && legStart + legs[leg].km < km) {
      legStart += legs[leg].km;
      leg += 1;
    }
    const onLeg = legs[leg];
    if (!onLeg) {
      out.push({ lat: points[0][0], lon: points[0][1] });
      continue;
    }
    const share = onLeg.km === 0 ? 0 : Math.min(1, (km - legStart) / onLeg.km);
    out.push({
      lat: onLeg.from.lat + (onLeg.to.lat - onLeg.from.lat) * share,
      lon: onLeg.from.lon + (onLeg.to.lon - onLeg.from.lon) * share,
    });
  }
  return { stepKm, points: out };
}

type SiteCurrent = { site: Site; route: ForecastRoute; source: RouteCurrentSource };
type Window = { fromMs: number; toMs: number };

/** A Maldives wall-clock hour as Unix ms. */
function wallMs(time: string): number {
  return parseWall(time) - MALDIVES_TIME.offsetMinutes * 60_000;
}

/** A site's forecast as a current: its arrow's heading at a typical speed for its band. Null with no forecast cached. */
async function siteSource(site: Site, window: Window): Promise<SiteCurrent | null> {
  const catalog = readCatalog();
  const atoll = catalog.atolls.find((item) => item.id === site.atollId);
  // Like the map: never wait on a first fetch here, the route must not hang on Open-Meteo.
  const loaded = await loadSite(site, catalog.sites, atoll, reportsForSite(site.id), { wait: false });
  if (loaded.bearing == null || loaded.hours.length === 0) return null;
  const hours: RouteCurrentHour[] = [];
  for (const hour of loaded.hours) {
    const timeMs = wallMs(hour.time);
    if (!(timeMs >= window.fromMs && timeMs <= window.toMs)) continue;
    const heading = routeArrowBearing(
      loaded.forecastRoute,
      hour.direction,
      loaded.bearing,
      loaded.alongHeadingDeg,
      site.outgoingBearingDeg ?? null,
    );
    hours.push({ timeMs, strength: hour.strength, ...currentVector(heading, STRENGTH_KNOTS[hour.strength]) });
  }
  if (hours.length === 0) return null;
  return { site, route: loaded.forecastRoute, source: { siteId: site.id, name: site.name, hours } };
}

/** The ocean model's current at a grid node. Null while the node has no cached series. */
async function oceanSource(node: LatLon, window: Window): Promise<RouteCurrentSource | null> {
  const fetched = await fetchMarine(node.lat, node.lon, { wait: false });
  if (!fetched.ok) return null;
  const hours = fetched.hours.flatMap((hour) => oceanHour(hour, window));
  return hours.length > 0 ? { siteId: null, name: "open sea", hours } : null;
}

function oceanHour(hour: MarineHour, window: Window): RouteCurrentHour[] {
  const timeMs = wallMs(hour.time);
  if (!(timeMs >= window.fromMs && timeMs <= window.toMs)) return [];
  if (hour.currentVelocityMs == null || hour.currentDirectionDeg == null) return [];
  return [{ timeMs, strength: null, ...currentVector(hour.currentDirectionDeg, hour.currentVelocityMs / MS_PER_KNOT) }];
}

function oceanNode(point: LatLon): LatLon {
  const snap = (degrees: number) => Number((Math.round(degrees / OCEAN_GRID_DEG) * OCEAN_GRID_DEG).toFixed(4));
  return { lat: snap(point.lat), lon: snap(point.lon) };
}

function rimBoxes(): { ring: RimRing; box: RingBox }[] {
  return [...allRims().values()].map((ring) => ({ ring, box: ringBox(ring) }));
}

function insideAnyRim(point: LatLon, rims: readonly { ring: RimRing; box: RingBox }[]): boolean {
  const here: RingBox = { south: point.lat, north: point.lat, west: point.lon, east: point.lon };
  return rims.some(({ ring, box }) => boxesOverlap(box, here) && pointInRing(point.lat, point.lon, ring));
}
