import { userByNickname } from "@/lib/accounts";
import { API_NO_STORE, API_VERSION, apiError, apiHandler, apiJson, apiNeedsToken } from "@/lib/api-v1";
import { blockDiver } from "@/lib/moderation-actions";
import { ready } from "@/lib/ready";
import { SIGN_IN_FIRST } from "@/lib/sign-in";
import { readStore } from "@/lib/store";

/**
 * Blocks (POST) or unblocks (DELETE) a diver for the signed-in one: their reviews and photos are no longer shown to
 * them. Found by nickname, like GET /api/v1/divers/{nickname}. API.md § Blocking divers.
 */
async function setBlock(request: Request, context: { params: Promise<{ nickname: string }> }, blocked: boolean) {
  return apiHandler(async () => {
    const denied = apiNeedsToken(request);
    if (denied) return denied;
    await ready();
    const raw = (await context.params).nickname;
    let name = raw;
    try {
      name = decodeURIComponent(raw);
    } catch {
      // Not encoded: keep it as it came.
    }
    const user = userByNickname(readStore(), name);
    if (!user) return apiError(404, "not_found", "No diver by that nickname.");
    const result = await blockDiver(user.id, blocked);
    if (!result.ok) {
      if (result.error === SIGN_IN_FIRST) return apiError(401, "unauthorized", "Sign in again.");
      return apiError(400, "bad_request", result.error ?? "Could not save that.");
    }
    return apiJson({ apiVersion: API_VERSION, blocked }, { cacheControl: API_NO_STORE });
  });
}

export async function POST(request: Request, context: { params: Promise<{ nickname: string }> }) {
  return setBlock(request, context, true);
}

export async function DELETE(request: Request, context: { params: Promise<{ nickname: string }> }) {
  return setBlock(request, context, false);
}
