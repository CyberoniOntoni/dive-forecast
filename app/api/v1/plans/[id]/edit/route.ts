import { API_NO_STORE, apiEditablePlan, apiError, apiHandler, apiJson, apiNeedsToken } from "@/lib/api-v1";
import { currentSession } from "@/lib/auth";
import { getPlanForEdit } from "@/lib/plan-actions";
import { ready } from "@/lib/ready";

/**
 * The diver's own plan as its editor reads it: the shape PUT takes back. Only the owner gets it; anyone else, or an
 * unknown id, gets 404. API.md § GET /api/v1/plans/{id}/edit.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return apiHandler(async () => {
    const denied = apiNeedsToken(request);
    if (denied) return denied;
    await ready();
    if (!(await currentSession())) return apiError(401, "unauthorized", "Sign in again.");
    const { id } = await context.params;
    const plan = await getPlanForEdit(id);
    if (!plan) return apiError(404, "not_found", "No plan of yours at this link.");
    return apiJson(apiEditablePlan(plan), { cacheControl: API_NO_STORE });
  });
}
