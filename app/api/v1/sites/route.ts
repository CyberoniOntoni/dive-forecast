import { listSites } from "@/lib/actions";
import { apiHandler, apiJson, apiSites } from "@/lib/api-v1";
import { readCatalog } from "@/lib/store";

/** Every site on the map (catalog and pins added in the app) and the atolls' names. API.md § GET /api/v1/sites. */
export async function GET() {
  return apiHandler(async () => {
    const sites = await listSites();
    return apiJson(apiSites(sites, readCatalog().atolls));
  });
}
