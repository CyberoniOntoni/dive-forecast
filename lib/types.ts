export const STRENGTHS = ["slack", "mild", "strong", "too_strong"] as const;

export type Strength = (typeof STRENGTHS)[number];
export type Direction = "incoming" | "outgoing";
export type Confidence = "low" | "medium" | "high";

export type { OceanDrift } from "./seasonal";

/**
 * Where a site sits, which decides how its current behaves.
 * - pass: in a channel through the atoll rim (a kandu), where the tide runs hardest.
 * - channel-thila: a pinnacle in or at the mouth of a pass.
 * - outer-reef: on the rim but on the reef itself, not in a gap.
 * - lagoon: inside the atoll, away from the rim. Current is weaker and less tied to the tide.
 * Wrecks and giris take the type of where they lie.
 */
export const SITE_TYPES = ["pass", "channel-thila", "corner", "outer-reef", "lagoon", "strait-wall"] as const;
export type SiteType = (typeof SITE_TYPES)[number];

/** atollId of a pin that is not in or near a seeded atoll. It has no forecast and draws no arrow. */
export const UNSEEDED_ATOLL_ID = "unseeded";

export type Atoll = {
  id: string;
  name: string;
  oceanLat: number;
  oceanLon: number;
  /** Published OSM outline the ocean sample was offset from. */
  rimSourceUrl: string;
  /** Published lagoon mean depth, metres. Catalog data; not read by constriction, head, or the lagoon flow. */
  lagoonMeanDepthM?: number;
  /** Source for the published lagoon mean depth. */
  lagoonDepthSourceUrl?: string;
};

/**
 * What a published depth is: a mean, a typical floor, a maximum, a least depth over a sill, the deep end of a range,
 * or a single sounding. Only a mean or a typical floor is the channel's hydraulic depth (HYDRAULIC_DEPTH_KINDS).
 */
export type DepthKind = "mean" | "typical" | "max" | "least" | "range" | "sounding";

/**
 * Why a channel record is not this site's section.
 * "position": the source names a channel the site was matched to by location, not by name.
 * "depth-only": the record has no width. "conflict": it disagrees with the site's stored section.
 */
export type ChannelLeadBasis = "position" | "depth-only" | "conflict";

/** A site's pointer at a Catalog.channels record. The constriction factor never reads it. */
export type ChannelLead = { channel: string; basis: ChannelLeadBasis };

