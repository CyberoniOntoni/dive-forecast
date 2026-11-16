/**
 * Whether the worker turns a request away before Next sees it. Pages are read with GET or HEAD and server actions
 * POST with a Next-Action header (or a multipart form when JavaScript is off); anything else is a bot probe, such as
 * WordPress's POST /?rest_route=/batch/v1, which would otherwise render the whole map for nothing. The app's JSON API
 * (API.md) takes POST, PUT and DELETE under /api/v1/; its routes answer a wrong body (415), a missing token (401) or a
 * method they do not take (405) themselves.
 */
export function rejectsRequest(request: Request): boolean {
  if (request.method === "GET" || request.method === "HEAD") return false;
  const api = new URL(request.url).pathname.startsWith("/api/v1/");
  if (api && (request.method === "POST" || request.method === "PUT" || request.method === "DELETE")) return false;
  if (request.method !== "POST") return true;
  if (request.headers.has("next-action")) return false;
  return !(request.headers.get("content-type") ?? "").startsWith("multipart/form-data");
}

export function rejectedResponse(): Response {
  return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
}

