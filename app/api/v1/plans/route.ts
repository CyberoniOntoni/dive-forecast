import {
  API_NO_STORE,
  apiError,
  apiHandler,
  apiJson,
  apiJsonBody,
  apiNeedsToken,
  apiPlanSaved,
  apiPlanSummaries,
  planInputFromApi,
} from "@/lib/api-v1";
import { getMyPlans, savePlan } from "@/lib/plan-actions";

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

/** Saves a new plan for the signed-in diver, checked as the web editor's. API.md § POST /api/v1/plans. */
export async function POST(request: Request) {
  return apiHandler(async () => {
    const denied = apiNeedsToken(request);
    if (denied) return denied;
    const body = await apiJsonBody(request);
    if (body instanceof Response) return body;
    return apiPlanSaved(await savePlan(null, planInputFromApi(body)), true);
  });
}