export type Site = {
  id: string;
  name: string;
  atollId: string;
  lat: number;
  lon: number;
  /**
   * The page the position came from. "user": a pin added in the app. "": a catalog site from the owner's own
   * unpublished knowledge, with no page to link (the API sends null).
   */
  sourceUrl: string;
  /** On a pin added in the app ("user" source): the diver who added it (User.id). */
  addedBy?: string;
  /** Dive top, metres: published, or set by the diver who added the pin (no depthSourceUrl). Display only; never a speed input. */
  diveTopM?: number;
  /** Dive maximum, metres: published, or set by the diver who added the pin. Display only; never a speed input. */
  diveMaxM?: number;
  /** Source for the published dive top and maximum. */
  depthSourceUrl?: string;
  /** Published channel width, metres. Used for hydrodynamic pass constriction modeling. */
  channelWidthM?: number;
  /** Published channel depth, metres. Used for hydrodynamic pass constriction modeling. */
  channelDepthM?: number;
  /** What channelDepthM is. Only a hydraulic kind enters the constriction factor (sectionInput). */
  channelDepthKind?: DepthKind;
  /** Source for the published channel width and depth. */
  channelSourceUrl?: string;
  /**
   * Channel width measured on the Allen Coral Atlas geomorphic map (`npm run channel-widths`), metres.
   * Not a published section: the constriction factor never reads it.
   */
  atlasWidthM?: number;
  /** "checked": the gap was confirmed on the Atlas satellite mosaic. "low": it crosses the channel at a slant or a broken reef edge. */
  atlasWidthConfidence?: "checked" | "low";
  /**
   * Channel crossing on the Rasheed et al. (2021) Maldives bathymetry grid (`npm run channel-depths`):
   * gap width, mean and deepest depth across it, metres. Not a published section: the constriction factor never reads them.
   */
  gridWidthM?: number;
  gridDepthMeanM?: number;
  gridDepthMaxM?: number;
  /**
   * "low": the floor sits at the grid's satellite depth limit (deepest point under 20 m, or divers go 5 m or more
   * deeper), or the crossing found the wrong gap.
   */
  gridDepthConfidence?: "ok" | "low";
  /** Channel records that bear on this site but are not its section. Catalog data: the factor never reads them. */
  channelLeads?: ChannelLead[];
  /**
   * Measured inward channel axis, degrees clockwise from north: the heading of water entering the lagoon.
   * When set it replaces the mate-centroid / outside-point heuristic.
   */
  inwardBearingDeg?: number;
  /**
   * Where the water runs when outgoing, if not straight back along inwardBearingDeg: a curved channel (HP Reef runs
   * in toward 10 o'clock and out toward 5). Only the outgoing arrow uses it; the model keeps the inward axis.
   */
  outgoingBearingDeg?: number;
  /** Where the site sits: pass, channel thila, outer reef or lagoon. Absent until classified. */
  siteType?: SiteType;
  /**
   * Set by someone who knows the site on an outer-reef wall: its current runs along the reef even within
   * CHANNEL_FUNNEL_KM of a pass (Dhandhoo Caves, outside the island ridge next to Dhandhoo Channel).
   */
  alongReef?: true;
  /**
   * At a lagoon site, set by someone who knows it: the compass line its current runs along, degrees in [0, 180)
   * ("incoming" runs toward it). Replaces the main axis of the modelled lagoon flow (Mahadhoo, along the island's
   * inner reef).
   */
  flowAxisDeg?: number;
  /**
   * Another catalog site whose forecast this one shows: a pin inside that site's channel that the coarse outline puts
   * in the lagoon (Coral Garden on Kondey Channel's wall). Reports at either pin teach both (forecastReportsForFlow).
   */
  flowFromSiteId?: string;
  /**
   * "manual" when someone who knows the site set it; a derived type never overwrites it. "diver": an app-added pin
   * whose adder picked its kind (diverSiteType); "derived" there means the pin's position decided (lib/store.ts).
   */
  siteTypeSource?: "derived" | "manual" | "diver";
  /**
   * "imagery": sourceUrl names the site but gives no usable coordinate, so the pin was put on the named channel or reef
   * from satellite imagery (pinNote says where). The site page says the position is approximate. Absent: the
   * coordinate came from sourceUrl.
   */
  pinPlacement?: "imagery";
  /** Where an imagery-placed pin was put, and any other spot it could be. */
  pinNote?: string;
  /**
   * On a pin added in the app: the kind of site the diver who added it said it is. It becomes the pin's siteType when
   * the store is read (lib/store.ts), so it picks the forecast model; catalog sites never read it.
   */
  diverSiteType?: SiteType;
  /**
   * What the site is: the reef, the life, what it is known for. Plain text. Only written by divers through edits a
   * moderator approved (lib/site-wiki.ts); listMergedSites lays the approved text over the record.
   */
  description?: string;
  /**
   * How to dive it (entry, route, hazards), plain text: the adder's notes on a pin added in the app, the catalog's own
   * on a few sites, and over either the latest approved diver edit (lib/site-wiki.ts).
   */
  howToDive?: string;
  /** Photos of the site, oldest first (lib/site-photos.ts). */
  photos?: SitePhoto[];
  /** On a pin added in the app: when it was added, ISO UTC (for the daily limit per diver). */
  addedAt?: string;
  /** On a pin added in the app: hidden by the owner (spam, a duplicate). Left out of every list; see CLOUDFLARE.md. */
  hidden?: boolean;
};

/** A photo of a dive site. The JPEG itself is in R2 (or data/photos on Node) under the site and photo ids. */
export type SitePhoto = { id: string; addedBy: string; addedAt: string };

