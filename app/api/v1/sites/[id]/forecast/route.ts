import { forecastSite, getSite } from "@/lib/actions";
import { apiError, apiForecast, apiHandler, apiJson } from "@/lib/api-v1";

/** The site's week of hours and sea state, as the site page shows them. API.md § GET /api/v1/sites/{id}/forecast. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return apiHandler(async () => {
    const { id } = await context.params;
    const site = await getSite(id);
    if (!site || site.hidden) return apiError(404, "not_found", "Unknown site.");
    return apiJson(apiForecast(site.id, await forecastSite(site.id)));
  });
}
