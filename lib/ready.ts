import { cache } from "react";
import { preloadDataFiles, type DataFile } from "./data-files";
import { refreshStore } from "./store";

/**
 * Every server action starts here. On Cloudflare the data files come from static assets and the store from R2; both
 * must be in memory before the synchronous readers run. Once per request (React cache), so a page's several actions
 * read R2 once. Nothing to do on Node. An action that reads an on-demand file calls readyWith instead.
 */
export const ready = cache(async (): Promise<void> => {
  await Promise.all([preloadDataFiles(), refreshStore()]);
});

/** ready, plus one on-demand data file (ON_DEMAND_DATA_FILES). The store is still read once per request. */
export async function readyWith(file: DataFile): Promise<void> {
  await Promise.all([ready(), preloadDataFiles([file])]);
}
