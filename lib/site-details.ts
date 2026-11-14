import type { Site, SiteType } from "./types";

/**
 * What a diver adding a site can say about it: what kind of site it is, how deep it is dived, and how to dive it.
 * The kind picks the pin's forecast model (lib/store.ts withCurrentPlace); depths and notes are display only.
 */
export type SiteDetailsInput = {
  diverSiteType?: unknown;
  diveTopM?: unknown;
  diveMaxM?: unknown;
  howToDive?: unknown;
};

export type SiteDetails = Pick<Site, "diverSiteType" | "diveTopM" | "diveMaxM" | "howToDive">;

/** The kinds a diver picks from, in the words divers use, mapped to the site types the forecast knows. */
export const DIVER_SITE_TYPES: readonly { type: SiteType; label: string; hint: string }[] = [
  { type: "pass", label: "Channel (kandu)", hint: "A gap through the atoll rim, or a thila in one" },
  { type: "corner", label: "Channel corner", hint: "The reef corner where a channel meets the ocean" },
  { type: "lagoon", label: "Inside the lagoon", hint: "A thila, giri or reef inside the atoll" },
  { type: "outer-reef", label: "Wall outside the atoll", hint: "The ocean side of the rim, away from a channel" },
];

/** Every site type in divers' words: the form's own labels, plus the types only the catalog sets. */
export const DIVER_SITE_TYPE_LABEL = {
  ...Object.fromEntries(DIVER_SITE_TYPES.map((option) => [option.type, option.label])),
  "channel-thila": "Thila in a channel",
  "strait-wall": "Strait wall",
} as Record<SiteType, string>;

/** Deeper than any recreational or technical site in the catalog; a typo, not a dive. */
export const MAX_DIVE_DEPTH_M = 100;
export const HOW_TO_DIVE_MAX = 1500;
/** A written review of a site: what the dive was like, beside the 1 to 5 score. */
export const REVIEW_MAX = 1500;

/** A review's text, cleaned like the notes, or null when it is empty. */
export function requireReviewText(text: unknown): string | null {
  if (text == null) return null;
  if (typeof text !== "string") throw new Error("The review must be text.");
  const cleaned = cleanText(text);
  if (cleaned.length > REVIEW_MAX) throw new Error(`A review must be at most ${REVIEW_MAX} characters.`);
  return cleaned || null;
}

export function requireSiteDetails(input: SiteDetailsInput): SiteDetails {
  const details: SiteDetails = {};
  const type = input.diverSiteType;
  if (type != null && type !== "") {
    if (!DIVER_SITE_TYPES.some((option) => option.type === type)) throw new Error("Pick a site type from the list.");
    details.diverSiteType = type as SiteType;
  }
  const top = optionalDepth(input.diveTopM, "Shallowest depth");
  const max = optionalDepth(input.diveMaxM, "Deepest depth");
  if (top != null && max != null && top > max) throw new Error("The shallowest depth is deeper than the deepest.");
  if (top != null) details.diveTopM = top;
  if (max != null) details.diveMaxM = max;
  const text = input.howToDive;
  if (text != null) {
    if (typeof text !== "string") throw new Error("How to dive it must be text.");
    const cleaned = cleanText(text);
    if (cleaned.length > HOW_TO_DIVE_MAX) throw new Error(`How to dive it must be at most ${HOW_TO_DIVE_MAX} characters.`);
    if (cleaned) details.howToDive = cleaned;
  }
  return details;
}

function optionalDepth(value: unknown, label: string): number | null {
  if (value == null || value === "") return null;
  const metres = typeof value === "string" ? Number(value) : value;
  if (typeof metres !== "number" || !Number.isFinite(metres) || metres < 0 || metres > MAX_DIVE_DEPTH_M) {
    throw new Error(`${label} must be 0 to ${MAX_DIVE_DEPTH_M} m.`);
  }
  return Math.round(metres * 10) / 10;
}

/** Plain text: control characters dropped (newlines kept), runs of blank lines squeezed, ends trimmed. */
function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
