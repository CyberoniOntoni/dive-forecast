import { addReviewPhoto, getSiteReviews } from "@/lib/actions";
import { apiError, apiHandler, apiReviewResult, requestType } from "@/lib/api-v1";
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
    if (requestType(request) !== "image/jpeg") return apiError(415, "bad_request", "Send the photo as image/jpeg.");
    const declared = Number(request.headers.get("content-length") ?? Number.NaN);
    if (declared > MAX_PHOTO_BYTES) return apiError(413, "bad_request", "That photo is too large.");
    // Read no further than the limit: a body sent without a length is cut off there, not buffered whole.
    const bytes = await readAtMost(request, MAX_PHOTO_BYTES);
    if (!bytes) return apiError(413, "bad_request", "That photo is too large.");
    const form = new FormData();
    form.set("photo", new Blob([bytes], { type: "image/jpeg" }), "photo.jpg");
    const result = await addReviewPhoto(siteId, form);
    return apiReviewResult(siteId, result, result.ok ? await getSiteReviews(siteId) : null, 201);
  });
}

/** The body's bytes, or null once it passes `max`. */
async function readAtMost(request: Request, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}
