// The Cloudflare entry point (wrangler.jsonc "main"): OpenNext's worker, with bot probes turned away first, and the
// cron trigger's cache warm-up (lib/warm.ts). See CLOUDFLARE.md. Build .open-next/ with `npm run cf:build` before
// wrangler bundles this.
import { rejectedResponse, rejectsRequest } from "./lib/request-guard";
import { WARM_HEADER, WARM_PATH } from "./lib/warm-path";
import handler from "./.open-next/worker.js";

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

const worker = {
  fetch(request, env, ctx) {
    // The warm-up path is only ever asked from scheduled() below, never from outside.
    if (new URL(request.url).pathname === WARM_PATH) return new Response("Not found", { status: 404 });
    if (rejectsRequest(request)) return rejectedResponse();
    return handler.fetch(request, env, ctx);
  },

  // wrangler.jsonc "triggers": every few minutes, refresh the series that are nearly due and build the map's
  // nowcasts ahead of the hour, through Next like any request so the app's request context is set.
  async scheduled(_controller, env, ctx) {
    if (!env.AUTH_SECRET) {
      console.warn("Cache warm-up skipped: AUTH_SECRET is not set");
      return;
    }
    const origin = env.APP_URL || "https://localhost";
    const request = new Request(new URL(WARM_PATH, origin), {
      method: "POST",
      headers: { [WARM_HEADER]: env.AUTH_SECRET },
    });
    const response = await handler.fetch(request, env, ctx);
    const body = await response.text();
    if (!response.ok) throw new Error(`Cache warm-up: HTTP ${response.status} ${body.slice(0, 200)}`);
    console.log(`Cache warm-up: ${body}`);
  },
};

export default worker;
