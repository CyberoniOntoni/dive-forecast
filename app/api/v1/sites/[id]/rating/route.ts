import { removeMyRating, submitRating } from "@/lib/actions";
import { apiError, apiHandler, apiJsonBody, apiReviewResult } from "@/lib/api-v1";
import { reviewWriteSite } from "@/lib/api-review-route";

/** Rates the site 1 to 5, or changes the diver's rating: `{ "score": 4 }`. Answers with the whole card. */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return apiHandler(async () => {
    const siteId = await reviewWriteSite(request, (await context.params).id);
    if (siteId instanceof Response) return siteId;
    const body = await apiJsonBody(request);
    if (body instanceof Response) return body;
    if (typeof body.score !== "number") return apiError(400, "bad_request", "Pick a rating from 1 to 5.");
    return apiReviewResult(siteId, await submitRating(siteId, body.score), null);
  });
}

/** Removes the diver's rating with its review and photos (and the points it earned). Answers with the whole card. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return apiHandler(async () => {
    const siteId = await reviewWriteSite(request, (await context.params).id);
    if (siteId instanceof Response) return siteId;
    return apiReviewResult(siteId, await removeMyRating(siteId), null);
  });
}
