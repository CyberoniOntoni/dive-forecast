import { getSite } from "@/lib/actions";
import { apiError, apiHandler, apiJson, apiSite, atollNameOf } from "@/lib/api-v1";
import { readCatalog } from "@/lib/store";

/** One site. API.md § GET /api/v1/sites/{id}. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return apiHandler(async () => {
    const { id } = await context.params;
    const site = await getSite(id);
    if (!site || site.hidden) return apiError(404, "not_found", "Unknown site.");
    return apiJson(apiSite(site, atollNameOf(readCatalog().atolls, site.atollId)));
  });
}
