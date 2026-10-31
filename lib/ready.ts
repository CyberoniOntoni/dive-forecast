import { cache } from "react";
import { CORE_DATA_FILES, preloadDataFiles, type DataFile } from "./data-files";
import { refreshStore } from "./store";

/**
 * Every server action starts here. On Cloudflare the data files come from static assets and the store from R2; both
 * must be in memory before the synchronous readers run. Once per request (React cache), so a page's several actions
 * read R2 once. Nothing to do on Node. An action that reads an on-demand file (ON_DEMAND_DATA_FILES) names it.
 */
export const ready = cache(async (extra?: DataFile): Promise<void> => {
  await Promise.all([preloadDataFiles(extra ? [...CORE_DATA_FILES, extra] : CORE_DATA_FILES), refreshStore()]);
});
