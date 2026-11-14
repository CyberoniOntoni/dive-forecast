"use server";

import { atollForPin } from "./bearing";
import type { BoatTrip } from "./boat-route-data";
import { boatRoute } from "./boat-route-data";
import { readPointDestination } from "./point-destination";
import { FORECAST_NOTICE, parseWall, toMaldivesWall } from "./forecast";
import { siteNoteFor } from "./site-type";
import { forecastAtReport } from "./forecast-log";
import { alongHeadingFor, loadSite, reportTideForSite, type ReportTide, type SiteLoad } from "./load-site";
import { loadOffshore, siteSeaState, type Offshore } from "./sea-state";
import { shelterPoint, shelterShapes, shelterView, type ShelterView } from "./shelter-grid";
import type { RimRing } from "./rim";
import { recentReportRows, type RecentReportRow } from "./recent-reports";
import { currentWallTime, timeZoneForSite, zoneLabel, type SiteTimeZone } from "./site-time";
import { ready, readyWith } from "./ready";
import { currentSession, requireSession } from "./auth";
import { requireReviewText, requireSiteDetails, type SiteDetailsInput } from "./site-details";
import {
  cleanJpeg,
  deletePhotoBytes,
  isPhotoKey,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_SITE,
  photoUrl,
  savePhotoBytes,
} from "./site-photos";
import { unstable_rethrow as rethrowIfNextError } from "next/navigation";
import { reportAwards } from "./points";
import type { ReportAward } from "./points-rules";
import {
  addReport as persistReport,
  addReviewPhotoRecord,
  addSitePhotoRecord,
  addUserSite,
  findSite,
  listMergedSites,
  ratingsForSite,
  readCatalog,
  readStore,
  removeRating,
  removeReviewPhotoRecord,
  reportsForSite,
  saveRating,
  saveReviewText,
} from "./store";
import {
  STRENGTHS,
  UNSEEDED_ATOLL_ID,
  type Atoll,
  type Direction,
  type ForecastAtReport,
  type ForecastRoute,
  type Rating,
  type Report,
  type SeaStateHour,
  type Site,
  type SiteForecast,
  type SitePhoto,
  type Strength,
} from "./types";

const REPORT_HOUR_INDEX = 6;

export type ReportActionState = {
  success: boolean;
  error: string | null;
  /** What the saved report earned (lib/points.ts). */
  award?: ReportAward | null;
};

export async function listSites(): Promise<Site[]> {
  await ready();
  return listMergedSites();
}

export async function getSite(id: string): Promise<Site | null> {
  await ready();
  return findSite(id);
}

/** Sites one diver can add in 24 hours: every pin goes on everyone's map and is warmed every hour. */
const SITES_PER_DAY = 10;

export type AddSiteInput = SiteDetailsInput & { name: string; lat: number; lon: number; rating?: unknown };

export async function addSite(input: AddSiteInput): Promise<Site> {
  await ready();
  const session = await requireSession();
  const body = requireSiteInput(input);
  const name = requireSiteName(body.name);
  const lat = requireLatitude(body.lat);
  const lon = requireLongitude(body.lon);
  const details = requireSiteDetails(body);
  const rating = body.rating == null || body.rating === "" ? null : body.rating;
  if (rating != null) requireRatingScore(rating as number);
  const atolls = readCatalog().atolls;
  if (atolls.length === 0) throw new Error("No atolls");

  const atoll = atollForPin(lat, lon, atolls);
  const site = await addUserSite(
    {
      ...newUserSite(name, lat, lon, atoll?.id ?? UNSEEDED_ATOLL_ID),
      ...details,
      addedBy: session.userId,
      addedAt: new Date().toISOString(),
    },
    SITES_PER_DAY,
  );
  if (rating != null) {
    await saveRating({ siteId: site.id, score: rating as number, updatedAt: new Date().toISOString(), userId: session.userId });
  }
  return site;
}

export type SiteActionResult = { ok: true; site: Site } | { ok: false; error: string };

/**
 * addSite for the form: the reason comes back as a value, because a production build hides a thrown action's message.
 */
export async function submitSite(input: AddSiteInput): Promise<SiteActionResult> {
  try {
    return { ok: true, site: await addSite(input) };
  } catch (error) {
    rethrowIfNextError(error);
    return { ok: false, error: error instanceof Error && error.message ? error.message : "Could not add that site." };
  }
}

