import { getAccount } from "@/lib/account-actions";
import { ABOUT_MAX } from "@/lib/accounts";
import { pointsRuleLines } from "@/lib/profile-words";
import { readStore } from "@/lib/store";
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
        // Sites this diver added in the app, so the app offers them "Add photos" there (only the adder adds them).
        addedSiteIds: readStore()
          .sites.filter((site) => site.addedBy === account.userId && !site.hidden)
          .map((site) => site.id),
        // The rest of the web's account page: About me, the other numbers, every badge and how points work.
        about: account.about,
        ratings: account.stats.ratings,
        reportSites: account.stats.sites,
        atolls: account.stats.atolls,
        badges: account.badges.map((badge) => ({ id: badge.id, label: badge.label, detail: badge.detail, earned: badge.earned })),
        pointsRules: pointsRuleLines(),
        aboutMaxChars: ABOUT_MAX,
      },
      { cacheControl: API_NO_STORE },
    );
  });
}
