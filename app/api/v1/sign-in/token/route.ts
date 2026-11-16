import { API_NO_STORE, API_VERSION, apiError, apiHandler, apiJson, apiJsonBody } from "@/lib/api-v1";
import { authSecret } from "@/lib/auth";
import { ready } from "@/lib/ready";
import { SESSION_MAX_AGE_S, signSession } from "@/lib/session-token";
import { checkSignInCode, NOT_SET_UP } from "@/lib/sign-in-code";

/**
 * Trades the emailed code for the app's session token: the same signed token as the web's cookie, so "Sign out
 * everywhere" ends it too. A new address also sends its `nickname`. API.md § POST /api/v1/sign-in/token.
 */
export async function POST(request: Request) {
  return apiHandler(async () => {
    const body = await apiJsonBody(request);
    if (body instanceof Response) return body;
    await ready();
    const secret = authSecret();
    if (!secret) return apiError(400, "bad_request", NOT_SET_UP);
    let result;
    try {
      result = await checkSignInCode({ email: body.email, code: body.code, nickname: body.nickname });
    } catch (caught) {
      // normalizeEmail and requireNickname throw words meant for the diver.
      return apiError(400, "bad_request", caught instanceof Error ? caught.message : "Could not sign in.");
    }
    if (!result.ok) return apiError(400, result.needsNickname ? "needs_nickname" : "bad_request", result.error);
    const issuedAt = Date.now();
    const token = await signSession({ userId: result.user.id, nickname: result.user.nickname, issuedAt }, secret);
    return apiJson(
      {
        apiVersion: API_VERSION,
        token,
        nickname: result.user.nickname,
        expiresAt: issuedAt + SESSION_MAX_AGE_S * 1000,
      },
      { cacheControl: API_NO_STORE },
    );
  });
}