/** Where a resolved bearing came from. */
export type BearingSource = "override" | "rim-derived" | "fallback";

/** An atoll's ring level at one hour: the mean residual sea level round its outline, standing for the lagoon. */
export type RingLevel = { time: string; levelM: number };

export type ForecastInput = {
  hours: MarineHour[];
  inwardBearingDeg: number;
  /**
   * The atoll's ring level. With it, the head between the ocean outside the channel and the lagoon behind it drives
   * the channel too (ATOLL_HEAD_TAU_HOURS). Absent: no head term.
   */
  ringLevel?: readonly RingLevel[];
  /** Overrides ATOLL_HEAD_TAU_HOURS. For calibration. */
  headTauHours?: number;
  reports?: readonly Report[];
  allowHighConfidence?: boolean;
  channelWidthM?: number;
  channelDepthM?: number;
};

export type Report = {
  id: string;
  siteId: string;
  /** Maldives wall time, YYYY-MM-DDTHH:MM, when the diver was in the water. */
  time: string;
  direction: Direction;
  strength: Strength;
  /** Residual hourly sea-level change at time. Null if that hour had no slope. */
  slopeM?: number | null;
  /**
   * Residual slopes from 6 hours before the report through 6 hours after.
   * Index 6 is the report hour. Null is a missing hour. Absent when the fetch failed.
   */
  slopeWindowM?: (number | null)[] | null;
  /**
   * Residual sea-level range over the 25 hours around the report hour, metres: the day's tide envelope.
   * With the slope window it grades what the model would have said once the hour has left the series.
   * Absent on older reports and when the fetch failed.
   */
  rangeM?: number | null;
  /**
   * Through-flow at the report hour, residual metres per hour: the monsoon drift along the channel's inward axis
   * times THROUGHFLOW_SLOPE_PER_MS. Added to the stored tide slopes. Absent on older reports.
   */
  throughflowM?: number | null;
  /**
   * Head drive across the atoll from 6 hours before the report through 6 after, residual metres per hour: the level
   * outside the channel less the atoll's ring level, over ATOLL_HEAD_TAU_HOURS. Aligned with slopeWindowM and added
   * to it. Absent on older reports, at sites without a ring level, and when the fetch failed.
   */
  headWindowM?: number[] | null;
  /**
   * At a wall whose current runs along the reef: the compass heading "incoming" meant when the report was filed
   * (inward bearing + 90°). Saved so the report keeps its meaning if the site's bearing changes. Absent elsewhere.
   */
  alongHeadingDeg?: number;
  /** What the forecast said for this hour when the report was filed. Absent when there was no forecast. */
  predicted?: ForecastAtReport;
  /** When the report was filed, ISO UTC. Absent on reports filed before it was recorded (1 Oct 2026). */
  filedAt?: string;
  /** The signed-in diver who filed it (User.id). Absent on reports filed before sign-in existed (Oct 2026). */
  userId?: string;
  /**
   * Hidden by a moderator as malicious or made up, ISO UTC (lib/moderation.ts). Kept, so it can be shown again, but it
   * teaches no forecast and counts in no verify, points or listing (countedReports, visibleReportsForSite).
   */
  hiddenAt?: string;
};

/**
 * The prediction paired with a report, saved when the report is filed so it can be scored later without
 * recomputing it with a newer model. Lead time is the report hour minus `issuedAt`; a negative lead means the
 * ocean data was fetched after the dive, so the "forecast" was really an analysis of a past hour.
 */
