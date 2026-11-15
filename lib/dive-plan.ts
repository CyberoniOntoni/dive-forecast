import type { Direction, DivePlan, ForecastRoute, HourForecast, PlanDay, PlanStop, SeaBand, SeaStateHour } from "./types";

/**
 * Dive plans: checking what a guide saves, and reading each planned dive against the forecast. Pure, so the plan page,
 * the editor and the tests share it. The store keeps plans (lib/store.ts), lib/plan-actions.ts is the way in.
 */

export const PLAN_TITLE_MAX = 80;
export const PLAN_NOTES_MAX = 1500;
export const STOP_NOTE_MAX = 300;
/** A two-week liveaboard, with room to spare. */
export const PLAN_DAYS_MAX = 16;
/** Four dives and a night dive is the most any boat does in a day. */
export const PLAN_STOPS_PER_DAY_MAX = 6;
/** Plans one diver keeps; delete an old one to make room. */
export const PLANS_PER_DIVER_MAX = 40;
export const BOAT_SPEED_MIN_KN = 3;
export const BOAT_SPEED_MAX_KN = 40;
/** A dhoni's usual cruising speed. */
export const DEFAULT_BOAT_SPEED_KN = 8;
/** The first and last hours a day dive starts, for the suggested window. Night dives keep the planned time. */
export const DAY_DIVE_FIRST_HOUR = 6;
export const DAY_DIVE_LAST_HOUR = 17;

const PLAN_ID = /^[A-Za-z0-9]{12,32}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** A share id: 16 letters from 56, about 93 bits, so a link cannot be guessed. */
export function newPlanId(): string {
  // 256 is not a multiple of 56: bytes from 224 up are drawn again, so every letter is equally likely.
  const limit = Math.floor(256 / ID_LETTERS.length) * ID_LETTERS.length;
  let out = "";
  while (out.length < 16) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < limit && out.length < 16) out += ID_LETTERS[byte % ID_LETTERS.length];
    }
  }
  return out;
}

export function isPlanId(id: unknown): id is string {
  return typeof id === "string" && PLAN_ID.test(id);
}

/** A site as the editor's picker lists it. `channel`: it reads incoming and outgoing, so the guide can say which way. */
export type PickerSite = { id: string; name: string; atoll: string | null; channel: boolean };

/** What the editor sends: everything but the ids, owner and stamps. */
export type PlanInput = {
  title: string;
  notes?: string;
  boatSpeedKn: number;
  days: PlanDay[];
};

/** Plain text, one line or several: control characters out, runs of blank lines kept to one, trimmed. */
function cleanText(value: unknown, max: number, label: string, multiline: boolean): string {
  if (value == null) return "";
  if (typeof value !== "string") throw new Error(`${label} must be text`);
  const stripped = value.replace(multiline ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, " ");
  const text = (multiline ? stripped.replace(/\n{3,}/g, "\n\n") : stripped.replace(/\s+/g, " ")).trim();
  if (text.length > max) throw new Error(`${label} must be at most ${max} characters`);
  return text;
}

/** A real calendar date, "YYYY-MM-DD". */
export function isPlanDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

/**
 * The plan as it is saved: text cleaned, days in date order (each date once), dives in time order, every site known.
 * Throws a message the editor can show.
 */
export function requirePlanInput(input: unknown, knownSite: (id: string) => boolean): PlanInput {
  if (input === null || typeof input !== "object") throw new Error("Plan is required");
  const body = input as Record<string, unknown>;
  const title = cleanText(body.title, PLAN_TITLE_MAX, "Title", false);
  if (!title) throw new Error("Give the plan a title");
  const notes = cleanText(body.notes, PLAN_NOTES_MAX, "Notes", true);
  const speed = Number(body.boatSpeedKn);
  if (!Number.isFinite(speed) || speed < BOAT_SPEED_MIN_KN || speed > BOAT_SPEED_MAX_KN) {
    throw new Error(`Boat speed must be ${BOAT_SPEED_MIN_KN} to ${BOAT_SPEED_MAX_KN} knots`);
  }
  if (!Array.isArray(body.days) || body.days.length === 0) throw new Error("Add at least one day");
  if (body.days.length > PLAN_DAYS_MAX) throw new Error(`A plan has at most ${PLAN_DAYS_MAX} days`);
  const days = body.days.map((day) => requireDay(day, knownSite));
  days.sort((a, b) => a.date.localeCompare(b.date));
  for (let index = 1; index < days.length; index += 1) {
    if (days[index].date === days[index - 1].date) throw new Error(`${dayLabel(days[index].date)} is in the plan twice`);
  }
  return { title, ...(notes ? { notes } : {}), boatSpeedKn: Math.round(speed * 10) / 10, days };
}

