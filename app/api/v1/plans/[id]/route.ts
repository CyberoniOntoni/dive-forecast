import { apiError, apiHandler, apiJson, apiPlan } from "@/lib/api-v1";
import { loadPlanView } from "@/lib/plan-view";

/**
 * A plan by its share link's id, as the plan page shows it: anyone with the id reads it. With the app's token,
 * `isOwner` says whether this diver made it, so the answer is private to the caller. API.md § GET /api/v1/plans/{id}.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return apiHandler(async () => {
    const { id } = await context.params;
    const view = await loadPlanView(id);
    if (!view) return apiError(404, "not_found", "No plan at this link. It may have been deleted.");
    return apiJson(apiPlan(view), { cacheControl: "private, max-age=60" });
  });
}
