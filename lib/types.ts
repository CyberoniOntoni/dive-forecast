export const STRENGTHS = ["slack", "mild", "strong", "too_strong"] as const;

export type Strength = (typeof STRENGTHS)[number];
export type Direction = "incoming" | "outgoing";
export type Confidence = "low" | "medium" | "high";

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
  /** Published channel width, metres. Display only; never changes the band. */
  channelWidthM?: number;
  /** Published channel depth, metres. Display only; never changes the band. */
  channelDepthM?: number;
  /** Source for the published channel width and depth. */
  channelSourceUrl?: string;
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
  notice: string;
  /** Bearing used for the monsoon nudge and the site arrow. */
  inwardBearingDeg: number | null;
  /** Unix ms when the marine series was cached. Null when the forecast is unavailable. */
  fetchedAt: number | null;
};

export type Catalog = {
  atolls: Atoll[];
  sites: Site[];
};

export type StoreData = {
  reports: Report[];
  ratings: Rating[];
  sites: Site[];
};