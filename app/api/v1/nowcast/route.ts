import { listSites } from "@/lib/actions";
import { apiHandler, apiJson, apiNowcast } from "@/lib/api-v1";
import { toMaldivesWall } from "@/lib/forecast";
import { mapNowcasts } from "@/lib/nowcast-cache";
import { readCatalog } from "@/lib/store";

/**
 * Every site's forecast for the current Maldives hour, as the map shows it (lib/nowcast-cache.ts: never waits on a
 * first fetch, so a site without a cached series comes back unavailable). API.md § GET /api/v1/nowcast.
 */
export async function GET() {
  return apiHandler(async () => {
    const sites = await listSites();
    const maldivesWall = toMaldivesWall(new Date().toISOString());
    const nowcasts = await mapNowcasts(sites, readCatalog().atolls, maldivesWall);
    return apiJson(apiNowcast(nowcasts, maldivesWall));
  });
}