function requireDay(input: unknown, knownSite: (id: string) => boolean): PlanDay {
  if (input === null || typeof input !== "object") throw new Error("Bad day");
  const day = input as Record<string, unknown>;
  if (!isPlanDate(day.date)) throw new Error("Each day needs a date");
  const date = day.date;
  const year = Number(date.slice(0, 4));
  if (year < 2020 || year > 2100) throw new Error("Each day needs a date");
  if (!Array.isArray(day.stops)) throw new Error("Bad day");
  if (day.stops.length > PLAN_STOPS_PER_DAY_MAX) {
    throw new Error(`${dayLabel(date)} has more than ${PLAN_STOPS_PER_DAY_MAX} dives`);
  }
  const stops = day.stops.map((stop) => requireStop(stop, date, knownSite));
  stops.sort((a, b) => a.time.localeCompare(b.time));
  return { date, stops };
}

function requireStop(input: unknown, date: string, knownSite: (id: string) => boolean): PlanStop {
  if (input === null || typeof input !== "object") throw new Error("Bad dive");
  const stop = input as Record<string, unknown>;
  if (typeof stop.siteId !== "string" || !knownSite(stop.siteId)) {
    throw new Error(`Pick a dive site for each dive on ${dayLabel(date)}`);
  }
  if (typeof stop.time !== "string" || !CLOCK.test(stop.time)) {
    throw new Error(`Give each dive on ${dayLabel(date)} a time`);
  }
  const note = cleanText(stop.note, STOP_NOTE_MAX, "A dive note", true);
  const want = stop.want === "incoming" || stop.want === "outgoing" ? stop.want : undefined;
  return { siteId: stop.siteId, time: stop.time, ...(note ? { note } : {}), ...(want ? { want } : {}) };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Tue 17 Nov". */
export function dayLabel(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(day.getTime())) return date;
  return `${WEEKDAYS[day.getUTCDay()]} ${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]}`;
}

/** "17–23 Nov 2026", "30 Nov – 2 Dec 2026", or one day. */
export function planDateSpan(days: readonly Pick<PlanDay, "date">[]): string {
  if (days.length === 0) return "";
  const first = new Date(`${days[0].date}T00:00:00Z`);
  const last = new Date(`${days[days.length - 1].date}T00:00:00Z`);
  const d = (date: Date) => date.getUTCDate();
  const m = (date: Date) => MONTHS[date.getUTCMonth()];
  const y = (date: Date) => date.getUTCFullYear();
  if (days.length === 1 || first.getTime() === last.getTime()) return `${d(first)} ${m(first)} ${y(first)}`;
  if (y(first) !== y(last)) return `${d(first)} ${m(first)} ${y(first)} – ${d(last)} ${m(last)} ${y(last)}`;
  if (m(first) !== m(last)) return `${d(first)} ${m(first)} – ${d(last)} ${m(last)} ${y(last)}`;
  return `${d(first)}–${d(last)} ${m(last)} ${y(last)}`;
}

/** The plan's stops, numbered across the whole trip, for the list of dives. */
export function diveCount(plan: Pick<DivePlan, "days">): number {
  return plan.days.reduce((sum, day) => sum + day.stops.length, 0);
}

/** The forecast hour a dive starting at `date` `time` falls in: the hour it starts, rounded to the nearest. */
export function diveHour(date: string, time: string): string {
  const [hh, mm] = time.split(":").map(Number);
  const ms = Date.parse(`${date}T00:00:00Z`) + (hh * 60 + mm + 30) * 60_000;
  return `${new Date(ms).toISOString().slice(0, 13)}:00`;
}

/** The date `days` after a "YYYY-MM-DD" date. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function nextHour(hour: string): string {
  return `${new Date(Date.parse(`${hour}:00Z`) + 3_600_000).toISOString().slice(0, 13)}:00`;
}

export type StopWarning =
  /** The current at the dive (or the hour after it) is forecast very strong. */
  | { kind: "very-strong"; time: string }
  /** At a channel, the current runs the other way to the one the guide wants. */
  | { kind: "wrong-way"; want: Direction; direction: Direction }
  /** The sea is forecast rough at the site. */
  | { kind: "rough"; band: SeaBand };

/** A run of start hours on the dive's day with no warning, and the best of them. */
export type DiveWindow = { from: string; to: string; best: HourForecast };

export type StopOutlook =
  /** The site has no forecast now (no data, or the site is outside every seeded atoll). */
  | { status: "unavailable" }
  /** The dive is further ahead than the forecast reaches; `opensOn` is the first date it may show. */
  | { status: "beyond"; opensOn: string | null }
  /** The dive is before the forecast's first hour. */
  | { status: "past" }
  | {
      status: "forecast";
      hour: HourForecast;
      sea: SeaStateHour | null;
      warnings: StopWarning[];
      /** The window that day the dive would be better in, when the planned time has a warning; else null. */
      better: DiveWindow | null;
    };

/** How a site's forecast hours read for the plan: by route, and the hours themselves. */
export type SiteHours = {
  route: ForecastRoute;
  hours: readonly HourForecast[];
  sea: readonly SeaStateHour[] | null;
  unavailable: boolean;
};

/** Whether a "want" applies: only a channel reads incoming and outgoing across the rim. */
function wants(route: ForecastRoute, want: Direction | undefined): Direction | null {
  return route === "channel" && want ? want : null;
}

