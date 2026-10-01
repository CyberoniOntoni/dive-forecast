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

/** Within this of a pass pin, a wall is in the channel's funnel: the flood is drawn round into the pass. */
export const CHANNEL_FUNNEL_KM = 0.8;

/**
 * True for a site whose current runs along the reef rather than into or out of the atoll: an outer-reef site backed
 * by an island or unbroken reef, where water cannot cross the rim. Corner dives at a channel mouth, and walls within
 * CHANNEL_FUNNEL_KM of a pass in the same atoll, stay across the rim: the channel's draw takes over there.
 * A hand-set type decides, like any type.
 */
export function flowsAlongReef(
  site: Pick<Site, "id" | "name" | "siteType" | "atollId" | "lat" | "lon">,
  mates: readonly Pick<Site, "id" | "siteType" | "atollId" | "lat" | "lon">[] = [],
): boolean {
  if (site.siteType !== "outer-reef" || /\bcorner\b/i.test(site.name)) return false;
  return !mates.some(
    (mate) =>
      mate.id !== site.id &&
      mate.siteType === "pass" &&
      mate.atollId === site.atollId &&
      distanceKm(site, mate) <= CHANNEL_FUNNEL_KM,
  );
}

/** The heading along the reef that an along-reef forecast calls "incoming": the inward bearing turned 90° clockwise. */
export function alongReefHeading(inwardBearingDeg: number): number {
  return (((inwardBearingDeg + 90) % 360) + 360) % 360;
}

function distanceKm(a: Pick<Site, "lat" | "lon">, b: Pick<Site, "lat" | "lon">): number {
  const north = (b.lat - a.lat) * 111.32;
  const east = (b.lon - a.lon) * 111.32 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot(north, east);
}

/** Outer walls: the stream along the reef comes from the ocean model's tide and drift, not from the passes. */
export const ALONG_REEF_NOTE =
  "Outer wall: the current runs along the reef and turns with the tide, and the monsoon drift makes one way stronger or longer. Taken from the ocean model, not checked against reports yet.";

/** Inside the lagoon the flow comes from the water exchanged through the rim and channels: approximate. */
export const LAGOON_NOTE =
  "Inside the lagoon: the flow comes from the water moving in and out through the rim and channels. It spreads inward on the flood and back out on the ebb, and the monsoon drift crosses the lagoon. Approximate; thilas near a channel can still run strong.";
