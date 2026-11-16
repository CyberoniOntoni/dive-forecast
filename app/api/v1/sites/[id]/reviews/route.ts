import { getSite, getSiteReviews } from "@/lib/actions";
import { API_NO_STORE, apiError, apiHandler, apiJson, apiReviews } from "@/lib/api-v1";
import { bearerToken, currentSession } from "@/lib/auth";

/**
 * The site's ratings and reviews, as the site page's card shows them, with the signed-in diver's own when the request
 * carries their token. The web's cookie is ignored here: without a token the answer is the same for everyone, so the
 * phone may keep it a minute. A token the server turns down answers 401, so the app drops it and asks again without.
 * API.md § GET /api/v1/sites/{id}/reviews.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return apiHandler(async () => {
    const { id } = await context.params;
    const site = await getSite(id);
    if (!site || site.hidden) return apiError(404, "not_found", "Unknown site.");
    if (bearerToken(request.headers.get("authorization")) === undefined) {
      return apiJson(apiReviews(site.id, await getSiteReviews(site.id, { signedOut: true })), {
        cacheControl: "private, max-age=60",
      });
    }
    if (!(await currentSession())) return apiError(401, "unauthorized", "Sign in again.");
    // The body holds the diver's own review: never kept.
    return apiJson(apiReviews(site.id, await getSiteReviews(site.id)), { cacheControl: API_NO_STORE });
  });
}
