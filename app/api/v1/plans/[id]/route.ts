import {
  API_NO_STORE,
  API_VERSION,
  apiError,
  apiHandler,
  apiJson,
  apiJsonBody,
  apiNeedsToken,
  apiPlan,
  apiPlanRefused,
  apiPlanSaved,
  planInputFromApi,
} from "@/lib/api-v1";
import { isPlanId } from "@/lib/dive-plan";
import { deletePlan, savePlan } from "@/lib/plan-actions";
import { loadPlanView } from "@/lib/plan-view";

/**
 * A plan by its share link's id, as the plan page shows it: anyone with the id reads it. With the app's token,
 * `isOwner` says whether this diver made it, so the answer is private to the caller. API.md § GET /api/v1/plans/{id}.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return apiHandler(async () => {
    const { id } = await context.params;
    const view = await loadPlanView(id);
    if (!view) return apiError(404, "not_found", NO_PLAN);
    return apiJson(apiPlan(view), { cacheControl: "private, max-age=60" });
  });
}

const NO_PLAN = "No plan at this link. It may have been deleted.";

/** Replaces the diver's own plan with the body, checked as the web editor's. API.md § PUT /api/v1/plans/{id}. */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return apiHandler(async () => {
    const denied = apiNeedsToken(request);
    if (denied) return denied;
    const body = await apiJsonBody(request);
    if (body instanceof Response) return body;
    const { id } = await context.params;
    if (!isPlanId(id)) return apiError(404, "not_found", NO_PLAN);
    return apiPlanSaved(await savePlan(id, planInputFromApi(body)), false);
  });
}

/** Deletes the diver's own plan; its link stops working. API.md § DELETE /api/v1/plans/{id}. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return apiHandler(async () => {
    const denied = apiNeedsToken(request);
    if (denied) return denied;
    const { id } = await context.params;
    if (!isPlanId(id)) return apiError(404, "not_found", NO_PLAN);
    const result = await deletePlan(id);
    if (!result.ok) return apiPlanRefused(result.error ?? "Could not delete the plan.");
    return apiJson({ apiVersion: API_VERSION, id, deleted: true }, { cacheControl: API_NO_STORE });
  });
}