export type PhotoActionResult = { ok: true; photo: SitePhoto; url: string } | { ok: false; error: string };

/**
 * Adds one photo (form field "photo", a JPEG the browser already shrank) to a site the signed-in diver added. Only
 * the adder adds photos for now, up to MAX_PHOTOS_PER_SITE. Camera data (EXIF with GPS) is stripped before saving.
 */
export async function addSitePhoto(siteId: string, formData: FormData): Promise<PhotoActionResult> {
  await ready();
  try {
    const session = await requireSession();
    requireSiteId(siteId);
    const site = readStore().sites.find((item) => item.id === siteId && !item.hidden);
    if (!site) return { ok: false, error: "Photos can only be added to sites added in the app." };
    if (site.addedBy !== session.userId) return { ok: false, error: "Only the diver who added this site can add photos." };
    if ((site.photos?.length ?? 0) >= MAX_PHOTOS_PER_SITE) {
      return { ok: false, error: `A site can have at most ${MAX_PHOTOS_PER_SITE} photos.` };
    }
    const file = formData.get("photo");
    if (!(file instanceof Blob) || file.size === 0) return { ok: false, error: "Pick a photo." };
    if (file.size > MAX_PHOTO_BYTES) return { ok: false, error: "That photo is too large." };
    const clean = cleanJpeg(new Uint8Array(await file.arrayBuffer()));
    if (!clean) return { ok: false, error: "That photo is not a JPEG." };

    const photo: SitePhoto = { id: crypto.randomUUID(), addedBy: session.userId, addedAt: new Date().toISOString() };
    await savePhotoBytes(siteId, photo.id, clean);
    let saved = false;
    try {
      saved = await addSitePhotoRecord(siteId, photo, MAX_PHOTOS_PER_SITE);
    } finally {
      if (!saved) await deletePhotoBytes(siteId, photo.id);
    }
    if (!saved) return { ok: false, error: `A site can have at most ${MAX_PHOTOS_PER_SITE} photos.` };
    return { ok: true, photo, url: photoUrl(siteId, photo.id) };
  } catch (error) {
    rethrowIfNextError(error);
    return { ok: false, error: error instanceof Error && error.message ? error.message : "Could not save the photo." };
  }
}

/** The nickname of the diver who added a site, or null. */
export async function siteAdderNickname(siteId: string): Promise<string | null> {
  await ready();
  const addedBy = typeof siteId === "string" ? findSite(siteId)?.addedBy : undefined;
  if (!addedBy) return null;
  return readStore().users.find((user) => user.id === addedBy)?.nickname ?? null;
}

/** A site's ratings: the mean of every diver's, how many there are, and the signed-in diver's own. */
export type RatingSummary = { average: number | null; count: number; mine: number | null };

export async function rateSite(siteId: string, score: number): Promise<RatingSummary> {
  await ready();
  const session = await requireSession();
  requireSiteId(siteId);
  if (!findSite(siteId)) throw new Error("Unknown site");
  requireRatingScore(score);
  await saveRating({ siteId, score, updatedAt: new Date().toISOString(), userId: session.userId });
  return ratingSummary(ratingsForSite(siteId), session.userId);
}

/** The site's ratings, and the signed-in diver's own (never another diver's: the id comes from the session). */
export async function getRating(siteId: string): Promise<RatingSummary> {
  await ready();
  const session = await currentSession();
  return ratingSummary(ratingsForSite(siteId), session?.userId ?? null);
}

/** One diver's review of a site: their score, what they wrote and their photos. */
export type SiteReview = {
  userId: string;
  nickname: string;
  score: number;
  review: string | null;
  photos: { id: string; url: string }[];
  /** ISO UTC, when the score, text or photos last changed. */
  updatedAt: string;
};

/** Everything the site page's reviews card shows. */
export type SiteReviews = {
  summary: RatingSummary;
  /** Other divers' reviews that have text or photos, newest first; the signed-in diver's own is `mine`. */
  reviews: SiteReview[];
  mine: SiteReview | null;
};

export type ReviewActionResult = { ok: true; reviews: SiteReviews } | { ok: false; error: string };

