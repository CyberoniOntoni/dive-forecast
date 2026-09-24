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
  confidence: Confidence | null;
  opacity: number | null;
};

function noForecastGlance(name: string): NowcastGlance {
  return {
    label: null,
    spoken: name,
    arrowBearing: null,
    direction: null,
    confidence: null,
    opacity: null,
  };
}

/** Incoming follows the inward bearing. Outgoing is 180? opposite. Not the ocean vector. */
export function nowcastGlance(name: string, nowcast: SiteNowcast | undefined, showStrength: boolean): NowcastGlance {
  if (!nowcast || nowcast.unavailable || !nowcast.hour) return noForecastGlance(name);

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
    confidence: hour.confidence,
    opacity: confidenceOpacity(hour.confidence),
  };
}

function passArrowBearing(inwardBearingDeg: number, direction: Direction): number {
  if (direction === "incoming") return inwardBearingDeg;
  return inwardBearingDeg + 180;
}
