import { bearerToken } from "./auth";
import {
  BOAT_SPEED_MAX_KN,
  BOAT_SPEED_MIN_KN,
  DEFAULT_BOAT_SPEED_KN,
  PLAN_DAYS_MAX,
  PLAN_GONE,
  PLAN_NOT_YOURS,
  PLAN_NOT_YOURS_OR_GONE,
  PLAN_UNKNOWN,
  PLAN_NOTES_MAX,
  PLAN_STOPS_PER_DAY_MAX,
  PLAN_TITLE_MAX,
  PLAN_YEAR_MAX,
  PLAN_YEAR_MIN,
  PLANS_PER_DIVER_MAX,
  type PickerSite,
  planSize,
  STOP_NOTE_MAX,
  warnedCount,
} from "./dive-plan";
import { FORECAST_MODEL_VERSION } from "./forecast";
import type { SiteNowcast } from "./nowcast";
import {
  compassWord,
  glanceRank,
  hourGlance,
  onCompass,
  routeDirectionLegend,
  type GlanceBearings,
  type GlanceTone,
} from "./nowcast-glance";
import type { PlanLeg, PlanSummary, SavePlanResult } from "./plan-actions";
import type { PlanStopView, PlanView } from "./plan-view";
import {
  betterText,
  CONFIDENCE_WORDS,
  confidenceLabel,
  legWords,
  outlookMessage,
  seaWords,
  stopTone,
  strengthWords,
  wantWords,
  warningText,
  type LegWords,
  type StopTone,
} from "./plan-words";
import { awardLine, type ReportAward } from "./points-rules";
import type { RecentReportRow } from "./recent-reports";
import { SIGN_IN_FIRST } from "./sign-in";
import { photoUrl } from "./site-photos-limits";
import { SITE_TYPE_LABEL } from "./site-type";
import type {
  Atoll,
  DivePlan,
  BearingSource,
  Direction,
  ForecastRoute,
  HourForecast,
  Report,
  SeaStateHour,
  Site,
  SiteForecast,
  SiteType,
  Strength,
} from "./types";

/**
 * The JSON API for the Android app (app/api/v1/*, contract in API.md). These functions only shape what the server
 * actions already return, so a response field never changes because the UI changed. Bump API_VERSION, and add a /v2
 * route, only for a change that breaks an old app: adding a field is not one.
 */
export const API_VERSION = 1;

/** A site as the app sees it: display fields only, no calibration data and no diver ids. */
export type ApiSite = {
  id: string;
  name: string;
  atollId: string;
  lat: number;
  lon: number;
  siteType: SiteType | null;
  /** The kind of site in words ("Rim pass"), as the site page says it. Null when not classified. */
  siteTypeLabel: string | null;
  /** The atoll's name, so one site's body needs no list of atolls. */
  atollName: string | null;
  /** True for a pin a diver added in the app. */
  userAdded: boolean;
  /** Where the site's catalog entry came from; null for a pin added in the app. */
  sourceUrl: string | null;
  diveTopM: number | null;
  diveMaxM: number | null;
  /** True when the pin was placed from imagery, so its position is approximate. */
  approximatePin: boolean;
  pinNote: string | null;
  howToDive: string | null;
  /** Paths on this server, oldest first. */
  photoUrls: string[];
};

export type ApiAtoll = { id: string; name: string };

export type ApiSites = { apiVersion: number; atolls: ApiAtoll[]; sites: ApiSite[] };

/**
 * How one site-hour reads on screen, made by lib/nowcast-glance.ts as the web map and site page make it, so the app
 * draws what it is given and a wording change ships with the server. Null wherever there is no arrow to draw.
 */
export type ApiGlance = {
  /** Degrees clockwise from north. */
  arrowBearing: number;
  /** "incoming", "outgoing", or "running NE" on a compass route. */
  way: string;
  /** The way in a sentence: adds "along the reef" at a wall. */
  spokenWay: string;
  /** The way with where a channel's water heads: "incoming, toward NE". Same as spokenWay off a channel. */
  wayToward: string;
  /** Strength in words: "slack", "mild", "strong", "very strong". */
  label: string;
  /** Which colour to draw it in: very strong is "stop"; along a reef or in a lagoon there is no in/out colour. */
  tone: GlanceTone;
  /** 0-1: lower confidence draws quieter. */
  opacity: number;
  /** Sort order for a list, strongest first: 0 very strong to 3 slack. */
  rank: number;
  /** True when the heading comes from the fallback heuristic, not a measurement or the atoll rim. */
  estimatedHeading: boolean;
};