/** Photos one diver can add to reviews in 24 hours, across every site. */
const REVIEW_PHOTOS_PER_DAY = 24;

/** The site's ratings and reviews, and the signed-in diver's own (the id comes from the session, never the page). */
export async function getSiteReviews(siteId: string): Promise<SiteReviews> {
  await ready();
  const session = await currentSession();
  return siteReviews(siteId, session?.userId ?? null);
}

function siteReviews(siteId: string, userId: string | null): SiteReviews {
  const ratings = ratingsForSite(siteId);
  const nicknames = new Map(readStore().users.map((user) => [user.id, user.nickname]));
  const all = ratings
    .filter((rating): rating is Rating & { userId: string } => rating.userId != null && nicknames.has(rating.userId))
    .map(
      (rating): SiteReview => ({
        userId: rating.userId,
        nickname: nicknames.get(rating.userId)!,
        score: rating.score,
        review: rating.review ?? null,
        photos: (rating.photos ?? []).map((photo) => ({ id: photo.id, url: photoUrl(siteId, photo.id) })),
        updatedAt: rating.updatedAt,
      }),
    );
  const reviews = all
    .filter((review) => review.userId !== userId && (review.review || review.photos.length))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return {
    summary: ratingSummary(ratings, userId),
    reviews,
    mine: userId ? (all.find((review) => review.userId === userId) ?? null) : null,
  };
}

/** Runs a review change for the signed-in diver on a known site; the reason comes back as a value. */
async function reviewAction(
  siteId: string,
  change: (userId: string) => Promise<string | null>,
): Promise<ReviewActionResult> {
  await ready();
  try {
    const session = await requireSession();
    requireSiteId(siteId);
    if (!findSite(siteId)) return { ok: false, error: "Unknown site." };
    const problem = await change(session.userId);
    if (problem) return { ok: false, error: problem };
    return { ok: true, reviews: siteReviews(siteId, session.userId) };
  } catch (error) {
    rethrowIfNextError(error);
    return { ok: false, error: error instanceof Error && error.message ? error.message : "Could not save that." };
  }
}

/** rateSite for the reviews card: the whole card comes back, and the reason as a value. */
export async function submitRating(siteId: string, score: number): Promise<ReviewActionResult> {
  return reviewAction(siteId, async (userId) => {
    if (!Number.isInteger(score) || score < 1 || score > 5) return "Pick a rating from 1 to 5.";
    await saveRating({ siteId, score, updatedAt: new Date().toISOString(), userId });
    return null;
  });
}

/** Writes, changes or (with empty text) clears the signed-in diver's review. They rate the site first. */
export async function saveReview(siteId: string, text: string): Promise<ReviewActionResult> {
  return reviewAction(siteId, async (userId) => {
    const review = requireReviewText(text);
    const saved = await saveReviewText(siteId, userId, review, new Date().toISOString());
    return saved ? null : "Rate the site first, then write your review.";
  });
}

/**
 * Adds one photo (form field "photo", a JPEG the browser already shrank) to the signed-in diver's review of any site,
 * up to MAX_PHOTOS_PER_SITE per review and REVIEW_PHOTOS_PER_DAY a day. Camera data is stripped before saving.
 */
export async function addReviewPhoto(siteId: string, formData: FormData): Promise<PhotoActionResult> {
  await ready();
  try {
    const session = await requireSession();
    requireSiteId(siteId);
    if (!findSite(siteId)) return { ok: false, error: "Unknown site." };
    const file = formData.get("photo");
    if (!(file instanceof Blob) || file.size === 0) return { ok: false, error: "Pick a photo." };
    if (file.size > MAX_PHOTO_BYTES) return { ok: false, error: "That photo is too large." };
    const clean = cleanJpeg(new Uint8Array(await file.arrayBuffer()));
    if (!clean) return { ok: false, error: "That photo is not a JPEG." };

    const photo: SitePhoto = { id: crypto.randomUUID(), addedBy: session.userId, addedAt: new Date().toISOString() };
    await savePhotoBytes(siteId, photo.id, clean);
    let problem: Awaited<ReturnType<typeof addReviewPhotoRecord>> | "failed" = "failed";
    try {
      problem = await addReviewPhotoRecord(siteId, session.userId, photo, MAX_PHOTOS_PER_SITE, REVIEW_PHOTOS_PER_DAY);
    } finally {
      if (problem) await deletePhotoBytes(siteId, photo.id);
    }
    if (problem === "not-rated") return { ok: false, error: "Rate the site first, then add your photos." };
    if (problem === "full") return { ok: false, error: `A review can have at most ${MAX_PHOTOS_PER_SITE} photos.` };
    if (problem === "daily-limit") {
      return { ok: false, error: `You can add up to ${REVIEW_PHOTOS_PER_DAY} photos a day. Try again tomorrow.` };
    }
    return { ok: true, photo, url: photoUrl(siteId, photo.id) };
  } catch (error) {
    rethrowIfNextError(error);
    return { ok: false, error: error instanceof Error && error.message ? error.message : "Could not save the photo." };
  }
}

