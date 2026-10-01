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
export const SITE_TYPES = ["pass", "channel-thila", "outer-reef", "lagoon"] as const;
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
};

export type Site = {
  id: string;
  name: string;
  atollId: string;
  lat: number;
  lon: number;
  sourceUrl: string;
  /** Published dive top, metres. Display only; never a speed input. */
  diveTopM?: number;
  /** Published dive maximum, metres. Display only; never a speed input. */
  diveMaxM?: number;
  /** Source for the published dive top and maximum. */
  depthSourceUrl?: string;
  /** Published channel width, metres. Used for hydrodynamic pass constriction modeling. */
  channelWidthM?: number;
  /** Published channel depth, metres. Used for hydrodynamic pass constriction modeling. */
  channelDepthM?: number;
  /** Source for the published channel width and depth. */
  channelSourceUrl?: string;
  /**
   * Measured inward channel axis, degrees clockwise from north: the heading of water entering the lagoon.
   * When set it replaces the mate-centroid / outside-point heuristic.
   */
  inwardBearingDeg?: number;
  /** Where the site sits: pass, channel thila, outer reef or lagoon. Absent until classified. */
  siteType?: SiteType;
  /** "manual" when someone who knows the site set it; a derived type never overwrites it. */
  siteTypeSource?: "derived" | "manual";
};

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
};

export type Rating = {
  siteId: string;
  /** Dive-site quality. Never an input to the current forecast. */
  score: number;
  updatedAt: string;
};

export type MarineHour = {
  time: string;
  seaLevelM: number | null;
  /** Metres per second. Converted from the API unit when that unit is not m/s. */
  currentVelocityMs: number | null;
  /** Degrees the water is heading toward. 0 is north, 90 is east. */
  currentDirectionDeg: number | null;
};

export type HourForecast = {
  time: string;
  direction: Direction;
  strength: Strength;
  confidence: Confidence;
  /** Residual sea level at this hour, metres, after the 25-hour mean. */
  levelM: number;
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
  /** Where the site sits, when classified. */
  siteType: SiteType | null;
  /** Set for a wall whose current runs along the reef: the compass heading its "incoming" means. Null otherwise. */
  alongHeadingDeg: number | null;
  /** A note about how far to trust the forecast at this kind of site. Null when there is none. */
  siteNote: string | null;
  /** Unix ms when the marine series was cached. Null when no cache exists. */
  fetchedAt: number | null;
};

export type ChannelMeasurement = {
  name: string;
  channelWidthM: number;
  channelDepthM: number;
  channelSourceUrl?: string;
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
  channels?: ChannelMeasurement[];
  innerSea?: InnerSeaBathymetry;
};

export type StoreData = {
  reports: Report[];
  ratings: Rating[];
  sites: Site[];
};