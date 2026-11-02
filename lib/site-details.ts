import type { Site, SiteType } from "./types";

/**
 * What a diver adding a site can say about it: what kind of site it is, how deep it is dived, and how to dive it.
 * Display only: the forecast never reads any of it (`diverSiteType` is not `siteType`, and the dive depths were never
 * a speed input).
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
  { type: "pass", label: "Channel (kandu)", hint: "A gap through the atoll rim" },
  { type: "channel-thila", label: "Thila in a channel", hint: "A pinnacle in or at the mouth of a channel" },
  { type: "corner", label: "Channel corner", hint: "The reef corner where a channel meets the ocean" },
  { type: "outer-reef", label: "Outer reef wall", hint: "The ocean side of the rim, away from a channel" },
  { type: "lagoon", label: "Inside the lagoon", hint: "A thila, giri or reef inside the atoll" },
];

export const DIVER_SITE_TYPE_LABEL: Record<SiteType, string> = {
  pass: "Channel (kandu)",
  "channel-thila": "Thila in a channel",
  corner: "Channel corner",
  "outer-reef": "Outer reef wall",
  lagoon: "Inside the lagoon",
  "strait-wall": "Strait wall",
};

/** Deeper than any recreational or technical site in the catalog; a typo, not a dive. */
export const MAX_DIVE_DEPTH_M = 100;
export const HOW_TO_DIVE_MAX = 1500;

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
