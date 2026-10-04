import { RIM_NEAR_KM, pointInRing, rimEdgeKm, type RimRing } from "./rim";
import type { ForecastRoute, Site, SiteType } from "./types";

export { SITE_TYPES, type SiteType } from "./types";

export const SITE_TYPE_LABEL: Record<SiteType, string> = {
  pass: "Rim pass",
  "channel-thila": "Channel thila",
  corner: "Channel corner",
  "outer-reef": "Outer reef",
  lagoon: "Lagoon",
  "strait-wall": "Strait wall",
};

const PASS_NAME = /\bkandu\b|\bkandoo\b|\bexpress\b/i;
const THILA_NAME = /\bthila\b|\bgiri\b/i;
const CORNER_NAME = /\bcorner\b/i;

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
  // A corner at a channel mouth follows the channel; the owner sets corners named otherwise ("Faru") by hand.
  if (CORNER_NAME.test(site.name)) return "corner";
  return "outer-reef";
}

/** Within this of a pass pin, a wall is in the channel's funnel: the flood is drawn round into the pass. */
export const CHANNEL_FUNNEL_KM = 0.8;

/**
 * True for a site whose current runs along the reef rather than into or out of the atoll: an outer-reef site backed
 * by an island or unbroken reef, where water cannot cross the rim. Walls within CHANNEL_FUNNEL_KM of a pass in the
 * same atoll stay across the rim: the channel's draw takes over there. A corner at a channel mouth is its own type
 * (`corner`), so a wall that happens to be named "Corner" can still run along the reef.
 */
export function flowsAlongReef(
  site: Pick<Site, "id" | "name" | "siteType" | "atollId" | "lat" | "lon">,
  mates: readonly Pick<Site, "id" | "siteType" | "atollId" | "lat" | "lon">[] = [],
): boolean {
  if (site.siteType !== "outer-reef") return false;
  return !mates.some(
    (mate) =>
      mate.id !== site.id &&
      mate.siteType === "pass" &&
      mate.atollId === site.atollId &&
      distanceKm(site, mate) <= CHANNEL_FUNNEL_KM,
  );
}

/**
 * True for a site whose current runs into and out of the atoll across the rim: a pass, a channel thila, or an outer
 * reef corner or funnel wall. Walls running along the reef, strait walls and lagoon sites are not.
 */
export function crossesRim(
  site: Pick<Site, "id" | "name" | "siteType" | "atollId" | "lat" | "lon">,
  mates: readonly Pick<Site, "id" | "siteType" | "atollId" | "lat" | "lon">[] = [],
): boolean {
  if (!site.siteType || site.siteType === "lagoon" || site.siteType === "strait-wall") return false;
  return !flowsAlongReef(site, mates);
}

/**
 * The compass axis a strait wall's forecast runs along: its reef line, turned to point east (within 90° of it), so
 * "incoming" is always the eastward way. Strait walls are set by hand (`siteType: "strait-wall"`).
 */
export function straitHeading(inwardBearingDeg: number): number {
  const along = alongReefHeading(inwardBearingDeg);
  return Math.cos(((along - 90) * Math.PI) / 180) >= 0 ? along : (along + 180) % 360;
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

/** Walls of an ocean strait between atolls (Vaadhoo Kandu): the flow runs through the strait, east or west. */
export const STRAIT_NOTE =
  "Strait wall: the current runs through the channel between the atolls, east or west. The monsoon sets the main direction (west in the NE monsoon, east in the SW), the rising tide pushes east and the falling tide west, and the strait speeds it up. Not checked against reports yet.";

/** Outer walls: the stream along the reef comes from the ocean model's tide and drift, not from the passes. */
export const ALONG_REEF_NOTE =
  "Outer wall: the current runs along the reef and turns with the tide, and the monsoon drift makes one way stronger or longer. Taken from the ocean model, not checked against reports yet.";

/** Inside the lagoon the flow comes from the water exchanged through the rim and channels: approximate. */
export const LAGOON_NOTE =
  "Inside the lagoon: the flow comes from the water moving in and out through the rim and channels. It spreads inward on the flood and back out on the ebb, and the monsoon drift crosses the lagoon. Approximate; thilas near a channel can still run strong.";

/**
 * Which model a site takes, and the compass axis its "incoming" means where the inward bearing gives one: the strait
 * axis at a strait wall, the reef heading at a wall whose current runs along the reef. A lagoon site's axis comes from
 * its flow, not its bearing, and a channel has none. With no bearing the route stands and the axis is null.
 */
export function siteRoute(
  site: Pick<Site, "id" | "name" | "siteType" | "atollId" | "lat" | "lon">,
  mates: readonly Pick<Site, "id" | "siteType" | "atollId" | "lat" | "lon">[],
  bearingDeg: number | null,
): { route: ForecastRoute; axisDeg: number | null } {
  if (site.siteType === "strait-wall") {
    return { route: "strait", axisDeg: bearingDeg == null ? null : straitHeading(bearingDeg) };
  }
  if (site.siteType === "lagoon") return { route: "lagoon", axisDeg: null };
  if (bearingDeg != null && flowsAlongReef(site, mates)) {
    return { route: "along-reef", axisDeg: alongReefHeading(bearingDeg) };
  }
  return { route: "channel", axisDeg: null };
}

/**
 * The note for a site, from the route its hours took. A lagoon site whose atoll has no outline or ring yet runs on
 * channel hours, but it is still inside the lagoon, so it keeps the lagoon note.
 */
export function siteNoteFor(siteType: SiteType | null, route: ForecastRoute): string | null {
  return siteType === "lagoon" ? LAGOON_NOTE : routeNote(route);
}

/** How far to trust the forecast on a route, or null for a channel. */
export function routeNote(route: ForecastRoute): string | null {
  switch (route) {
    case "strait":
      return STRAIT_NOTE;
    case "along-reef":
      return ALONG_REEF_NOTE;
    case "lagoon":
      return LAGOON_NOTE;
    case "channel":
      return null;
  }
}
