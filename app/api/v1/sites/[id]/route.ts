import { getSite } from "@/lib/actions";
import { adderNicknames, apiError, apiHandler, apiJson, apiSite, atollNameOf, wikiOf } from "@/lib/api-v1";
import { readCatalog, readStore, siteRecord } from "@/lib/store";

/** One site. API.md § GET /api/v1/sites/{id}. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return apiHandler(async () => {
    const { id } = await context.params;
    const site = await getSite(id);
    if (!site || site.hidden) return apiError(404, "not_found", "Unknown site.");
    const store = readStore();
    const wiki = wikiOf(store, (siteId) => siteRecord(store, siteId))(site);
    return apiJson(apiSite(site, atollNameOf(readCatalog().atolls, site.atollId), adderNicknames(store)(site), wiki));
  });
}
