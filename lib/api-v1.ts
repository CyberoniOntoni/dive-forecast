import { FORECAST_MODEL_VERSION } from "./forecast";
import type { SiteNowcast } from "./nowcast";
import { photoUrl } from "./site-photos-limits";
import type { Atoll, Site, SiteForecast, SiteType } from "./types";

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

export type ApiNowcast = {
  apiVersion: number;
  modelVersion: string;
  /** The Maldives wall time the hours were picked for. */
  maldivesWall: string;
  nowcasts: SiteNowcast[];
};

export type ApiForecast = SiteForecast & { apiVersion: number; modelVersion: string; siteId: string };

export type ApiErrorCode = "not_found" | "bad_request" | "server_error";

export function apiSite(site: Site): ApiSite {
  const userAdded = site.sourceUrl === "user";
  return {
    id: site.id,
    name: site.name,
    atollId: site.atollId,
    lat: site.lat,
    lon: site.lon,
    siteType: site.siteType ?? null,
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

export function apiSites(sites: readonly Site[], atolls: readonly Atoll[]): ApiSites {
  return {
    apiVersion: API_VERSION,
    atolls: atolls.map((atoll) => ({ id: atoll.id, name: atoll.name })),
    sites: sites.filter((site) => !site.hidden).map(apiSite),
  };
}

export function apiNowcast(nowcasts: SiteNowcast[], maldivesWall: string): ApiNowcast {
  return { apiVersion: API_VERSION, modelVersion: FORECAST_MODEL_VERSION, maldivesWall, nowcasts };
}

export function apiForecast(siteId: string, forecast: SiteForecast): ApiForecast {
  return { apiVersion: API_VERSION, modelVersion: FORECAST_MODEL_VERSION, siteId, ...forecast };
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
