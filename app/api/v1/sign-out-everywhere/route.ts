import { signOutEverywhere } from "@/lib/account-actions";
import { API_NO_STORE, API_VERSION, apiError, apiHandler, apiJson, apiJsonBody, apiNeedsToken } from "@/lib/api-v1";

/** Ends every session of the diver, the web's cookies and this token included. API.md § POST /api/v1/sign-out-everywhere. */
export async function POST(request: Request) {
  return apiHandler(async () => {
    const denied = apiNeedsToken(request);
    if (denied) return denied;
    const body = await apiJsonBody(request);
    if (body instanceof Response) return body;
    const result = await signOutEverywhere();
    if (!result.ok) return apiError(401, "unauthorized", result.error ?? "Sign in first.");
    return apiJson({ apiVersion: API_VERSION }, { cacheControl: API_NO_STORE });
  });
}
