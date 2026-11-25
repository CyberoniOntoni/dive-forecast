import { HOW_TO_DIVE_MAX } from "./site-details";
import type { WikiField } from "./types";

/** The limits on divers' site edits (lib/site-wiki.ts), with no heavy imports, so the edit form can show them. */

export const DESCRIPTION_MAX = 2000;
export const WIKI_MAX: Record<WikiField, number> = { description: DESCRIPTION_MAX, howToDive: HOW_TO_DIVE_MAX };
export const WIKI_LABELS: Record<WikiField, string> = { description: "About the site", howToDive: "How to dive it" };
/** The diver's note to the moderators, and a moderator's reason for a rejection. */
export const EDIT_NOTE_MAX = 300;
/** Edits one diver can have waiting for review at once, over all sites. */
export const PENDING_EDITS_MAX = 10;
/** New edits one diver can propose in 24 hours (changing one still waiting is not a new one). */
export const EDITS_PER_DAY = 10;