function hourWarnings(
  hour: HourForecast,
  after: HourForecast | undefined,
  sea: SeaStateHour | null,
  want: Direction | null,
): StopWarning[] {
  const warnings: StopWarning[] = [];
  const strong = hour.strength === "too_strong" ? hour : after?.strength === "too_strong" ? after : null;
  if (strong) warnings.push({ kind: "very-strong", time: strong.time });
  if (want && hour.direction !== want && hour.strength !== "slack") {
    warnings.push({ kind: "wrong-way", want, direction: hour.direction });
  }
  if (sea?.band === "rough") warnings.push({ kind: "rough", band: sea.band });
  return warnings;
}

/** Mild is the easy drift most divers want; strong still dives; slack is the least interesting. */
const STRENGTH_SCORE = { mild: 3, strong: 2, slack: 1, too_strong: 0 } as const;
const CONFIDENCE_SCORE = { high: 0.5, medium: 0.25, low: 0 } as const;

/**
 * The best stretch of day-dive start hours on `date` with no warning: the run holding the best-scored hour (mild over
 * strong over slack, surer over less sure, earlier on a tie). Null when every hour has a warning or there is no
 * forecast that day.
 */
export function bestWindow(site: SiteHours, date: string, want: Direction | undefined): DiveWindow | null {
  const wanted = wants(site.route, want);
  const byTime = new Map(site.hours.map((hour) => [hour.time, hour]));
  const seaByTime = new Map((site.sea ?? []).map((hour) => [hour.time, hour]));
  const good: (HourForecast | null)[] = [];
  for (let h = DAY_DIVE_FIRST_HOUR; h <= DAY_DIVE_LAST_HOUR; h += 1) {
    const time = `${date}T${String(h).padStart(2, "0")}:00`;
    const hour = byTime.get(time);
    const ok = hour && hourWarnings(hour, byTime.get(nextHour(time)), seaByTime.get(time) ?? null, wanted).length === 0;
    good.push(ok ? hour : null);
  }
  let best: { index: number; score: number } | null = null;
  good.forEach((hour, index) => {
    if (!hour) return;
    const score = STRENGTH_SCORE[hour.strength] + CONFIDENCE_SCORE[hour.confidence];
    if (!best || score > best.score) best = { index, score };
  });
  if (!best) return null;
  const at = (best as { index: number }).index;
  let from = at;
  let to = at;
  while (from > 0 && good[from - 1]) from -= 1;
  while (to < good.length - 1 && good[to + 1]) to += 1;
  return { from: good[from]!.time, to: good[to]!.time, best: good[at]! };
}

/**
 * What the forecast says for one planned dive. `today` is the Maldives date now: a dive past the forecast's last hour
 * shows once the forecast has moved on as many days as it is short.
 */
export function stopOutlook(
  site: SiteHours,
  date: string,
  stop: Pick<PlanStop, "time" | "want">,
  today: string,
): StopOutlook {
  if (site.unavailable || site.hours.length === 0) return { status: "unavailable" };
  const time = diveHour(date, stop.time);
  const first = site.hours[0].time;
  const last = site.hours[site.hours.length - 1].time;
  if (time < first) return { status: "past" };
  if (time > last) {
    const shortDays = Math.ceil((Date.parse(`${time}:00Z`) - Date.parse(`${last}:00Z`)) / 86_400_000);
    return { status: "beyond", opensOn: addDays(today, shortDays) };
  }
  const byTime = new Map(site.hours.map((hour) => [hour.time, hour]));
  const hour = byTime.get(time);
  if (!hour) return { status: "unavailable" };
  const sea = (site.sea ?? []).find((item) => item.time === time) ?? null;
  const warnings = hourWarnings(hour, byTime.get(nextHour(time)), sea, wants(site.route, stop.want));
  let better: DiveWindow | null = null;
  if (warnings.length > 0) {
    const window = bestWindow(site, date, stop.want);
    if (window && !(window.from <= time && time <= window.to)) better = window;
  }
  return { status: "forecast", hour, sea, warnings, better };
}

/** Days a dive can still be reported after it (lib/actions.ts REPORT_MAX_AGE_DAYS). */
export const REPORT_DAYS = 14;

/**
 * Whether the dive is over (an hour after it started) and recent enough to report, at Maldives wall time `nowWall`
 * ("YYYY-MM-DDTHH:MM").
 */
export function canReportDive(date: string, time: string, nowWall: string): boolean {
  const start = Date.parse(`${date}T${time}:00Z`);
  const now = Date.parse(`${nowWall}:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(now)) return false;
  return now >= start + 3_600_000 && now - start <= REPORT_DAYS * 86_400_000;
}

/** Boat time for a leg, minutes, at the plan's speed through the water (no current). */
export function legMinutes(lengthKm: number, speedKn: number): number {
  return (lengthKm / 1.852 / speedKn) * 60;
}

/** "45 min", "1 h 20 min". */
export function durationText(minutes: number): string {
  const rounded = Math.max(5, Math.round(minutes / 5) * 5);
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