export type ApiHour = HourForecast & { glance: ApiGlance | null };

/** One site's current hour, listed field by field like the forecast. */
export type ApiSiteNowcast = {
  siteId: string;
  atollId: string;
  inwardBearingDeg: number | null;
  outgoingBearingDeg: number | null;
  bearingSource: BearingSource | null;
  forecastRoute: ForecastRoute;
  alongHeadingDeg: number | null;
  hour: ApiHour | null;
  unavailable: boolean;
  stale: boolean;
  fetchedAt: number | null;
};

export type ApiNowcast = {
  apiVersion: number;
  modelVersion: string;
  /** The Maldives wall time the hours were picked for. */
  maldivesWall: string;
  nowcasts: ApiSiteNowcast[];
};

/** The forecast as the app sees it: an allow-list, so a field added to SiteForecast is not public until listed here. */
export type ApiForecast = {
  apiVersion: number;
  modelVersion: string;
  siteId: string;
  hours: ApiHour[];
  unavailable: boolean;
  stale: boolean;
  notice: string;
  inwardBearingDeg: number | null;
  /** The outgoing heading at a curved channel; null when outgoing is opposite incoming. */
  outgoingBearingDeg: number | null;
  bearingSource: BearingSource | null;
  siteType: SiteType | null;
  forecastRoute: ForecastRoute;
  alongHeadingDeg: number | null;
  siteNote: string | null;
  fetchedAt: number | null;
  seaState: SeaStateHour[] | null;
  /** True when the sea state comes from an old cached wave or wind series. */
  seaStale: boolean;
  /** The report form's words for this site, as the web form shows them. */
  reportWays: ApiReportWays;
};

/**
 * What the two report choices say: "Incoming" / "Outgoing" at a channel, the compass points the axis runs to elsewhere
 * ("Running NE" / "Running SW"), with the question above them. A report still sends `incoming` or `outgoing`.
 */
export type ApiReportWays = { legend: string; incoming: string; outgoing: string };

export function apiReportWays(route: ForecastRoute, alongHeadingDeg: number | null): ApiReportWays {
  const legend = routeDirectionLegend(route, alongHeadingDeg);
  if (!onCompass(route, alongHeadingDeg)) return { legend, incoming: "Incoming", outgoing: "Outgoing" };
  return { legend, incoming: `Running ${compassWord(alongHeadingDeg)}`, outgoing: `Running ${compassWord(alongHeadingDeg + 180)}` };
}

export type ApiErrorCode =
  | "not_found"
  | "bad_request"
  | "server_error"
  | "unauthorized"
  | "forbidden"
  | "needs_nickname";

export function apiSite(site: Site, atollName?: string | null): ApiSite {
  const userAdded = site.sourceUrl === "user";
  return {
    id: site.id,
    name: site.name,
    atollId: site.atollId,
    lat: site.lat,
    lon: site.lon,
    siteType: site.siteType ?? null,
    siteTypeLabel: site.siteType ? SITE_TYPE_LABEL[site.siteType] : null,
    atollName: atollName ?? null,
    userAdded,
    sourceUrl: userAdded ? null : site.sourceUrl,
    diveTopM: site.diveTopM ?? null,
    diveMaxM: site.diveMaxM ?? null,
    approximatePin: site.pinPlacement === "imagery",
    pinNote: site.pinNote ?? null,
    howToDive: site.howToDive ?? null,
    photoUrls: (site.photos ?? []).map((photo) => photoUrl(site.id, photo.id)),
  };
}

export function atollNameOf(atolls: readonly Atoll[], atollId: string): string | null {
  return atolls.find((atoll) => atoll.id === atollId)?.name ?? null;
}

export function apiSites(sites: readonly Site[], atolls: readonly Atoll[]): ApiSites {
  return {
    apiVersion: API_VERSION,
    atolls: atolls.map((atoll) => ({ id: atoll.id, name: atoll.name })),
    sites: sites.filter((site) => !site.hidden).map((site) => apiSite(site, atollNameOf(atolls, site.atollId))),
  };
}

