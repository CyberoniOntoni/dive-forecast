import { planRoute, type BoatRoute, type RouteGap, type RouteShapes } from "./boat-route";
import type { LatLon } from "./geometry";
import { readIslands } from "./islands";
import { readOpenings } from "./openings";
import { allRims, CHANNEL_RIM_REACH_KM, nearestRimWithin, type RimRing } from "./rim";
import { readShoals } from "./shoals";
import { listMergedSites } from "./store";

/**
 * The shapes the boat route keeps to, from data/: OSM islands and Allen Coral Atlas lagoon reef tops and sand shallows
 * (blocked), the atoll outlines, and their ways through: reef-crest gaps (data/openings.json) and pass dive sites.
 */

/** How far either side of the outline point nearest a pass site its crossing counts as open, metres. */
const PASS_OPEN_M = 150;

let shapeCache: { blockers: RimRing[]; rims: RimRing[]; gaps: RouteGap[] } | null = null;

/** The route from the boat to a catalog site, or null for an unknown site. */
export async function boatRoute(from: LatLon, siteId: string): Promise<BoatRoute | null> {
  const sites = await listMergedSites();
  const site = sites.find((item) => item.id === siteId);
  if (!site) return null;
  return planRoute(from, site, routeShapes(sites));
}

function routeShapes(sites: readonly { lat: number; lon: number; siteType?: string }[]): RouteShapes {
  if (!shapeCache) {
    shapeCache = {
      blockers: [...readIslands().map((island) => island.ring), ...readShoals().map((shoal) => shoal.ring)],
      rims: [...allRims().values()],
      gaps: readOpenings().map(({ lat, lon, widthM, reefFlatBridges }) => ({
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
  const passes = sites
    .filter((site) => site.siteType === "pass")
    .flatMap((site) => {
      const foot = nearestRimWithin(site, rims, CHANNEL_RIM_REACH_KM);
      return foot ? [{ lat: foot.lat, lon: foot.lon, widthM: PASS_OPEN_M * 2, shallow: false }] : [];
    });
  return { blockers, rims, gaps: [...gaps, ...passes] };
}
