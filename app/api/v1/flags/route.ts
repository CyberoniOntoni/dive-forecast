import { userByNickname } from "@/lib/accounts";
import { API_NO_STORE, API_VERSION, apiError, apiHandler, apiJson, apiJsonBody, apiNeedsToken } from "@/lib/api-v1";
import { reportContent } from "@/lib/moderation-actions";
import { ready } from "@/lib/ready";
import { SIGN_IN_FIRST } from "@/lib/sign-in";
import { readStore } from "@/lib/store";

/**
 * Reports objectionable content to the moderators: `{"kind": "review" | "site" | "diver" | "text", "siteId"?,
 * "nickname"?, "reason", "note"?}`. A review is its site and its author's nickname, a site (or its texts written by
 * divers) is its id, a diver their nickname.
 * Answers 201 (a repeat of an open report also counts as sent). API.md § POST /api/v1/flags.
 */
export async function POST(request: Request) {
  return apiHandler(async () => {
    const denied = apiNeedsToken(request);
    if (denied) return denied;
    const body = await apiJsonBody(request);
    if (body instanceof Response) return body;
    await ready();
    let userId: string | undefined;
    if (body.kind === "review" || body.kind === "diver") {
      const user = typeof body.nickname === "string" ? userByNickname(readStore(), body.nickname) : null;
      if (!user) return apiError(404, "not_found", "No diver by that nickname.");
      userId = user.id;
    } else if (body.kind === "text" && typeof body.nickname === "string") {
      // Optional: whose text (its field's writer, `writtenBy`); without it, the newest standing revision's diver.
      const user = userByNickname(readStore(), body.nickname);
      if (!user) return apiError(404, "not_found", "No diver by that nickname.");
      userId = user.id;
    }
    const result = await reportContent({ kind: body.kind, siteId: body.siteId, userId, reason: body.reason, note: body.note });
    if (!result.ok) {
      if (result.error === SIGN_IN_FIRST) return apiError(401, "unauthorized", "Sign in again.");
      return apiError(400, "bad_request", result.error ?? "Could not send the report.");
    }
    return apiJson({ apiVersion: API_VERSION, sent: true }, { status: 201, cacheControl: API_NO_STORE });
  });
}
