import { getShelterShapes } from "@/lib/actions";
import { apiError, apiHandler, apiJson, apiShelterShapes } from "@/lib/api-v1";

/** The outlines change only with a new build: a day fresh, a week served while a new copy is fetched. */
const SHAPES_CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";

/**
 * An atoll's outline and the islands in and round it, for cutting the sheltered-water shading to water.
 * API.md § GET /api/v1/shelter/shapes/{wayId}.
 */
export async function GET(_request: Request, context: { params: Promise<{ wayId: string }> }) {
  return apiHandler(async () => {
    const { wayId } = await context.params;
    if (!/^\d+$/.test(wayId)) return apiError(404, "not_found", "Unknown outline.");
    const shapes = await getShelterShapes(wayId);
    if (!shapes) return apiError(404, "not_found", "Unknown outline.");
    return apiJson(apiShelterShapes(wayId, shapes), { cacheControl: SHAPES_CACHE_CONTROL });
  });
}
