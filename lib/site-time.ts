import type { Site } from "./types";

/**
 * The time zone a dive site's reports are entered in: always the country where the site is, never the diver's own.
 * Times are stored as that country's wall clock. Only the Maldives exists today; a new country adds its zone here
 * (with `timeZoneForSite` choosing by atoll), and its wall-clock helpers alongside `toMaldivesWall`.
 * Offsets are fixed: the Maldives has no daylight saving.
 */
export type SiteTimeZone = { id: string; place: string; offsetMinutes: number };

export const MALDIVES_TIME: SiteTimeZone = { id: "Indian/Maldives", place: "Maldives", offsetMinutes: 5 * 60 };

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

export function timeZoneForSite(site: Pick<Site, "atollId">): SiteTimeZone {
  void site;
  return MALDIVES_TIME;
}

/** "UTC+5", "UTC+5:30", "UTC-3", "UTC". */
export function utcOffsetLabel(offsetMinutes: number): string {
  if (offsetMinutes === 0) return "UTC";
  const sign = offsetMinutes > 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return `UTC${sign}${hours}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}`;
}

/** "Maldives time (UTC+5)". */
export function zoneLabel(zone: SiteTimeZone): string {
  return `${zone.place} time (${utcOffsetLabel(zone.offsetMinutes)})`;
}

/** The zone's wall clock now, "YYYY-MM-DDTHH:MM". */
export function currentWallTime(zone: SiteTimeZone, nowMs: number = Date.now()): string {
  return new Date(nowMs + zone.offsetMinutes * MINUTE_MS).toISOString().slice(0, 16);
}

/** The current hour on the zone's wall clock, "YYYY-MM-DDTHH:00": the report form's starting time. */
export function currentWallHour(zone: SiteTimeZone, nowMs: number = Date.now()): string {
  return `${currentWallTime(zone, nowMs).slice(0, 13)}:00`;
}

/**
 * What a wall time in the site's zone reads on a viewer's clock, as "HH:MM" plus their offset label, or null when
 * the viewer is on the site's time or the input is not a wall time.
 */
export function viewerClock(
  wall: string,
  zone: SiteTimeZone,
  viewerOffsetMinutes: number,
): { clock: string; offset: string; dayShift: number } | null {
  if (viewerOffsetMinutes === zone.offsetMinutes) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wall);
  if (!match) return null;
  const siteMs = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]);
  const viewerMs = siteMs + (viewerOffsetMinutes - zone.offsetMinutes) * MINUTE_MS;
  const viewer = new Date(viewerMs);
  const dayShift = Math.round(
    (Date.UTC(viewer.getUTCFullYear(), viewer.getUTCMonth(), viewer.getUTCDate()) -
      Date.UTC(+match[1], +match[2] - 1, +match[3])) /
      (24 * HOUR_MS),
  );
  return { clock: viewer.toISOString().slice(11, 16), offset: utcOffsetLabel(viewerOffsetMinutes), dayShift };
}