/** Takes one of the signed-in diver's own photos off their review, and deletes it. */
export async function removeReviewPhoto(siteId: string, photoId: string): Promise<ReviewActionResult> {
  return reviewAction(siteId, async (userId) => {
    if (typeof photoId !== "string" || !isPhotoKey(siteId, photoId)) return "Unknown photo.";
    if (!(await removeReviewPhotoRecord(siteId, userId, photoId))) return "That photo is not on your review.";
    await deletePhotoBytes(siteId, photoId);
    return null;
  });
}

/**
 * Removes the signed-in diver's rating of a site, with their review and photos, and the points it earned. Rating the
 * site again earns them back on the day it was first rated, never anew.
 */
export async function removeMyRating(siteId: string): Promise<ReviewActionResult> {
  return reviewAction(siteId, async (userId) => {
    const photos = await removeRating(siteId, userId, new Date().toISOString());
    if (photos == null) return "You have not rated this site.";
    await Promise.all(photos.map((photo) => deletePhotoBytes(siteId, photo.id)));
    return null;
  });
}

function ratingSummary(ratings: readonly Rating[], userId: string | null): RatingSummary {
  const count = ratings.length;
  const average = count ? Math.round((ratings.reduce((sum, item) => sum + item.score, 0) / count) * 10) / 10 : null;
  const mine = userId ? (ratings.find((item) => item.userId === userId)?.score ?? null) : null;
  return { average, count, mine };
}

export async function addReport(input: unknown): Promise<Report> {
  await ready();
  const session = await requireSession();
  const body = requireReportInput(input);
  const site = findSite(body.siteId as string);
  if (!site) throw new Error("Unknown site");
  requireDirection(body.direction as Direction);
  requireStrength(body.strength as Strength);

  // A report's time is the dive site's own wall clock (lib/site-time.ts); today that is always the Maldives.
  const zone = timeZoneForSite(site);
  const time = requireReportTime(body.time);
  const filedAt = new Date();
  requireNotAhead(time, zone, filedAt.getTime());
  requireNotTooOld(time, zone, filedAt.getTime());
  requireNotDuplicate(site.id, time, body.direction as Direction, body.strength as Strength, filedAt.getTime());
  const tide = await reportTide(site, time);
  const predicted = await predictionAtReport(site, time);
  const report: Report = {
    id: crypto.randomUUID(),
    siteId: body.siteId as string,
    time,
    direction: body.direction as Direction,
    strength: body.strength as Strength,
    slopeM: tide ? tide.slopeWindowM[REPORT_HOUR_INDEX] : null,
    filedAt: filedAt.toISOString(),
    userId: session.userId,
  };
  if (tide) {
    report.slopeWindowM = tide.slopeWindowM;
    if (tide.rangeM != null) report.rangeM = tide.rangeM;
    if (tide.throughflowM != null) report.throughflowM = tide.throughflowM;
    if (tide.headWindowM != null) report.headWindowM = tide.headWindowM;
  }
  const along = await reportAlongHeading(site);
  if (along != null) report.alongHeadingDeg = Math.round(along);
  if (predicted) report.predicted = predicted;
  return persistReport(report);
}

