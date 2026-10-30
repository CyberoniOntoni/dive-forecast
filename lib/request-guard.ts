/**
 * Whether the worker turns a request away before Next sees it. Pages are read with GET or HEAD and server actions
 * POST with a Next-Action header (or a multipart form when JavaScript is off); anything else is a bot probe, such as
 * WordPress's POST /?rest_route=/batch/v1, which would otherwise render the whole map for nothing.
 */
export function rejectsRequest(request: Request): boolean {
  if (request.method === "GET" || request.method === "HEAD") return false;
  if (request.method !== "POST") return true;
  if (request.headers.has("next-action")) return false;
  return !(request.headers.get("content-type") ?? "").startsWith("multipart/form-data");
}

export function rejectedResponse(): Response {
  return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
}