export type ForecastAtReport = {
  /** FORECAST_MODEL_VERSION when the report was filed. */
  modelVersion: string;
  /** NUDGE_SOURCE when the report was filed. */
  nudge: "drift" | "off";
  /** Unix ms when the ocean data behind the forecast was fetched. Null if unknown. */
  issuedAt: number | null;
  /** True when that data was the last cached series, not a fresh fetch. */
  stale: boolean;
  bearingDeg: number;
  bearingSource: BearingSource | null;
  /** What the site page showed for the report hour: earlier reports for the site pull on it. */
  shown: { direction: Direction; strength: Strength; confidence: Confidence };
  /** The model alone, with no reports pulling. Null if it produced no hour. */
  modelOnly: { direction: Direction; strength: Strength } | null;
  /**
   * True when the report was filed after the week's series had moved past the dive, so this was worked out then from
   * the long past window (REPORT_PAST_DAYS in lib/marine.ts): what the model makes of that hour, not what a page
   * showed before the dive. Absent otherwise.
   */
  hindcast?: true;
};

/** One diver's rating of a site. Ratings from before sign-in have no userId: one anonymous rating per site. */
export type Rating = {
  siteId: string;
  /** Dive-site quality. Never an input to the current forecast. */
  score: number;
  updatedAt: string;
  userId?: string;
  /**
   * When this diver first rated the site, ISO UTC; kept when the score changes, the rating is removed or it is given
   * again, so points are counted on that day (lib/points.ts) and undo and re-rate earn nothing new. Absent on ratings
   * saved before it was kept: updatedAt stands in.
   */
  firstRatedAt?: string;
  /**
   * Removed by the diver, ISO UTC. The row is kept only to remember firstRatedAt: a removed rating has no score in the
   * average, no review, no photos and no points.
   */
  removedAt?: string;
  /** The diver's written review, plain text (lib/site-details.ts REVIEW_MAX). */
  review?: string;
  /** The diver's photos of the site, oldest first; the JPEGs are kept like any site photo (lib/site-photos.ts). */
  photos?: SitePhoto[];
};

/** A signed-in diver. The email is private: only the nickname is ever shown. */
export type User = {
  id: string;
  /** Lower-cased. */
  email: string;
  /** Shown on reports and the scoreboard. Unique, ignoring case. */
  nickname: string;
  createdAt: string;
  /** "About me", plain text, shown on the diver's public page. */
  about?: string;
  /** "Sign out everywhere": session cookies issued before this (ms since 1970) no longer count (lib/auth.ts). */
  sessionsValidFrom?: number;
  /**
   * When the diver added each photo to a review in the last 24 hours, ISO UTC, for the daily photo limit. Kept apart
   * from the photos, so deleting a photo or a rating does not give the upload back.
   */
  reviewPhotoUploads?: string[];
  /**
   * When the diver proposed each new site edit in the last 24 hours, ISO UTC, for the daily limit (lib/site-wiki.ts).
   * Kept apart from the edits, so withdrawing one does not give the slot back.
   */
  siteEditProposals?: string[];
  /** When the diver agreed to the content rules (/terms), ISO UTC. Needed before they post anything others see. */
  acceptedTermsAt?: string;
  /** Divers this one blocked (User.id): their reviews, photos and pages are hidden from this diver. */
  blocked?: string[];
  /** Banned by a moderator, ISO UTC: cannot sign in, and what they posted is removed (lib/moderation.ts). */
  bannedAt?: string;
  /**
   * The store-review account (lib/review-account.ts): set when it signs in with the review code, and kept, so its
   * reports stay out of the forecast, verify and the scoreboard even after REVIEW_EMAIL changes or is turned off.
   */
  storeReview?: true;
};

export const FLAG_REASONS = ["sexual", "violence", "hate", "spam", "privacy", "illegal", "other"] as const;
export type FlagReason = (typeof FLAG_REASONS)[number];
export const FLAG_KINDS = ["review", "site", "diver", "text"] as const;
export type FlagKind = (typeof FLAG_KINDS)[number];

/**
 * A diver's report of something objectionable (Google Play's user-generated content rules): a review with its
 * photos, a site added in the app with its notes and photos, or a diver's nickname and About me. Moderators act on it
 * at /moderation.
 */
