import { planRoute, type BoatRoute, type RouteGap, type RouteShapes } from "./boat-route";
import type { LatLon } from "./geometry";
import { readIslands } from "./islands";
import { readOpenings } from "./openings";
import { allRims, CHANNEL_RIM_REACH_KM, nearestRimWithin, type RimRing } from "./rim";
import { routeCurrent } from "./route-current-data";
import type { RouteCurrent } from "./route-current";
import { readPointDestination } from "./point-destination";
import { readShoals } from "./shoals";
import { followTarget } from "./site-type";
import { listMergedSites } from "./store";
import type { Site } from "./types";

/**
 * The shapes the boat route keeps to, from data/: OSM islands and Allen Coral Atlas lagoon reef tops and sand shallows
 * (blocked), the atoll outlines, and their ways through: reef-crest gaps (data/openings.json) and pass dive sites.
 */

/** How far either side of the outline point nearest a pass site its crossing counts as open, metres. */
const PASS_OPEN_M = 150;

let shapeCache: { blockers: RimRing[]; rims: RimRing[]; gaps: RouteGap[] } | null = null;

/** A planned route with the forecast current along it (null when that could not be read). */
export type BoatTrip = BoatRoute & { current: RouteCurrent | null };

/**
 * The route from the boat to a catalog site or a point picked on the map (a pointDestinationId), with the current
 * along it, or null for an unknown site.
 */
export async function boatRoute(from: LatLon, destinationId: string): Promise<BoatTrip | null> {
  const sites = await listMergedSites();
  const target = sites.find((item) => item.id === destinationId) ?? readPointDestination(destinationId);
  if (!target) return null;
  const route = planRoute(from, target, routeShapes(sites));
  // The current only adjusts the steer and ETA, so a failure reading it still returns the route.
  const current = await routeCurrent(route.points, sites).catch((error: unknown) => {
    console.error("Route current failed", error);
    return null;
  });
  return { ...route, current };
}

/**
 * The boat route between two dives of a plan, round the same islands and reef, without the current: a plan's dives can
 * be days ahead, past the hours the route current covers.
 */
export function planLeg(from: LatLon, to: LatLon, sites: readonly Site[]): BoatRoute {
  return planRoute(from, to, routeShapes(sites));
}

function routeShapes(sites: readonly Site[]): RouteShapes {
  if (!shapeCache) {
    shapeCache = {
      blockers: [...readIslands().map((island) => island.ring), ...readShoals().map((shoal) => shoal.ring)],
      rims: [...allRims().values()],
      // Only the gaps of the outlines the route reads: a flow-only outline's gaps open nothing here.
      gaps: readOpenings().filter((opening) => allRims().has(opening.wayId)).map(({ lat, lon, widthM, reefFlatBridges }) => ({
        lat,
        lon,
        widthM,
        shallow: reefFlatBridges === true,
      })),
    };
  }
  const { blockers, rims, gaps } = shapeCache;
  // A pass dive site is a way through its outline even where the crest map shows no gap. The reach is the one the
  // forecast uses to tie a pass to its outline, so a pass the coarse outline puts inside the lagoon still opens it.
  // Only catalog passes: a diver's pick on an app-added pin never opens the reef to the route. A pin that shows another
  // pass's forecast (Coral Garden on Kondey Channel's wall) is in that pass, which opens the reef once.
  const passes = sites
    .filter((site) => site.siteType === "pass" && site.sourceUrl !== "user" && !followTarget(site, sites))
    .flatMap((site) => {
      const foot = nearestRimWithin(site, rims, CHANNEL_RIM_REACH_KM);
      return foot ? [{ lat: foot.lat, lon: foot.lon, widthM: PASS_OPEN_M * 2, shallow: false }] : [];
    });
  return { blockers, rims, gaps: [...gaps, ...passes] };
}
