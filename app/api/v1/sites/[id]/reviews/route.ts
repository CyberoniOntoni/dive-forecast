import { getSite, getSiteReviews } from "@/lib/actions";
import { API_NO_STORE, apiError, apiHandler, apiJson, apiReviews } from "@/lib/api-v1";
import { bearerToken } from "@/lib/auth";

/**
 * The site's ratings and reviews, as the site page's card shows them, with the signed-in diver's own when the request
 * carries their token. API.md § GET /api/v1/sites/{id}/reviews.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return apiHandler(async () => {
    const { id } = await context.params;
    const site = await getSite(id);
    if (!site || site.hidden) return apiError(404, "not_found", "Unknown site.");
    const signedIn = bearerToken(request.headers.get("authorization")) !== undefined;
    // With a token the body holds the diver's own review: never kept. Without, a minute in the phone's cache only.
    return apiJson(apiReviews(site.id, await getSiteReviews(site.id)), {
      cacheControl: signedIn ? API_NO_STORE : "private, max-age=60",
    });
  });
}