export type ContentFlag = {
  id: string;
  /** Who reported it (User.id). */
  reporterId: string;
  kind: FlagKind;
  /** The review's or the site's site. */
  siteId?: string;
  /** Whose content it is (User.id): the review's author, the site's adder, the diver. */
  userId?: string;
  reason: FlagReason;
  /** The reporter's words, plain text. */
  note?: string;
  createdAt: string;
  /** When a moderator closed it, ISO UTC, and what they did. */
  resolvedAt?: string;
  resolution?: "removed" | "banned" | "dismissed";
};

/** The site texts divers can edit, wiki style (lib/site-wiki.ts). */
export const WIKI_FIELDS = ["description", "howToDive"] as const;
export type WikiField = (typeof WIKI_FIELDS)[number];
export type WikiTexts = Partial<Record<WikiField, string>>;

/**
 * A diver's proposed change to a site's description or how to dive it. A moderator approves or rejects it at
 * /moderation; an approved edit is a revision of the site's text, and its diver is credited on the site page.
 */
export type SiteEdit = {
  id: string;
  siteId: string;
  /** Who proposed it (User.id; a deleted account's `deleted-…` id on an approved edit kept for the history). */
  userId: string;
  /** When it was proposed, or last changed while it waited (the queue lists it from then), ISO UTC. */
  createdAt: string;
  status: "pending" | "approved" | "rejected";
  /** The new full text of each field it changes; "" clears the field. Fields it leaves alone are absent. */
  changes: WikiTexts;
  /** The text each changed field had when the diver wrote the edit ("" for none), to tell a moderator it went stale. */
  based: WikiTexts;
  /** The diver's word on what changed and how they know, plain text. */
  note?: string;
  /** When a moderator approved or rejected it, ISO UTC, and who (User.id). */
  reviewedAt?: string;
  reviewerId?: string;
  /** The moderator's reason, shown to the diver who proposed it. */
  rejectReason?: string;
  /** On an approved edit: the text each field had just before it went live ("" for none), for the history's diff. */
  replaced?: WikiTexts;
  /** An approved edit a moderator took back, ISO UTC: its fields fall back to the revision before. */
  revertedAt?: string;
};

/** A sign-in code sent by email and not yet used. Only a hash of the code is kept. */
export type PendingLogin = {
  email: string;
  codeHash: string;
  /** ISO UTC. */
  sentAt: string;
  /** ISO UTC. */
  expiresAt: string;
  /** Wrong codes tried so far. */
  attempts: number;
  /** Who asked: an HMAC of the request's IP address, never the address itself, for the per-IP send limit. */
  ipKey?: string;
};

export type MarineHour = {
  time: string;
  seaLevelM: number | null;
  /** Metres per second. Converted from the API unit when that unit is not m/s. */
  currentVelocityMs: number | null;
  /** Degrees the water is heading toward. 0 is north, 90 is east. */
  currentDirectionDeg: number | null;
};

/**
 * Which model a site's hours came from, and so how their direction reads: "channel" as incoming or outgoing across
 * the rim; "along-reef" and "strait" as a compass direction along a wall; "lagoon" as a compass direction inside it.
 */
export type ForecastRoute = "channel" | "along-reef" | "strait" | "lagoon";

export type HourForecast = {
  time: string;
  direction: Direction;
  strength: Strength;
  confidence: Confidence;
  /** Residual sea level at this hour, metres, after the 25-hour mean. */
  levelM: number;
};

export const SEA_BANDS = ["calm", "moderate", "choppy", "rough"] as const;
/** How rough the surface is at a site (lib/sea-state.ts). */
export type SeaBand = (typeof SEA_BANDS)[number];

/**
 * Upper limits of each band on the felt height, metres. First guesses from the plan, to tune from reports.
 * Rough is everything from 1.5 m up.
 */
export const SEA_BAND_LIMITS_M: Record<Exclude<SeaBand, "rough">, number> = { calm: 0.5, moderate: 1.0, choppy: 1.5 };

/** A wave component as it arrives at the site: height in metres, the direction it comes from, period in seconds. */
export type SiteWave = { heightM: number; fromDeg: number; periodS: number | null };

