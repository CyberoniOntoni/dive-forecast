import { saveReview } from "@/lib/actions";
import { apiError, apiHandler, apiJsonBody, apiReviewResult } from "@/lib/api-v1";
import { reviewWriteSite } from "@/lib/api-review-route";

/** Writes, changes or (with empty text) clears the diver's review: `{ "text": "…" }`. The site is rated first. */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return apiHandler(async () => {
    const siteId = await reviewWriteSite(request, (await context.params).id);
    if (siteId instanceof Response) return siteId;
    const body = await apiJsonBody(request);
    if (body instanceof Response) return body;
    if (typeof body.text !== "string") return apiError(400, "bad_request", "The review must be text.");
    return apiReviewResult(siteId, await saveReview(siteId, body.text), null);
  });
}
