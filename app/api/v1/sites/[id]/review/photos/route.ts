import { addReviewPhoto, getSiteReviews } from "@/lib/actions";
import { apiHandler, apiJpegBody, apiReviewResult, photoForm } from "@/lib/api-v1";
import { reviewWriteSite } from "@/lib/api-review-route";
import { MAX_PHOTO_BYTES } from "@/lib/site-photos-limits";

/**
 * Adds one photo to the diver's review: the body is the JPEG itself (`Content-Type: image/jpeg`, at most 1.5 MB,
 * already shrunk by the app). Camera data is stripped before it is saved. Answers 201 with the whole card.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return apiHandler(async () => {
    const siteId = await reviewWriteSite(request, (await context.params).id);
    if (siteId instanceof Response) return siteId;
    const bytes = await apiJpegBody(request, MAX_PHOTO_BYTES);
    if (bytes instanceof Response) return bytes;
    const result = await addReviewPhoto(siteId, photoForm(bytes));
    return apiReviewResult(siteId, result, result.ok ? await getSiteReviews(siteId) : null, 201);
  });
}
