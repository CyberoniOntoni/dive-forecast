import { RIM_NEAR_KM, pointInRing, rimEdgeKm, type RimRing } from "./rim";
import type { Site, SiteType } from "./types";

export { SITE_TYPES, type SiteType } from "./types";

export const SITE_TYPE_LABEL: Record<SiteType, string> = {
  pass: "Rim pass",
  "channel-thila": "Channel thila",
  "outer-reef": "Outer reef",
  lagoon: "Lagoon",
};

/**
 * Allen Coral Atlas zones around a pin, when that data is loaded. `atPin` is the zone under the pin (null when
 * the pin is off the mapped reef, as a deep kandu is).
 */
export type ReefZones = { atPin: string | null };

const PASS_NAME = /\bkandu\b|\bkandoo\b|\bexpress\b/i;
const THILA_NAME = /\bthila\b|\bgiri\b/i;
/** ACA zones that are the reef itself, rather than lagoon floor or open water. */
const REEF_ZONES = /reef crest|reef flat|reef slope|back reef/i;

/**
 * The type a site's position and name suggest. Null when the atoll has no stored outline.
 * With reef zones, a pin on the rim that sits off the mapped reef is in a gap: a pass, or a thila in one.
 */
export function deriveSiteType(
  site: Pick<Site, "name" | "lat" | "lon">,
  ring: RimRing | null,
  zones: ReefZones | null = null,
): SiteType | null {
  if (!ring) return null;
  const inside = pointInRing(site.lat, site.lon, ring);
  const edgeKm = rimEdgeKm(site, ring);
  if (inside && edgeKm > RIM_NEAR_KM) return "lagoon";

  const thila = THILA_NAME.test(site.name);
  if (zones) {
    const onReef = zones.atPin != null && REEF_ZONES.test(zones.atPin);
    if (!onReef) return thila ? "channel-thila" : "pass";
    return PASS_NAME.test(site.name) ? "pass" : "outer-reef";
  }
  if (PASS_NAME.test(site.name)) return "pass";
  if (thila) return "channel-thila";
  return "outer-reef";
}

/** The forecast follows the ocean tide through the passes; inside the lagoon, flow also depends on the reefs around. */
export const LAGOON_NOTE =
  "Inside the lagoon. The forecast is built for the passes, so it is less reliable here. Thilas inside the atoll can still run strong.";
