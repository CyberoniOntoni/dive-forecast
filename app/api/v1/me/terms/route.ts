import { API_NO_STORE, API_VERSION, apiError, apiHandler, apiJson, apiNeedsToken } from "@/lib/api-v1";
import { acceptTerms } from "@/lib/moderation-actions";

/** The diver agrees to the content rules (/terms), for divers who signed up before them. API.md § POST /api/v1/me/terms. */
export async function POST(request: Request) {
  return apiHandler(async () => {
    const denied = apiNeedsToken(request);
    if (denied) return denied;
    const result = await acceptTerms();
    if (!result.ok) return apiError(401, "unauthorized", result.error ?? "Sign in again.");
    return apiJson({ apiVersion: API_VERSION, acceptedTerms: true }, { cacheControl: API_NO_STORE });
  });
}
