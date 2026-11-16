import { addReviewPhoto, getSiteReviews } from "@/lib/actions";
import { apiError, apiHandler, apiReviewResult } from "@/lib/api-v1";
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
    const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "image/jpeg") return apiError(415, "bad_request", "Send the photo as image/jpeg.");
    const declared = Number(request.headers.get("content-length") ?? Number.NaN);
    if (declared > MAX_PHOTO_BYTES) return apiError(413, "bad_request", "That photo is too large.");
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_PHOTO_BYTES) return apiError(413, "bad_request", "That photo is too large.");
    const form = new FormData();
    form.set("photo", new Blob([bytes], { type: "image/jpeg" }), "photo.jpg");
    const result = await addReviewPhoto(siteId, form);
    return apiReviewResult(siteId, result, result.ok ? await getSiteReviews(siteId) : null, 201);
  });
}
