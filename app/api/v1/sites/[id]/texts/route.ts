import { API_NO_STORE, apiError, apiHandler, apiJson, apiJsonBody, apiSiteTexts, apiSiteTextsResult } from "@/lib/api-v1";
import { reviewWriteSite } from "@/lib/api-review-route";
import { currentSession } from "@/lib/auth";
import { getSiteWiki, proposeSiteEdit } from "@/lib/wiki-actions";

/**
 * The app's edit form for the site's texts: what the site shows now, whether the diver may send, and their own edit.
 * Needs the token. API.md § Site texts.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return apiHandler(async () => {
    const siteId = await reviewWriteSite(request, (await context.params).id);
    if (siteId instanceof Response) return siteId;
    if (!(await currentSession())) return apiError(401, "unauthorized", "Sign in again.");
    const wiki = await getSiteWiki(siteId);
    if (!wiki) return apiError(404, "not_found", "Unknown site.");
    return apiJson(apiSiteTexts(wiki), { cacheControl: API_NO_STORE });
  });
}

/**
 * Proposes an edit: `{ "texts": { "description"?: "…", "howToDive"?: "…" }, "based": { …the texts the form started
 * from… }, "note"?: "…" }`. Send only the fields the diver changed. Sending again while it waits changes that edit.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return apiHandler(async () => {
    const siteId = await reviewWriteSite(request, (await context.params).id);
    if (siteId instanceof Response) return siteId;
    const body = await apiJsonBody(request);
    if (body instanceof Response) return body;
    return apiSiteTextsResult(await proposeSiteEdit({ siteId, texts: body.texts, based: body.based, note: body.note }));
  });
}
