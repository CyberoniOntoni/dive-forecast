/** The path the worker's cron trigger asks (cloudflare-worker.js), which turns away any outside request to it. */
export const WARM_PATH = "/api/warm";
/** The header carrying AUTH_SECRET on that request, so the route does nothing for anyone else (on Node too). */
export const WARM_HEADER = "x-warm-token";

/**
 * Whether a request path names the warm-up route however it is spelled: percent-encoded, with doubled or trailing
 * slashes, or in other letter case. The worker turns all of them away, so only scheduled() reaches the route.
 */
export function isWarmPath(pathname: string): boolean {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // A malformed escape is checked as it is.
  }
  return decoded.replace(/\/+/g, "/").replace(/\/$/, "").toLowerCase() === WARM_PATH;
}
