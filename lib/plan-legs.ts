import { etaMinutes, KM_PER_NM } from "./boat-nav";

/**
 * A plan day's boat legs and dive order: leg times, when to leave, and moving a dive up or down. Pure; the editor and
 * the plan page share it. Leg times shown and leave-by times use the same rounding, up to 5 minutes, so the two never
 * disagree and the boat is never told to leave late.
 */

/** Nautical miles from km, for leg and day totals. */
export function nmFromKm(km: number): number {
  return km / KM_PER_NM;
}

/** Boat time for a leg, minutes, at the plan's speed through the water (no current). */
export function legMinutes(lengthKm: number, speedKn: number): number {
  // A plan's speed is never below BOAT_SPEED_MIN_KN, so the boat is always under way.
  return etaMinutes(lengthKm, speedKn) ?? Infinity;
}

/** Boat minutes as shown: rounded up to 5, at least 5. */
export function roundedMinutes(minutes: number): number {
  return Math.max(5, Math.ceil(minutes / 5) * 5);
}

/** "45 min", "1 h 20 min", from roundedMinutes. */
export function durationText(minutes: number): string {
  const rounded = roundedMinutes(minutes);
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** Minutes from a dive's entry until the boat can move on: the dive itself and getting everyone back on board. */
export const DIVE_TURNAROUND_MIN = 60;

export type LegDeparture = {
  /** "HH:MM": the next dive's entry less the leg time as shown, on a 5-minute mark. */
  leaveBy: string;
  /** Leaving then comes less than DIVE_TURNAROUND_MIN after the dive before went in (or before it). */
  tight: boolean;
};

/**
 * When the boat must leave one dive to make the next on time. Both times are "HH:MM" on the same day; null when the
 * leg has no time or leaving would fall before midnight.
 */
export function legDeparture(fromTime: string, toTime: string, legMin: number): LegDeparture | null {
  if (!Number.isFinite(legMin)) return null;
  const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const leave = Math.floor((minutesOf(toTime) - roundedMinutes(legMin)) / 5) * 5;
  if (leave < 0) return null;
  const leaveBy = `${String(Math.floor(leave / 60)).padStart(2, "0")}:${String(leave % 60).padStart(2, "0")}`;
  return { leaveBy, tight: leave - minutesOf(fromTime) < DIVE_TURNAROUND_MIN };
}

/**
 * Swaps the dive at `at` with the one above (-1) or below (+1). The times stay in their rows, so the day still reads in
 * time order and only the sites, with their notes and wanted current, change places. Out of range changes nothing.
 */
export function moveStopKeepingTimes<T extends { time: string }>(stops: readonly T[], at: number, by: -1 | 1): T[] {
  const other = at + by;
  if (at < 0 || at >= stops.length || other < 0 || other >= stops.length) return [...stops];
  const moved = [...stops];
  moved[at] = { ...stops[other], time: stops[at].time };
  moved[other] = { ...stops[at], time: stops[other].time };
  return moved;
}