export async function addReportAction(siteId: string, formData: FormData): Promise<ReportActionState> {
  await ready();
  try {
    const time = String(formData.get("time") ?? "").trim();
    const direction = String(formData.get("direction") ?? "");
    const strength = String(formData.get("strength") ?? "");
    const report = await addReport({
      siteId,
      time,
      direction: direction as Direction,
      strength: strength as Strength,
    });
    return { success: true, error: null, award: reportAwards(readStore().reports).get(report.id) ?? null };
  } catch (caught) {
    const error = caught instanceof Error ? caught.message : "Could not add that report.";
    return { success: false, error };
  }
}

/**
 * The forecast for the report hour as the site page shows it, plus the model alone. Never blocks a report.
 * Only reports from before this dive count, as in the replay, so a back-dated report is not scored on later dives.
 */
async function predictionAtReport(site: Site, time: string): Promise<ForecastAtReport | null> {
  try {
    const catalog = readCatalog();
    const atoll = catalog.atolls.find((item) => item.id === site.atollId);
    const diveMs = parseWall(time);
    const earlier = reportsForSite(site.id).filter((report) => parseWall(report.time) < diveMs);
    const shown = await loadSite(site, catalog.sites, atoll, earlier);
    const modelOnly = await loadSite(site, catalog.sites, atoll, []);
    return forecastAtReport(shown, modelOnly, time);
  } catch {
    return null;
  }
}

/**
 * The compass heading "incoming" meant for this site when the report was filed. A wall's or strait's comes from its
 * bearing; a lagoon site's is the main axis of its lagoon flow, so it comes from the forecast. Never blocks a report.
 */
async function reportAlongHeading(site: Site): Promise<number | null> {
  try {
    const catalog = readCatalog();
    const atoll = catalog.atolls.find((item) => item.id === site.atollId);
    if (site.siteType === "lagoon") return (await loadSite(site, catalog.sites, atoll, [])).alongHeadingDeg;
    return alongHeadingFor(site, catalog.sites, atoll);
  } catch {
    return null;
  }
}

async function reportTide(site: Site, time: string): Promise<ReportTide | null> {
  try {
    const catalog = readCatalog();
    const atoll = catalog.atolls.find((item) => item.id === site.atollId);
    return await reportTideForSite(site, catalog.sites, atoll, time);
  } catch {
    return null;
  }
}

export async function forecastSite(siteId: string): Promise<SiteForecast> {
  await ready();
  const site = findSite(siteId);
  if (!site) return unavailableForecast();

  const catalog = readCatalog();
  const atoll = catalog.atolls.find((item) => item.id === site.atollId);
  // The offshore waves do not depend on the current, so they load alongside it rather than after it.
  const [loaded, offshore] = await Promise.all([
    loadSite(site, catalog.sites, atoll, reportsForSite(site.id)),
    loadOffshore(atoll).catch(() => undefined),
  ]);
  const sea = seaStateFor(site, catalog.sites, atoll, loaded, offshore);
  return {
    seaState: sea.hours,
    seaStale: sea.stale,
    hours: loaded.hours,
    unavailable: loaded.unavailable,
    stale: loaded.stale,
    notice: FORECAST_NOTICE,
    inwardBearingDeg: loaded.bearing,
    bearingSource: loaded.bearingSource,
    siteType: loaded.siteType,
    forecastRoute: loaded.forecastRoute,
    alongHeadingDeg: loaded.alongHeadingDeg,
    siteNote: siteNoteFor(loaded.siteType, loaded.forecastRoute),
    fetchedAt: loaded.fetchedAt,
  };
}

/**
 * The site's newest reports, as the site page lists them. On any route but "channel" the site's forecast reads as a
 * compass direction, so older in/out reports there are marked.
 */
export async function getRecentReports(siteId: string, route: ForecastRoute): Promise<RecentReportRow[]> {
  await ready();
  requireSiteId(siteId);
  return recentReportRows(reportsForSite(siteId), {
    nowWall: toMaldivesWall(new Date().toISOString()),
    route,
    nicknames: new Map(readStore().users.map((user) => [user.id, user.nickname])),
  });
}

function unavailableForecast(): SiteForecast {
  return {
    hours: [],
    unavailable: true,
    stale: false,
    notice: FORECAST_NOTICE,
    inwardBearingDeg: null,
    bearingSource: null,
    siteType: null,
    forecastRoute: "channel",
    alongHeadingDeg: null,
    siteNote: null,
    fetchedAt: null,
    seaState: null,
    seaStale: false,
  };
}

