import { addSitePhoto, getSite } from "@/lib/actions";
import { apiError, apiHandler, apiJpegBody, apiNeedsToken, apiSiteSaved, atollNameOf, photoForm } from "@/lib/api-v1";
import { ready } from "@/lib/ready";
import { SIGN_IN_FIRST } from "@/lib/sign-in";
import { MAX_PHOTO_BYTES } from "@/lib/site-photos-limits";
import { readCatalog } from "@/lib/store";

/**
 * Adds one photo to a site the diver added in the app: the body is the JPEG itself (`Content-Type: image/jpeg`, at
 * most 1.5 MB, already shrunk by the app). Only the adder adds photos, as on the web. Camera data is stripped before
 * it is saved. Answers 201 with the site. API.md § POST /api/v1/sites/{id}/photos.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return apiHandler(async () => {
    const denied = apiNeedsToken(request);
    if (denied) return denied;
    await ready();
    const { id } = await context.params;
    const site = await getSite(id);
    if (!site || site.hidden) return apiError(404, "not_found", "Unknown site.");
    const bytes = await apiJpegBody(request, MAX_PHOTO_BYTES);
    if (bytes instanceof Response) return bytes;
    const result = await addSitePhoto(site.id, photoForm(bytes));
    if (!result.ok) {
      if (result.error === SIGN_IN_FIRST) return apiError(401, "unauthorized", "Sign in again.");
      // A catalog site, or another diver's: not theirs to add to.
      if (site.sourceUrl !== "user" || result.error.startsWith("Only the diver")) return apiError(403, "forbidden", result.error);
      return apiError(400, "bad_request", result.error);
    }
    const saved = await getSite(site.id);
    if (!saved) return apiError(404, "not_found", "Unknown site.");
    return apiSiteSaved(saved, atollNameOf(readCatalog().atolls, saved.atollId), 201);
  });
}
