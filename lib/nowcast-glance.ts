import type { SiteNowcast } from "./nowcast";
import type { Confidence, Direction, Strength } from "./types";

export function strengthLabel(strength: Strength): string {
  // Stored as too_strong; shown as "very strong", since whether it can be dived depends on the diver.
  return strength === "too_strong" ? "very strong" : strength;
}

/** Low confidence draws quieter. High stays solid. */
export function confidenceOpacity(confidence: Confidence): number {
  if (confidence === "low") return 0.42;
  if (confidence === "medium") return 0.74;
  return 1;
}

export type NowcastGlance = {
  /** Strength words, or null when this hour has no forecast. */
  label: string | null;
  /** What the pin and the tooltip say. The site name alone when there is no forecast. */
  spoken: string;
  /** Degrees clockwise from north. Null when there is no arrow. */
  arrowBearing: number | null;
  direction: Direction | null;
  /** What the list says for the way the water runs: "incoming", "outgoing", or "running NE" along a reef. */
  way: string | null;
  /** Slack, mild, strong, or very strong. Null when this hour has no forecast. */
  strength: Strength | null;
  confidence: Confidence | null;
  opacity: number | null;
  /** var(--stop), var(--incoming), var(--outgoing), or var(--foam) along a reef. Null when there is no forecast. */
  color: string | null;
  /** Unix ms when the marine series was fetched. Null when this hour has no forecast. */
  fetchedAt: number | null;
  /** True when the arrow heading comes from the fallback heuristic, not a measurement or the atoll rim. */
  estimatedHeading: boolean;
};

function noForecastGlance(name: string): NowcastGlance {
  return {
    label: null,
    spoken: name,
    arrowBearing: null,
    direction: null,
    way: null,
    strength: null,
    confidence: null,
    opacity: null,
    color: null,
    fetchedAt: null,
    estimatedHeading: false,
  };
}

/**
 * Incoming follows the inward bearing. Outgoing is 180 opposite, wrapped to 0-360. Not the ocean vector.
 * Along a reef, incoming follows the reef heading instead, and the words are a compass direction.
 */
export function nowcastGlance(name: string, nowcast: SiteNowcast | undefined, showStrength: boolean): NowcastGlance {
  // A stale hour still has direction and strength. Empty only when there is no hour.
  if (!nowcast?.hour || nowcast.inwardBearingDeg == null) return noForecastGlance(name);

  const hour = nowcast.hour;
  const label = strengthLabel(hour.strength);
  const estimatedHeading = nowcast.bearingSource === "fallback";
  const along = nowcast.alongHeadingDeg ?? null;
  // Along a reef the axis is the reef's; only a channel can bend.
  const arrowBearing =
    along == null
      ? passArrowBearing(nowcast.inwardBearingDeg, hour.direction, nowcast.outgoingBearingDeg)
      : passArrowBearing(along, hour.direction);
  const way = along == null ? hour.direction : `running ${compassWord(arrowBearing)}`;
  // A wall's flow runs along its reef; a lagoon site's just runs that way.
  const spokenWay = along == null || nowcast.lagoon ? way : `${way} along the reef`;
  const base = showStrength
    ? `${name}, ${spokenWay}, ${label}, ${hour.confidence}`
    : `${name}, ${spokenWay}, ${hour.confidence}`;
  const spoken = estimatedHeading ? `${base}, heading estimated` : base;
  return {
    label,
    spoken,
    estimatedHeading,
    arrowBearing,
    direction: hour.direction,
    way,
    strength: hour.strength,
    confidence: hour.confidence,
    opacity: confidenceOpacity(hour.confidence),
    color: along == null ? glanceColor(hour.direction, hour.strength) : alongColor(hour.strength),
    fetchedAt: nowcast.fetchedAt ?? null,
  };
}

/** Smaller is earlier. Very strong, strong, mild, slack, then no forecast. One band shares a rank. */
const STRENGTH_RANK: Record<Strength, number> = {
  too_strong: 0,
  strong: 1,
  mild: 2,
  slack: 3,
};

const NO_FORECAST_RANK = 4;

export function glanceRank(glance: NowcastGlance): number {
  if (glance.strength == null) return NO_FORECAST_RANK;
  return STRENGTH_RANK[glance.strength];
}

/** Very strong is the stop token. Every other band keeps incoming or outgoing. Not a second hex. */
export function glanceColor(direction: Direction, strength: Strength): string {
  if (strength === "too_strong") return "var(--stop)";
  return direction === "incoming" ? "var(--incoming)" : "var(--outgoing)";
}

/** Along a reef the way is a compass heading, not in or out, so it takes no in/out colour. Very strong is still the stop token. */
export function alongColor(strength: Strength): string {
  return strength === "too_strong" ? "var(--stop)" : "var(--foam)";
}

const COMPASS_WORDS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** The nearest of the eight compass points to a heading in degrees. */
export function compassWord(headingDeg: number): string {
  const wrapped = ((headingDeg % 360) + 360) % 360;
  return COMPASS_WORDS[Math.round(wrapped / 45) % 8];
}

/**
 * The arrow's heading: incoming along the inward bearing, outgoing straight back, unless a curved channel gives its
 * own outgoing heading.
 */
export function passArrowBearing(
  inwardBearingDeg: number,
  direction: Direction,
  outgoingBearingDeg: number | null = null,
): number {
  if (direction === "incoming") return ((inwardBearingDeg % 360) + 360) % 360;
  if (outgoingBearingDeg != null) return ((outgoingBearingDeg % 360) + 360) % 360;
  // W5: wrap so 270 outgoing is 90, not 450.
  return ((inwardBearingDeg + 180) % 360 + 360) % 360;
}