/**
 * The site's sea state for its forecast hours: null hours when the site has no atoll outline or no forecast, empty
 * when the waves failed to load. Never fails the forecast.
 */
function seaStateFor(
  site: Site,
  mates: readonly Site[],
  atoll: Atoll | undefined,
  loaded: SiteLoad,
  offshore: Offshore | null | undefined,
): { hours: SeaStateHour[] | null; stale: boolean } {
  if (loaded.unavailable || offshore === null) return { hours: null, stale: false };
  if (offshore === undefined) return { hours: [], stale: false };
  try {
    const sea = siteSeaState(site, mates, atoll, offshore, {
      hours: loaded.hours,
      forecastRoute: loaded.forecastRoute,
      inwardBearingDeg: loaded.bearing,
    });
    return { hours: sea.hours, stale: sea.stale };
  } catch {
    return { hours: [], stale: false };
  }
}

function newUserSite(name: string, lat: number, lon: number, atollId: string): Site {
  return {
    id: uniqueSiteId(name),
    name,
    atollId,
    lat,
    lon,
    sourceUrl: "user",
  };
}

function requireSiteInput(input: unknown): SiteDetailsInput & { name: unknown; lat: unknown; lon: unknown; rating?: unknown } {
  if (input === null || typeof input !== "object") throw new Error("Site is required");
  return input as SiteDetailsInput & { name: unknown; lat: unknown; lon: unknown; rating?: unknown };
}

function requireReportInput(input: unknown): {
  siteId: unknown;
  time: unknown;
  direction: unknown;
  strength: unknown;
} {
  if (input === null || typeof input !== "object") throw new Error("Report is required");
  return input as { siteId: unknown; time: unknown; direction: unknown; strength: unknown };
}

function requireSiteName(name: unknown): string {
  if (typeof name !== "string") throw new Error("Site name is required");
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Site name is required");
  if (trimmed.length > 80) throw new Error("Site name must be 1 to 80 characters");
  return trimmed;
}

function requireLatitude(lat: unknown): number {
  if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -2 || lat > 9) {
    throw new Error("Latitude is outside Maldives bounds [-2, 9]");
  }
  return lat;
}

function requireLongitude(lon: unknown): number {
  if (typeof lon !== "number" || !Number.isFinite(lon) || lon < 71 || lon > 76) {
    throw new Error("Longitude is outside Maldives bounds [71, 76]");
  }
  return lon;
}

/** A dive more than an hour ahead of the site's clock is almost always a time entered in the diver's own zone. */
const AHEAD_LIMIT_MS = 60 * 60 * 1000;
/** An identical report filed again within this window is a double submission, not a second diver. */
const DUPLICATE_WINDOW_MS = 30 * 60 * 1000;

/** How long after a dive it can still be reported. Older ones would only train the forecast on a memory. */
const REPORT_MAX_AGE_DAYS = 14;

/**
 * The dive time as a wall time ("YYYY-MM-DDTHH:MM"), in its one normal spelling: "2026-11-07T47:00" or month 13 would
 * roll over to a real time but be kept as typed, with a day of its own.
 */
function requireReportTime(input: unknown): string {
  if (typeof input !== "string") throw new Error("Bad time");
  const time = toMaldivesWall(input);
  const ms = parseWall(time);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 16) !== time) throw new Error("Bad time");
  return time;
}

function requireNotTooOld(time: string, zone: SiteTimeZone, nowMs: number): void {
  const siteNowMs = parseWall(currentWallTime(zone, nowMs));
  if (siteNowMs - parseWall(time) > REPORT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) {
    throw new Error(`Report dives from the last ${REPORT_MAX_AGE_DAYS} days.`);
  }
}

function requireNotAhead(time: string, zone: SiteTimeZone, nowMs: number): void {
  const siteNowMs = parseWall(currentWallTime(zone, nowMs));
  if (parseWall(time) - siteNowMs > AHEAD_LIMIT_MS) {
    throw new Error(`That time is still ahead in the ${zone.place}. Enter the dive in ${zoneLabel(zone)}.`);
  }
}

