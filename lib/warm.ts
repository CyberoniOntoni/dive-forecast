import { appSetting } from "./cloudflare";
import { toMaldivesWall } from "./forecast";
import { buildMapNowcasts } from "./nowcast-cache";
import { ready } from "./ready";
import { loadOffshore } from "./sea-state";
import { listMergedSites, readCatalog } from "./store";
import { WARM_HEADER } from "./warm-path";

/**
 * Series at least this old are refreshed by the warm-up. The cron runs hourly, so a series just under this at one run
 * is at most 5.5 hours old at the next: still inside the 6-hour TTL (lib/marine.ts), so a visitor finds R2 fresh and
 * never starts the refresh.
 */
export const WARM_REFRESH_MS = 4.5 * 60 * 60 * 1000;
/** A run from this minute of the hour builds the next hour's map (the cron runs at :50); earlier, this hour's. */
const NEXT_HOUR_FROM_MINUTE = 40;

export type WarmResult = { hour: string; sites: number; atolls: number; ms: number };

/**
 * Keeps the caches ahead of the visitors, once an hour. Every site's series (the site's own, the ring points and
 * lagoon openings its model reads) and every atoll's offshore waves and wind are refreshed when WARM_REFRESH_MS old,
 * by the same loads the pages run, while the map's nowcasts are built and saved for the coming hour (this hour's
 * when run before minute 40). One map build per run. Pages still refresh by themselves if a run is missed. Errors in
 * one atoll's waves do not stop the rest.
 */
export async function warmCaches(now = Date.now()): Promise<WarmResult> {
  const started = Date.now();
  await ready();
  const sites = listMergedSites();
  const atolls = readCatalog().atolls;
  const options = { refreshOlderThanMs: WARM_REFRESH_MS };
  const wall = toMaldivesWall(new Date(now).toISOString());
  const target =
    Number(wall.slice(14, 16)) >= NEXT_HOUR_FROM_MINUTE
      ? toMaldivesWall(new Date(Math.floor(now / 3_600_000 + 1) * 3_600_000).toISOString())
      : wall;
  await Promise.all([
    buildMapNowcasts(sites, atolls, target, options),
    Promise.all(atolls.map((atoll) => loadOffshore(atoll, options).catch(() => null))),
  ]);
  return { hour: target.slice(0, 13), sites: sites.length, atolls: atolls.length, ms: Date.now() - started };
}

/** Whether a request carries the warm-up's token. False when AUTH_SECRET is not set. */
export function isWarmRequest(request: Request): boolean {
  const secret = appSetting("AUTH_SECRET");
  const token = request.headers.get(WARM_HEADER);
  if (!secret || !token || token.length !== secret.length) return false;
  let differ = 0;
  for (let at = 0; at < secret.length; at += 1) differ |= secret.charCodeAt(at) ^ token.charCodeAt(at);
  return differ === 0;
}
