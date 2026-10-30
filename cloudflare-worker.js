// The Cloudflare entry point (wrangler.jsonc "main"): OpenNext's worker, with bot probes turned away first.
// See CLOUDFLARE.md. Build .open-next/ with `npm run cf:build` before wrangler bundles this.
import { rejectedResponse, rejectsRequest } from "./lib/request-guard";
import handler from "./.open-next/worker.js";

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

const worker = {
  fetch(request, env, ctx) {
    if (rejectsRequest(request)) return rejectedResponse();
    return handler.fetch(request, env, ctx);
  },
};

export default worker;
