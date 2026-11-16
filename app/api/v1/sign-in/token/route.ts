import { completeAppSignIn } from "@/lib/account-actions";
import { API_NO_STORE, API_VERSION, apiError, apiHandler, apiJson, apiJsonBody } from "@/lib/api-v1";

/**
 * Trades the emailed code for the app's session token (completeAppSignIn): encrypted, so it does not show the diver's
 * id, and ended by "Sign out everywhere" like the web's cookie. A new address also sends its `nickname`.
 * API.md § POST /api/v1/sign-in/token.
 */
export async function POST(request: Request) {
  return apiHandler(async () => {
    const body = await apiJsonBody(request);
    if (body instanceof Response) return body;
    const step = await completeAppSignIn({ email: body.email, code: body.code, nickname: body.nickname });
    if (!step.ok || !step.token) {
      return apiError(400, step.needsNickname ? "needs_nickname" : "bad_request", step.error ?? "Could not sign in.");
    }
    return apiJson(
      { apiVersion: API_VERSION, token: step.token, nickname: step.nickname, expiresAt: step.expiresAt },
      { cacheControl: API_NO_STORE },
    );
  });
}
