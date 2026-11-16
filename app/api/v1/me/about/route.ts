import { changeAbout } from "@/lib/account-actions";
import { API_NO_STORE, API_VERSION, apiError, apiHandler, apiJson, apiJsonBody, apiNeedsToken } from "@/lib/api-v1";
import { SIGN_IN_FIRST } from "@/lib/sign-in";

/** Saves the diver's About me, `{"about": "…"}` (empty clears it), as the web's account page. API.md § PUT /api/v1/me/about. */
export async function PUT(request: Request) {
  return apiHandler(async () => {
    const denied = apiNeedsToken(request);
    if (denied) return denied;
    const body = await apiJsonBody(request);
    if (body instanceof Response) return body;
    const result = await changeAbout(body.about ?? "");
    if (!result.ok) {
      if (result.error === SIGN_IN_FIRST) return apiError(401, "unauthorized", "Sign in again.");
      return apiError(400, "bad_request", result.error ?? "Could not save About me.");
    }
    return apiJson({ apiVersion: API_VERSION, about: result.about ?? "" }, { cacheControl: API_NO_STORE });
  });
}
