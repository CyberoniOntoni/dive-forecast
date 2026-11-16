import { getSite } from "./actions";
import { apiError, apiNeedsToken } from "./api-v1";
import { ready } from "./ready";

/**
 * What every review write starts with: the diver's token, then a site on the map. The site's id, or the error to
 * send. API.md § Ratings and reviews.
 */
export async function reviewWriteSite(request: Request, id: string): Promise<string | Response> {
  const denied = apiNeedsToken(request);
  if (denied) return denied;
  await ready();
  const site = await getSite(id);
  if (!site || site.hidden) return apiError(404, "not_found", "Unknown site.");
  return site.id;
}
