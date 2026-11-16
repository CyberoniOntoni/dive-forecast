import { capital, dayLabel, type StopOutlook, type StopWarning } from "./dive-plan";
import { DIVE_TURNAROUND_MIN, durationText, legDeparture, nmFromKm } from "./plan-legs";
import { strengthLabel } from "./nowcast-glance";
import type { Confidence, Direction, ForecastRoute, Strength } from "./types";

/**
 * A plan's dives and boat legs in words, for the plan page (components/PlanDay.tsx) and the app's API (lib/api-v1.ts),
 * so both say the same thing. Client-safe: no server imports.
 */

export const CONFIDENCE_WORDS: Record<Confidence, string> = { high: "sure", medium: "fairly sure", low: "rough guess" };

/** What a dive without a forecast hour says instead. */
export function outlookMessage(outlook: Exclude<StopOutlook, { status: "forecast" }>): string {
  if (outlook.status === "unavailable") return "No forecast for this site right now.";
  if (outlook.status === "past") return "No forecast this far back.";
  return `The forecast reaches this dive ${outlook.opensOn ? `on ${dayLabel(outlook.opensOn)}` : "closer to the day"}.`;
}

/** `diveHour`: the forecast hour the dive starts in. */
export function warningText(warning: StopWarning, diveHour: string): string {
  if (warning.kind === "very-strong") {
    return warning.time === diveHour ? "Very strong current at this time" : `Very strong current from ${clock(warning.time)}`;
  }
  if (warning.kind === "wrong-way") return `Running ${warning.direction}; you wanted ${warning.want}`;
  return "Rough sea forecast here";
}

/** Under the warnings: the better window that day, or that there is none. `betterWay` is the best hour's way in words. */
export function betterText(outlook: Extract<StopOutlook, { status: "forecast" }>, betterWay: string | null): string {
  const better = outlook.better;
  if (!better) return "No better daylight hour that day.";
  const when = better.from === better.to ? `at ${clock(better.from)}` : `${clock(better.from)}–${clock(better.to)}`;
  const best = betterWay ? `, best ${clock(better.best.time)}: ${lower(betterWay)}, ${strengthLabel(better.best.strength)}` : "";
  return `Better ${when}${best}.`;
}

/**
 * The dive's marker colour: stop for a warned dive, incoming or outgoing at a channel, else plain ("none"). The web
 * maps it to its CSS tokens, the app to its theme.
 */
export type StopTone = "incoming" | "outgoing" | "stop" | "none";

export function stopTone(outlook: StopOutlook, route: ForecastRoute): StopTone {
  if (outlook.status !== "forecast") return "none";
  if (outlook.warnings.length > 0) return "stop";
  if (route !== "channel" || outlook.hour.strength === "slack") return "none";
  return outlook.hour.direction === "incoming" ? "incoming" : "outgoing";
}

export function strengthWords(strength: Strength): string {
  return capital(strengthLabel(strength));
}

/** "Sea rough · 1.2 m". */
export function seaWords(band: string, feltM: number): string {
  return `Sea ${band} · ${feltM.toFixed(1)} m`;
}

/** A boat leg between two dives in words: distance and time, when to leave, and whether the line is routed. */
export type LegWords = {
  /** "2.1 nm · about 20 min at 8 kn", or "Same spot". */
  text: string;
  /** "Leave by 10:35", or null for the same spot or a leg with no time. */
  leaveBy: string | null;
  /** The leave-by time comes less than a dive's turnaround after the dive before. */
  tight: boolean;
  /** " · tight: the 09:00 dive needs about 60 min", or null. */
  tightNote: string | null;
  /** "Straight line: no way round the reef found", or null. */
  note: string | null;
};

export function legWords(
  leg: { lengthKm: number; minutes: number; routed: boolean },
  speedKn: number,
  fromTime: string,
  toTime: string,
): LegWords {
  const nm = nmFromKm(leg.lengthKm);
  const same = nm < 0.1;
  const departure = same ? null : legDeparture(fromTime, toTime, leg.minutes);
  return {
    text: same ? "Same spot" : `${nm.toFixed(1)} nm · about ${durationText(leg.minutes)} at ${speedKn} kn`,
    leaveBy: departure ? `Leave by ${departure.leaveBy}` : null,
    tight: departure?.tight ?? false,
    tightNote: departure?.tight ? `tight: the ${fromTime} dive needs about ${DIVE_TURNAROUND_MIN} min` : null,
    note: leg.routed ? null : "Straight line: no way round the reef found",
  };
}

/** The wanted way at a channel, in words, for the dive line. */
export function wantWords(want: Direction | null): string | null {
  return want ? `Wanted: ${want}` : null;
}

function clock(time: string): string {
  return time.slice(11, 16);
}

function lower(words: string): string {
  return words.charAt(0).toLowerCase() + words.slice(1);
}
