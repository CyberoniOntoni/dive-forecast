import type { SiteNowcast } from "./nowcast";
import type { Confidence, Direction, Strength } from "./types";

export function strengthLabel(strength: Strength): string {
  return strength === "too_strong" ? "too strong" : strength;
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
  /** Slack, mild, strong, or too strong. Null when this hour has no forecast. */
  strength: Strength | null;
  confidence: Confidence | null;
  opacity: number | null;
  /** var(--stop), var(--incoming), or var(--outgoing). Null when there is no forecast. */
  color: string | null;
  /** Unix ms when the marine series was fetched. Null when this hour has no forecast. */
  fetchedAt: number | null;
};

function noForecastGlance(name: string): NowcastGlance {
  return {
    label: null,
    spoken: name,
    arrowBearing: null,
    direction: null,
    strength: null,
    confidence: null,
    opacity: null,
    color: null,
    fetchedAt: null,
  };
}

/** Incoming follows the inward bearing. Outgoing is 180? opposite. Not the ocean vector. */
export function nowcastGlance(name: string, nowcast: SiteNowcast | undefined, showStrength: boolean): NowcastGlance {
  // A stale hour still has direction and strength. Empty only when there is no hour.
  if (!nowcast?.hour) return noForecastGlance(name);

  const hour = nowcast.hour;
  const label = strengthLabel(hour.strength);
  const spoken = showStrength
    ? `${name}, ${hour.direction}, ${label}, ${hour.confidence}`
    : `${name}, ${hour.direction}, ${hour.confidence}`;
  return {
    label,
    spoken,
    arrowBearing: passArrowBearing(nowcast.inwardBearingDeg, hour.direction),
    direction: hour.direction,
    strength: hour.strength,
    confidence: hour.confidence,
    opacity: confidenceOpacity(hour.confidence),
    color: glanceColor(hour.direction, hour.strength),
    fetchedAt: nowcast.fetchedAt ?? null,
  };
}

/** Smaller is earlier. Too strong, strong, mild, slack, then no forecast. One band shares a rank. */
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

/** Too strong is the stop token. Every other band keeps incoming or outgoing. Not a second hex. */
export function glanceColor(direction: Direction, strength: Strength): string {
  if (strength === "too_strong") return "var(--stop)";
  return direction === "incoming" ? "var(--incoming)" : "var(--outgoing)";
}

function passArrowBearing(inwardBearingDeg: number, direction: Direction): number {
  if (direction === "incoming") return inwardBearingDeg;
  return inwardBearingDeg + 180;
}
