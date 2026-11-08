import { clearRingMemo } from "./atoll-ring";
import { appSetting } from "./cloudflare";
import { toMaldivesWall } from "./forecast";
import { buildMapNowcasts } from "./nowcast-cache";
import { clearLagoonMemo } from "./load-site";
import { ready } from "./ready";
import { rimForAtoll } from "./rim";
import { loadOffshore } from "./sea-state";
import { listMergedSites, readCatalog } from "./store";
import { sameText } from "./session-token";
import { WARM_HEADER } from "./warm-path";

/**
 * Series at least this old are refreshed by the warm-up. The cron runs hourly, so a series just under this at one run
 * is at most 5.5 hours old at the next: still inside the 6-hour TTL (lib/marine.ts), so a visitor finds R2 fresh and
 * never starts the refresh.
 */
export const WARM_REFRESH_MS = 4.5 * 60 * 60 * 1000;
/** A run from this minute of the hour builds the next hour's map (the cron runs at :50); earlier, this hour's. */
const NEXT_HOUR_FROM_MINUTE = 40;

export type WarmResult = {
  hour: string;
  /** False when R2 refused the map's list: scheduled() then fails the run, so Trigger events show it. */
  saved: boolean;
  sites: number;
  atolls: number;
  /** Atolls whose offshore waves or wind could not be loaded. */
  offshoreFailed: number;
  ms: number;
};

/**
 * Keeps the caches ahead of the visitors, once an hour. The map's nowcasts are built and saved for the coming hour
 * (this hour's when run before minute 40), and on the way every site's series (the site's own, the ring points and
 * lagoon openings its model reads) is refreshed when WARM_REFRESH_MS old, by the same loads the pages run. Then every
 * atoll's offshore waves and wind, after the map so a down wave host cannot hold the map up. The ring and lagoon
 * memos are cleared first, so each atoll's are built once in the run from the refreshed series. One map build per
 * run. Pages still refresh by themselves if a run is missed.
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
  clearRingMemo();
  clearLagoonMemo();
  const { saved } = await buildMapNowcasts(sites, atolls, target, options);
  const offshore = await Promise.all(atolls.map((atoll) => loadOffshore(atoll, options).catch(() => null)));
  // An atoll with an outline that got no wave side or no wind (no outline means no offshore samples at all).
  const offshoreFailed = offshore.filter(
    (item, index) => rimForAtoll(atolls[index]) != null && (item == null || item.sides.length === 0 || item.wind == null),
  ).length;
  return {
    hour: target.slice(0, 13),
    saved,
    sites: sites.length,
    atolls: atolls.length,
    offshoreFailed,
    ms: Date.now() - started,
  };
}

/** Whether a request carries the warm-up's token. False when AUTH_SECRET is not set. */
export function isWarmRequest(request: Request): boolean {
  const secret = appSetting("AUTH_SECRET");
  const token = request.headers.get(WARM_HEADER);
  return secret != null && token != null && sameText(secret, token);
}
