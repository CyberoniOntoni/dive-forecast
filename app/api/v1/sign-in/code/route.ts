import { requestSignIn } from "@/lib/account-actions";
import { API_NO_STORE, API_VERSION, apiError, apiHandler, apiJson, apiJsonBody } from "@/lib/api-v1";

/** Emails a six-digit sign-in code to `email`, as the web's sign-in page does. API.md § POST /api/v1/sign-in/code. */
export async function POST(request: Request) {
  return apiHandler(async () => {
    const body = await apiJsonBody(request);
    if (body instanceof Response) return body;
    const step = await requestSignIn(body.email);
    if (!step.ok) return apiError(400, "bad_request", step.error ?? "Could not send a code.");
    return apiJson({ apiVersion: API_VERSION, newUser: step.newUser === true }, { cacheControl: API_NO_STORE });
  });
}
