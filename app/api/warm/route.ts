import { isWarmRequest, warmCaches } from "@/lib/warm";

/**
 * The scheduled cache warm-up (lib/warm.ts), asked by the worker's cron trigger (cloudflare-worker.js), which turns
 * away any outside request to this path. Without the token it is not found, on Node too.
 */
export async function POST(request: Request) {
  if (!isWarmRequest(request)) return new Response("Not found", { status: 404 });
  const result = await warmCaches();
  // A list R2 refused is a failed run: 500, so scheduled() throws and Trigger events show it.
  return Response.json(result, { status: result.saved ? 200 : 500 });
}
