import { cache } from "react";
import { preloadDataFiles } from "./data-files";
import { refreshStore } from "./store";

/**
 * Every server action starts here. On Cloudflare the data files come from static assets and the store from R2; both
 * must be in memory before the synchronous readers run. Once per request (React cache), so a page's several actions
 * read R2 once. Nothing to do on Node.
 */
export const ready = cache(async (): Promise<void> => {
  await Promise.all([preloadDataFiles(), refreshStore()]);
});
