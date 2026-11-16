import { API_NO_STORE, apiError, apiHandler, apiJson, apiNeedsToken, apiPlanSummaries } from "@/lib/api-v1";
import { getMyPlans } from "@/lib/plan-actions";

/** The signed-in diver's own plans, newest change first. API.md § GET /api/v1/plans. */
export async function GET(request: Request) {
  return apiHandler(async () => {
    const denied = apiNeedsToken(request);
    if (denied) return denied;
    const plans = await getMyPlans();
    if (!plans) return apiError(401, "unauthorized", "Sign in again.");
    return apiJson(apiPlanSummaries(plans), { cacheControl: API_NO_STORE });
  });
}
