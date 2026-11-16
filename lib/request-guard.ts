/**
 * Whether the worker turns a request away before Next sees it. Pages are read with GET or HEAD and server actions
 * POST with a Next-Action header (or a multipart form when JavaScript is off); anything else is a bot probe, such as
 * WordPress's POST /?rest_route=/batch/v1, which would otherwise render the whole map for nothing. The app's JSON API
 * (API.md) also takes POST with a JSON body under /api/v1/.
 */
export function rejectsRequest(request: Request): boolean {
  if (request.method === "GET" || request.method === "HEAD") return false;
  if (request.method !== "POST") return true;
  if (request.headers.has("next-action")) return false;
  if (isApiWrite(request)) return false;
  return !(request.headers.get("content-type") ?? "").startsWith("multipart/form-data");
}

export function rejectedResponse(): Response {
  return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
}

function isApiWrite(request: Request): boolean {
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  return type === "application/json" && new URL(request.url).pathname.startsWith("/api/v1/");
}