/** The glance for one hour, or null when there is no hour or no bearing to point the arrow. A pick of hourGlance. */
export function apiGlance(hour: HourForecast | null, bearings: GlanceBearings): ApiGlance | null {
  if (!hour) return null;
  const g = hourGlance("", hour, bearings, true);
  if (
    g.arrowBearing == null ||
    g.way == null ||
    g.spokenWay == null ||
    g.wayToward == null ||
    g.label == null ||
    g.tone == null ||
    g.opacity == null
  ) {
    return null;
  }
  return {
    arrowBearing: g.arrowBearing,
    way: g.way,
    spokenWay: g.spokenWay,
    wayToward: g.wayToward,
    label: g.label,
    tone: g.tone,
    opacity: g.opacity,
    rank: glanceRank(g),
    estimatedHeading: g.estimatedHeading,
  };
}

function apiHour(hour: HourForecast, bearings: GlanceBearings): ApiHour {
  return {
    time: hour.time,
    direction: hour.direction,
    strength: hour.strength,
    confidence: hour.confidence,
    levelM: hour.levelM,
    glance: apiGlance(hour, bearings),
  };
}

function apiSiteNowcast(nowcast: SiteNowcast): ApiSiteNowcast {
  return {
    siteId: nowcast.siteId,
    atollId: nowcast.atollId,
    inwardBearingDeg: nowcast.inwardBearingDeg,
    outgoingBearingDeg: nowcast.outgoingBearingDeg,
    bearingSource: nowcast.bearingSource ?? null,
    forecastRoute: nowcast.forecastRoute,
    alongHeadingDeg: nowcast.alongHeadingDeg ?? null,
    hour: nowcast.hour ? apiHour(nowcast.hour, nowcast) : null,
    unavailable: nowcast.unavailable,
    stale: nowcast.stale ?? false,
    fetchedAt: nowcast.fetchedAt ?? null,
  };
}

export function apiNowcast(nowcasts: SiteNowcast[], maldivesWall: string): ApiNowcast {
  return {
    apiVersion: API_VERSION,
    modelVersion: FORECAST_MODEL_VERSION,
    maldivesWall,
    nowcasts: nowcasts.map(apiSiteNowcast),
  };
}

export function apiForecast(site: Site, forecast: SiteForecast): ApiForecast {
  const bearings: GlanceBearings = {
    inwardBearingDeg: forecast.inwardBearingDeg,
    // The site page's slider takes the curved outgoing heading from the site, not from the forecast.
    outgoingBearingDeg: site.outgoingBearingDeg ?? null,
    bearingSource: forecast.bearingSource,
    forecastRoute: forecast.forecastRoute,
    alongHeadingDeg: forecast.alongHeadingDeg,
  };
  return {
    apiVersion: API_VERSION,
    modelVersion: FORECAST_MODEL_VERSION,
    siteId: site.id,
    hours: forecast.hours.map((hour) => apiHour(hour, bearings)),
    unavailable: forecast.unavailable,
    stale: forecast.stale,
    notice: forecast.notice,
    inwardBearingDeg: forecast.inwardBearingDeg,
    outgoingBearingDeg: bearings.outgoingBearingDeg,
    bearingSource: forecast.bearingSource,
    siteType: forecast.siteType,
    forecastRoute: forecast.forecastRoute,
    alongHeadingDeg: forecast.alongHeadingDeg,
    siteNote: forecast.siteNote,
    fetchedAt: forecast.fetchedAt,
    seaState: forecast.seaState,
    seaStale: forecast.seaStale,
    reportWays: apiReportWays(forecast.forecastRoute, forecast.alongHeadingDeg),
  };
}

/**
 * How long the phone and any cache in between may keep a response. The marine series refresh every few hours and a
 * report can move the next hours, so five minutes fresh, then up to a day served while a new copy is fetched.
 */
export const API_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=86400";

export function apiJson(body: unknown, init?: { status?: number; cacheControl?: string }): Response {
  return Response.json(body, {
    status: init?.status ?? 200,
    headers: { "Cache-Control": init?.cacheControl ?? API_CACHE_CONTROL },
  });
}

export function apiError(status: number, code: ApiErrorCode, message: string): Response {
  return apiJson({ error: { code, message } }, { status, cacheControl: "no-store" });
}

/** Runs a handler and turns a throw into a JSON 500, logged, never the error's own text. */
export async function apiHandler(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    console.error("API v1 request failed", error);
    return apiError(500, "server_error", "Something went wrong. Try again.");
  }
}

/** For anything about one diver: never kept by the phone's HTTP cache or any cache in between. */
export const API_NO_STORE = "private, no-store";

/**
 * A write's JSON body as an object, or the error response to send. Only `application/json` is read: a browser cannot
 * send that to another site's address without asking first (CORS), and this API answers no such question.
 */
