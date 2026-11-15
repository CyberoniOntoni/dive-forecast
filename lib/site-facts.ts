import { DIVER_SITE_TYPE_LABEL } from "./site-details";
import { SITE_TYPE_LABEL } from "./site-type";
import type { Site } from "./types";

/**
 * The kind of site and its dive depths, as the site page and the dive plan page word them. Server only: the site type
 * labels sit next to the rim code.
 */

/**
 * The site type the forecast runs on. App-added pins use the diver's words; with `source`, the label also says whether
 * the diver picked it or the pin's position did.
 */
export function siteKindLabel(site: Site, { source = false }: { source?: boolean } = {}): string | null {
  if (!site.siteType) return null;
  if (site.sourceUrl !== "user" && site.siteTypeSource !== "diver") return SITE_TYPE_LABEL[site.siteType];
  const label = DIVER_SITE_TYPE_LABEL[site.siteType];
  if (!source) return label;
  return site.siteTypeSource === "diver" ? `${label} (diver's pick)` : `${label} (from the pin's position)`;
}

/** A dive can start at the surface, so 0 m counts; anything else not a finite number ≥ 0 is no depth. */
export function nonNegativeMetres(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

export function formatMetres(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 10) / 10);
}

/** "5–30 m", or "18 m" when only one depth is known (or both are equal); null with none. */
export function diveDepthPhrase(top: number | null, max: number | null): string | null {
  if (top != null && max != null && top !== max) {
    return `${formatMetres(Math.min(top, max))}–${formatMetres(Math.max(top, max))} m`;
  }
  const only = top ?? max;
  return only == null ? null : `${formatMetres(only)} m`;
}