export type SeaStateHour = {
  time: string;
  band: SeaBand;
  /** Felt height, metres: swell and wind waves combined, wind waves weighted up. */
  feltM: number;
  /** The bigger swell reaching the site, or null when none does. */
  swell: SiteWave | null;
  /** Wind chop at the site: the wave model's wind sea through the reef, or what the local wind raises, if bigger. */
  windWaveM: number;
  /** The 10 m wind over the atoll that hour. */
  wind: { speedMs: number; fromDeg: number } | null;
  /** A channel hour where swell runs into a strong outgoing current. */
  againstCurrent: boolean;
};

export type SiteForecast = {
  hours: HourForecast[];
  unavailable: boolean;
  /** True when these hours are the last cached series, not a fresh fetch. */
  stale: boolean;
  notice: string;
  /** Bearing used for the monsoon nudge and the site arrow. */
  inwardBearingDeg: number | null;
  /** Where that bearing came from. Null when there is no bearing. */
  bearingSource: BearingSource | null;
  /** The curved outgoing heading of the channel this forecast is for (the followed site's at a follower); null when straight. */
  outgoingBearingDeg?: number | null;
  /** Where the site sits, when classified. */
  siteType: SiteType | null;
  /** Which model made these hours, and so how their direction reads. */
  forecastRoute: ForecastRoute;
  /** Set on every route but "channel": the compass heading its "incoming" means. Null for a channel. */
  alongHeadingDeg: number | null;
  /** A note about how far to trust the forecast at this kind of site. Null when there is none. */
  siteNote: string | null;
  /** Unix ms when the marine series was cached. Null when no cache exists. */
  fetchedAt: number | null;
  /** Sea state for the forecast hours. Empty when it is unavailable; null when the site has none (no atoll outline). */
  seaState: SeaStateHour[] | null;
  /** True when the sea state comes from an old cached wave series. */
  seaStale: boolean;
};

/** One source's statement about one named channel. Several records can describe the same channel. */
export type ChannelRecord = {
  id: string;
  /** The channel as the source names it. */
  name: string;
  widthM?: number;
  depthM?: number;
  /** Set whenever depthM is. */
  depthKind?: DepthKind;
  sourceUrl: string;
  /** The work the source itself cites, when it is a secondary source. */
  citedSource?: string;
};

export type InnerSeaBathymetry = {
  minDepthM: number;
  maxDepthM: number;
  sourceUrl?: string;
  citedSource?: string;
};

export type Catalog = {
  atolls: Atoll[];
  sites: Site[];
  channels?: ChannelRecord[];
  innerSea?: InnerSeaBathymetry;
};

/** One dive on a plan day: a site at a time, Maldives wall clock. */
export type PlanStop = {
  siteId: string;
  /** "HH:MM", the time the divers go in, on the day's date. */
  time: string;
  /** The guide's note for this dive (entry, what to look for), plain text. */
  note?: string;
  /** At a channel: the way the guide wants the current to run. The plan page warns when the forecast says otherwise. */
  want?: Direction;
};

export type PlanDay = {
  /** "YYYY-MM-DD", Maldives date. */
  date: string;
  /** In time order. */
  stops: PlanStop[];
};

/**
 * A dive plan a guide or a liveaboard puts together: dives by day, with the boat route between them. Anyone with its
 * link sees it (the id is long and random); only the diver who made it changes it.
 */
export type DivePlan = {
  /** Random, unguessable: the share link is /plans/<id>. */
  id: string;
  /** The signed-in diver who made it (User.id). */
  ownerId: string;
  title: string;
  /** Notes for everyone on the trip, plain text. */
  notes?: string;
  /** The boat's cruising speed through the water, knots, for the times between dives. */
  boatSpeedKn: number;
  /** In date order, each date once. */
  days: PlanDay[];
  createdAt: string;
  updatedAt: string;
};

export type StoreData = {
  reports: Report[];
  ratings: Rating[];
  sites: Site[];
  users: User[];
  logins: PendingLogin[];
  plans: DivePlan[];
  flags: ContentFlag[];
  siteEdits: SiteEdit[];
};