export async function apiJsonBody(request: Request): Promise<Record<string, unknown> | Response> {
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return apiError(415, "bad_request", "Send the body as application/json.");
  try {
    const body: unknown = await request.json();
    if (body !== null && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // Falls through to the error below.
  }
  return apiError(400, "bad_request", "The body is not a JSON object.");
}

/**
 * The 401 to send when a request that needs a diver has no `Authorization: Bearer` header, else null. Writes take the
 * app's token only, never the web's cookie, so a page on another site cannot file a report as a signed-in visitor.
 */
export function apiNeedsToken(request: Request): Response | null {
  return bearerToken(request.headers.get("authorization")) ? null : apiError(401, "unauthorized", "Sign in first.");
}

/** A diver's report as the site page lists it: words made on the server, and the nickname only. */
export type ApiRecentReport = {
  time: string;
  /** "Tue 30 Sep 09:00". */
  when: string;
  /** "2 days ago". */
  ago: string;
  /** "Incoming", "Outgoing", or "Running NE". */
  way: string;
  strength: string;
  /** What the forecast said at that hour, and how the report compares: "match", "close" or "miss". */
  forecast: { way: string; strength: string; match: string } | null;
  /** Filed before the site was read along its axis, so its in/out cannot be turned into a compass way. */
  beforeAxis: boolean;
  /** Nickname; null for reports from before sign-in. */
  by: string | null;
};

export type ApiRecentReports = { apiVersion: number; siteId: string; reports: ApiRecentReport[] };

export function apiRecentReports(siteId: string, rows: readonly RecentReportRow[]): ApiRecentReports {
  return {
    apiVersion: API_VERSION,
    siteId,
    reports: rows.map((row) => ({
      time: row.time,
      when: row.when,
      ago: row.ago,
      way: row.way,
      strength: row.strength,
      forecast: row.forecast
        ? { way: row.forecast.way, strength: row.forecast.strength, match: row.forecast.match }
        : null,
      beforeAxis: row.beforeAxis,
      by: row.by,
    })),
  };
}

/** A saved report: what was filed and what it earned. No diver id, and not the saved prediction. */
export type ApiReportSaved = {
  apiVersion: number;
  report: { id: string; siteId: string; time: string; direction: Direction; strength: Strength };
  /** `line` is what it earned in words, as the web form says it. */
  award: { points: number; reasons: string[]; uncounted: string | null; line: string } | null;
};

export function apiReportSaved(report: Report, award: ReportAward | null): ApiReportSaved {
  return {
    apiVersion: API_VERSION,
    report: {
      id: report.id,
      siteId: report.siteId,
      time: report.time,
      direction: report.direction,
      strength: report.strength,
    },
    award: award
      ? { points: award.points, reasons: [...award.reasons], uncounted: award.uncounted ?? null, line: awardLine(award) }
      : null,
  };
}

/** A dive plan as the app shows it (GET /api/v1/plans/{id}): every word made here, from the plan page's own rules. */
export type ApiPlan = {
  apiVersion: number;
  id: string;
  title: string;
  notes: string | null;
  boatSpeedKn: number;
  /** "17–23 Nov 2026". */
  span: string;
  ownerNickname: string | null;
  /** The signed-in diver made it: only they change it (on the web for now). */
  isOwner: boolean;
  /** The public page, to share. */
  webPath: string;
  updatedAt: string;
  /** Maldives wall time the plan was read. */
  nowWall: string;
  days: ApiPlanDay[];
};

export type ApiPlanDay = {
  date: string;
  /** "Tue 17 Nov". */
  label: string;
  today: boolean;
  past: boolean;
  /** Dives with a warning. */
  toCheck: number;
  stops: ApiPlanStop[];
};

export type ApiPlanStop = {
  siteId: string;
  name: string;
  lat: number;
  lon: number;
  /** "Pass · South Male · 5–30 m". */
  facts: string;
  howToDive: string | null;
  /** "HH:MM". */
  time: string;
  note: string | null;
  /** "Wanted: incoming" at a channel, or null. */
  want: string | null;
  /** forecast | unavailable | beyond | past. */
  status: string;
  /** Without a forecast hour: what to say instead. */
  message: string | null;
  /** "Incoming, toward NE"; null without a forecast hour. */
  way: string | null;
  arrowBearing: number | null;
  /** "Very strong", and whether it is (the page's warning colour). */
  strength: string | null;
  veryStrong: boolean;
  /** The stop colour for the marker: incoming | outgoing | stop | none. */
  tone: StopTone;
  /** "Sea rough · 1.2 m" and whether that is rough. */
  sea: string | null;
  seaRough: boolean;
  /** "fairly sure", and the line the page shows: "Forecast: fairly sure". */
  confidence: string | null;
  confidenceLabel: string | null;
  warnings: string[];
  /** With warnings: the better window that day, or that there is none. */
  better: string | null;
  /** Once the dive is over and still reportable: its wall time, for the report form. */
  reportTime: string | null;
};

export function apiPlan(view: PlanView): ApiPlan {
  const today = view.nowWall.slice(0, 10);
  return {
    apiVersion: API_VERSION,
    id: view.id,
    title: view.title,
    notes: view.notes,
    boatSpeedKn: view.boatSpeedKn,
    span: view.span,
    ownerNickname: view.ownerNickname,
    isOwner: view.isOwner,
    webPath: `/plans/${view.id}`,
    updatedAt: view.updatedAt,
    nowWall: view.nowWall,
    days: view.days.map((day) => ({
      date: day.date,
      label: day.label,
      today: day.date === today,
      past: day.date < today,
      toCheck: warnedCount(day.stops),
      stops: day.stops.map((stop) => apiPlanStop(day.date, stop)),
    })),
  };
}

function apiPlanStop(date: string, stop: PlanStopView): ApiPlanStop {
  const outlook = stop.outlook;
  const forecast = outlook.status === "forecast" ? outlook : null;
  return {
    siteId: stop.siteId,
    name: stop.name,
    lat: stop.lat,
    lon: stop.lon,
    facts: stop.facts,
    howToDive: stop.howToDive,
    time: stop.time,
    note: stop.note,
    want: wantWords(stop.want),
    status: outlook.status,
    message: outlook.status === "forecast" ? null : outlookMessage(outlook),
    way: stop.way,
    arrowBearing: forecast && forecast.hour.strength !== "slack" ? stop.arrowDeg : null,
    strength: forecast ? strengthWords(forecast.hour.strength) : null,
    veryStrong: forecast?.hour.strength === "too_strong",
    tone: stopTone(outlook, stop.route),
    sea: forecast?.sea ? seaWords(forecast.sea.band, forecast.sea.feltM) : null,
    seaRough: forecast?.sea?.band === "rough",
    confidence: forecast ? CONFIDENCE_WORDS[forecast.hour.confidence] : null,
    confidenceLabel: forecast ? confidenceLabel(forecast.hour.confidence) : null,
    warnings: forecast ? forecast.warnings.map((warning) => warningText(warning, forecast.hour.time)) : [],
    better: forecast && forecast.warnings.length > 0 ? betterText(forecast, stop.betterWay) : null,
    reportTime: stop.reportHref ? `${date}T${stop.time}` : null,
  };
}

/** One day's boat legs (GET /api/v1/plans/{id}/days/{index}/legs), in words, with the track to draw. */
export type ApiPlanLeg = LegWords & {
  /** Index of the dive the leg leaves from, among the day's dives. */
  from: number;
  lengthKm: number;
  minutes: number;
  routed: boolean;
  /** [lat, lon] pairs. */
  points: [number, number][];
};

export type ApiPlanLegs = { apiVersion: number; planId: string; dayIndex: number; legs: ApiPlanLeg[] };

export function apiPlanLegs(
  planId: string,
  dayIndex: number,
  legs: readonly PlanLeg[],
  speedKn: number,
): ApiPlanLegs {
  return {
    apiVersion: API_VERSION,
    planId,
    dayIndex,
    legs: legs.map((leg) => ({
      ...legWords(leg, speedKn, leg.fromTime, leg.toTime),
      from: leg.from,
      lengthKm: Math.round(leg.lengthKm * 1000) / 1000,
      minutes: Number.isFinite(leg.minutes) ? Math.round(leg.minutes) : 0,
      routed: leg.routed,
      points: leg.points.map(([lat, lon]) => [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5]),
    })),
  };
}

/** The signed-in diver's plans (GET /api/v1/plans). */
export type ApiPlanSummaries = {
  apiVersion: number;
  /** What the editor allows (lib/dive-plan.ts), so the app checks the same limits before it sends. */
  limits: ApiPlanLimits;
  plans: { id: string; title: string; span: string; size: string; first: string; last: string; updatedAt: string }[];
};

export function apiPlanSummaries(plans: readonly PlanSummary[]): ApiPlanSummaries {
  return {
    apiVersion: API_VERSION,
    limits: PLAN_LIMITS,
    plans: plans.map((plan) => ({
      id: plan.id,
      title: plan.title,
      span: plan.span,
      size: planSize(plan.days, plan.dives),
      first: plan.first,
      last: plan.last,
      updatedAt: plan.updatedAt,
    })),
  };
}

export type ApiPlanLimits = {
  titleMax: number;
  notesMax: number;
  diveNoteMax: number;
  daysMax: number;
  divesPerDayMax: number;
  plansMax: number;
  boatSpeedMinKn: number;
  boatSpeedMaxKn: number;
  boatSpeedDefaultKn: number;
  /** The years a day may fall in. */
  yearMin: number;
  yearMax: number;
};

export const PLAN_LIMITS: ApiPlanLimits = {
  titleMax: PLAN_TITLE_MAX,
  notesMax: PLAN_NOTES_MAX,
  diveNoteMax: STOP_NOTE_MAX,
  daysMax: PLAN_DAYS_MAX,
  divesPerDayMax: PLAN_STOPS_PER_DAY_MAX,
  plansMax: PLANS_PER_DIVER_MAX,
  boatSpeedMinKn: BOAT_SPEED_MIN_KN,
  boatSpeedMaxKn: BOAT_SPEED_MAX_KN,
  boatSpeedDefaultKn: DEFAULT_BOAT_SPEED_KN,
  yearMin: PLAN_YEAR_MIN,
  yearMax: PLAN_YEAR_MAX,
};

/**
 * A plan as its owner edits it (GET /api/v1/plans/{id}/edit): exactly what PUT takes back, so the app sends the same
 * shape it read. No owner id: only the owner gets this body.
 */
export type ApiEditablePlan = {
  apiVersion: number;
  id: string;
  title: string;
  notes: string | null;
  boatSpeedKn: number;
  days: { date: string; stops: { siteId: string; time: string; note: string | null; want: string | null }[] }[];
  updatedAt: string;
  limits: ApiPlanLimits;
};

export function apiEditablePlan(plan: DivePlan): ApiEditablePlan {
  return {
    apiVersion: API_VERSION,
    id: plan.id,
    title: plan.title,
    notes: plan.notes ?? null,
    boatSpeedKn: plan.boatSpeedKn,
    days: plan.days.map((day) => ({
      date: day.date,
      stops: day.stops.map((stop) => ({ siteId: stop.siteId, time: stop.time, note: stop.note ?? null, want: stop.want ?? null })),
    })),
    updatedAt: plan.updatedAt,
    limits: PLAN_LIMITS,
  };
}

/** A plan body from the app as the editor's checks take it: nulls read as left out. */
export function planInputFromApi(body: Record<string, unknown>): unknown {
  const days = Array.isArray(body.days)
    ? body.days.map((day) => {
        if (day === null || typeof day !== "object") return day;
        const { stops, ...rest } = day as Record<string, unknown>;
        return {
          ...rest,
          stops: Array.isArray(stops)
            ? stops.map((stop) => (stop !== null && typeof stop === "object" ? withoutNulls(stop as Record<string, unknown>) : stop))
            : stops,
        };
      })
    : body.days;
  return { ...withoutNulls(body), days };
}

function withoutNulls(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null));
}

