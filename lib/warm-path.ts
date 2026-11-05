/** The path the worker's cron trigger asks (cloudflare-worker.js), which turns away any outside request to it. */
export const WARM_PATH = "/api/warm";
/** The header carrying AUTH_SECRET on that request, so the route does nothing for anyone else (on Node too). */
export const WARM_HEADER = "x-warm-token";