function requireNotDuplicate(siteId: string, time: string, direction: Direction, strength: Strength, nowMs: number): void {
  const repeat = reportsForSite(siteId).some((report) => {
    if (report.time !== time || report.direction !== direction || report.strength !== strength) return false;
    const filed = report.filedAt ? Date.parse(report.filedAt) : Number.NaN;
    return Number.isFinite(filed) && nowMs - filed < DUPLICATE_WINDOW_MS;
  });
  if (repeat) throw new Error("This report is already saved.");
}

function requireSiteId(siteId: unknown): asserts siteId is string {
  if (typeof siteId !== "string" || !siteId.trim()) throw new Error("Site id is required");
}

function requireRatingScore(score: number): void {
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw new Error("Rating must be an integer from 1 to 5");
  }
}

function requireDirection(direction: Direction): void {
  if (direction !== "incoming" && direction !== "outgoing") throw new Error("Bad direction");
}

function requireStrength(strength: Strength): void {
  if (!STRENGTHS.includes(strength)) throw new Error("Bad strength");
}

function uniqueSiteId(name: string): string {
  const suffix = crypto.randomUUID().slice(0, 8);
  return `${slugFromName(name)}-${suffix}`;
}

function slugFromName(name: string): string {
  const letters = name.toLowerCase().normalize("NFKD");
  const dashed = letters.replace(/[^a-z0-9]+/g, "-");
  const trimmed = dashed.replace(/^-|-$/g, "");
  return trimmed || "site";
}

export type { ShelterAtoll, ShelterView } from "./shelter-grid";

const WALL_HOUR = /^\d{4}-\d{2}-\d{2}T\d{2}:00$/;

/** The sheltered-water layer's felt height for the view, at `time` (a Maldives wall hour) or now. */
export async function getShelter(
  view: { south: number; west: number; north: number; east: number },
  time?: string,
): Promise<ShelterView> {
  await readyWith("shelter-grid.json");
  const { south, west, north, east } = view ?? {};
  if (![south, west, north, east].every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new Error("Bad view");
  }
  if (time !== undefined && !WALL_HOUR.test(time)) throw new Error("Bad time");
  return shelterView({ south, west, north, east }, time);
}

/** An atoll's outline and the islands in and round it, for the map to cut the shading to water. */
export async function getShelterShapes(wayId: string): Promise<{ outline: RimRing; islands: RimRing[] } | null> {
  await ready();
  if (typeof wayId !== "string" || !/^\d+$/.test(wayId)) throw new Error("Bad outline");
  return shelterShapes(wayId);
}

/** The sea state at one tapped spot of the layer. */
export async function getShelterPoint(lat: number, lon: number, time: string): Promise<SeaStateHour | "unknown" | null> {
  await readyWith("shelter-grid.json");
  if (![lat, lon].every((value) => typeof value === "number" && Number.isFinite(value))) throw new Error("Bad point");
  if (typeof time !== "string" || !WALL_HOUR.test(time)) throw new Error("Bad time");
  return shelterPoint(lat, lon, time);
}

export type { BoatTrip } from "./boat-route-data";

/**
 * Where a boat route can start or end: the Maldives with a margin round the outer atolls. A route from far away would
 * search a huge grid and ask Open-Meteo for the current at up to 200 new ocean points.
 */
const ROUTE_BOX = { south: -3, north: 10, west: 70, east: 77 };

function inRouteBox(point: { lat: number; lon: number }): boolean {
  return point.lat >= ROUTE_BOX.south && point.lat <= ROUTE_BOX.north && point.lon >= ROUTE_BOX.west && point.lon <= ROUTE_BOX.east;
}

/**
 * A boat route from a GPS position to a site or a point picked on the map ("lat,lon"), round the islands and reef the
 * app knows of. Null for an unknown site.
 */
export async function getBoatRoute(from: { lat: number; lon: number }, destinationId: string): Promise<BoatTrip | null> {
  await ready();
  const { lat, lon } = from ?? {};
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("Bad position");
  }
  if (!inRouteBox({ lat, lon })) throw new Error("Routes start in the Maldives");
  if (typeof destinationId !== "string" || destinationId.length === 0) throw new Error("Bad destination");
  const point = readPointDestination(destinationId);
  if (point && !inRouteBox(point)) throw new Error("Bad destination");
  return boatRoute({ lat, lon }, destinationId);
}
