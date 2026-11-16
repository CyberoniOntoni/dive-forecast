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
import { awardLine, type ReportAward } from "./points-rules";
import type { RecentReportRow } from "./recent-reports";
import { photoUrl } from "./site-photos-limits";
import { SITE_TYPE_LABEL } from "./site-type";
import type {
  Atoll,
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
  return /^Bearer\s+\S+/i.test(request.headers.get("authorization") ?? "")
    ? null
    : apiError(401, "unauthorized", "Sign in first.");
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
