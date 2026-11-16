import { changeNickname } from "@/lib/account-actions";
import { API_NO_STORE, API_VERSION, apiError, apiHandler, apiJson, apiJsonBody, apiNeedsToken } from "@/lib/api-v1";
import { SIGN_IN_FIRST } from "@/lib/sign-in";

/**
 * Renames the diver, `{"nickname": "…"}`, checked as on the web (2 to 20 characters, not taken). The token keeps
 * working; GET /api/v1/me gives the new name. API.md § PUT /api/v1/me/nickname.
 */
export async function PUT(request: Request) {
  return apiHandler(async () => {
    const denied = apiNeedsToken(request);
    if (denied) return denied;
    const body = await apiJsonBody(request);
    if (body instanceof Response) return body;
    // No cookie: the app holds a token, and a web cookie set on an API answer would sign in whatever browser called.
    const result = await changeNickname(body.nickname, { cookie: false });
    if (!result.ok) {
      if (result.error === SIGN_IN_FIRST) return apiError(401, "unauthorized", "Sign in again.");
      return apiError(400, "bad_request", result.error ?? "Could not change the nickname.");
    }
    return apiJson({ apiVersion: API_VERSION, nickname: result.nickname }, { cacheControl: API_NO_STORE });
  });
}
