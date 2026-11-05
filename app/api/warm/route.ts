import { isWarmRequest, warmCaches } from "@/lib/warm";

/**
 * The scheduled cache warm-up (lib/warm.ts), asked by the worker's cron trigger (cloudflare-worker.js), which turns
 * away any outside request to this path. Without the token it is not found, on Node too.
 */
export async function POST(request: Request) {
  if (!isWarmRequest(request)) return new Response("Not found", { status: 404 });
  const result = await warmCaches();
  return Response.json(result);
}
