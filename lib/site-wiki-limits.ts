import { HOW_TO_DIVE_MAX } from "./site-details";
import type { WikiField } from "./types";

/** The limits and words for divers' site edits (lib/site-wiki.ts), with no heavy imports, so the edit form can use them. */

export const DESCRIPTION_MAX = 2000;
export const WIKI_MAX: Record<WikiField, number> = { description: DESCRIPTION_MAX, howToDive: HOW_TO_DIVE_MAX };
export const WIKI_LABELS: Record<WikiField, string> = { description: "About the site", howToDive: "How to dive it" };
/** The diver's note to the moderators, and a moderator's reason for a rejection. */
export const EDIT_NOTE_MAX = 300;
/** Edits one diver can have waiting for review at once, over all sites. */
export const PENDING_EDITS_MAX = 10;
/** New edits one diver can propose in 24 hours (changing one still waiting is not a new one). */
export const EDITS_PER_DAY = 10;
/** A withdraw that came too late: a moderator looked at the edit (or it was withdrawn) in the meantime. */
export const EDIT_ALREADY_LOOKED_AT = "That edit was already looked at.";

/** What goes before the name at `index` of `count` in a credit: "", ", " or " and " ("Ann, Bob and Cy"). */
export function creditJoiner(index: number, count: number): string {
  if (index === 0) return "";
  return index === count - 1 ? " and " : ", ";
}

/** "Written by Ann, Bob and Cy.", or null with nobody to credit. The web card links each name; the API sends this line. */
export function writtenByLine(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  return `Written by ${names.map((name, index) => creditJoiner(index, names.length) + name).join("")}.`;
}
