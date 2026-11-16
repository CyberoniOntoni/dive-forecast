import { removeReviewPhoto } from "@/lib/actions";
import { apiHandler, apiReviewResult } from "@/lib/api-v1";
import { reviewWriteSite } from "@/lib/api-review-route";

/** Takes one of the diver's own photos off their review, and deletes it. Answers with the whole card. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string; photoId: string }> }) {
  return apiHandler(async () => {
    const { id, photoId } = await context.params;
    const siteId = await reviewWriteSite(request, id);
    if (siteId instanceof Response) return siteId;
    return apiReviewResult(siteId, await removeReviewPhoto(siteId, photoId), null);
  });
}
