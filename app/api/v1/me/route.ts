import { getAccount } from "@/lib/account-actions";
import { API_NO_STORE, API_VERSION, apiError, apiHandler, apiJson, apiNeedsToken } from "@/lib/api-v1";

/**
 * The signed-in diver, for the app's account line: nickname and points, never the email or id. 401 once the token
 * has expired or the diver signed out everywhere. API.md § GET /api/v1/me.
 */
export async function GET(request: Request) {
  return apiHandler(async () => {
    const denied = apiNeedsToken(request);
    if (denied) return denied;
    const account = await getAccount();
    if (!account) return apiError(401, "unauthorized", "Sign in again.");
    return apiJson(
      {
        apiVersion: API_VERSION,
        nickname: account.nickname,
        points: account.stats.points,
        monthPoints: account.stats.monthPoints,
        reports: account.stats.reports,
        monthRank: account.monthRank,
        allRank: account.allRank,
      },
      { cacheControl: API_NO_STORE },
    );
  });
}