/** savePlan's answer as the API's: the saved plan's id, or the editor's own words with a status. */
export function apiPlanSaved(result: SavePlanResult, created: boolean): Response {
  if (result.ok) {
    return apiJson({ apiVersion: API_VERSION, id: result.id }, { status: created ? 201 : 200, cacheControl: API_NO_STORE });
  }
  return apiPlanRefused(result.error);
}

/** A refused plan write: who may not, what is gone, or what to fix, in the web editor's words. */
export function apiPlanRefused(message: string): Response {
  if (message === SIGN_IN_FIRST) return apiError(401, "unauthorized", "Sign in again.");
  if (message === PLAN_GONE || message === PLAN_NOT_YOURS_OR_GONE || message === PLAN_UNKNOWN) {
    return apiError(404, "not_found", message);
  }
  if (message === PLAN_NOT_YOURS) return apiError(403, "forbidden", message);
  return apiError(400, "bad_request", message);
}

/** The plan editor's site picker (GET /api/v1/plan-sites). */
export type ApiPlanSites = { apiVersion: number; today: string; sites: PickerSite[] };

export function apiPlanSites(sites: readonly PickerSite[], today: string): ApiPlanSites {
  return {
    apiVersion: API_VERSION,
    today,
    sites: sites.map((site) => ({ id: site.id, name: site.name, atoll: site.atoll, channel: site.channel })),
  };
}
