import { RIM_NEAR_KM, pointInRing, rimEdgeKm, type RimRing } from "./rim";
import type { Site, SiteType } from "./types";

export { SITE_TYPES, type SiteType } from "./types";

export const SITE_TYPE_LABEL: Record<SiteType, string> = {
  pass: "Rim pass",
  "channel-thila": "Channel thila",
  "outer-reef": "Outer reef",
  lagoon: "Lagoon",
};

const PASS_NAME = /\bkandu\b|\bkandoo\b|\bexpress\b/i;
const THILA_NAME = /\bthila\b|\bgiri\b/i;

/**
 * The type a site's position and name suggest. Null when the atoll has no stored outline.
 * Allen Coral Atlas reef zones were tried and dropped: they map only the shallow reef tops, and dive pins sit on
 * the walls below, so neither the zone under a pin nor the zones inward from it separated passes from outer reef.
 */
export function deriveSiteType(site: Pick<Site, "name" | "lat" | "lon">, ring: RimRing | null): SiteType | null {
  if (!ring) return null;
  const inside = pointInRing(site.lat, site.lon, ring);
  const edgeKm = rimEdgeKm(site, ring);
  if (inside && edgeKm > RIM_NEAR_KM) return "lagoon";

  if (PASS_NAME.test(site.name)) return "pass";
  if (THILA_NAME.test(site.name)) return "channel-thila";
  return "outer-reef";
}

/** The forecast follows the ocean tide through the passes; inside the lagoon, flow also depends on the reefs around. */
export const LAGOON_NOTE =
  "Inside the lagoon. The forecast is built for the passes, so it is less reliable here. Thilas inside the atoll can still run strong.";
