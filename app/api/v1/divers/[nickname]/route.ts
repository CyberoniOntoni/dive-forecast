import { getDiverProfile } from "@/lib/account-actions";
import { API_VERSION, apiError, apiHandler, apiJson, apiViewer, viewerCache, type ApiDiver } from "@/lib/api-v1";
import { sinceLine } from "@/lib/profile-words";
import { ready } from "@/lib/ready";
import { readStore } from "@/lib/store";

/**
 * A diver's public page, found by nickname (unique, any case), so no diver id ever reaches the app. Nickname, About
 * me, numbers and earned badges; never the email. API.md § GET /api/v1/divers/{nickname}.
 */
export async function GET(request: Request, context: { params: Promise<{ nickname: string }> }) {
  return apiHandler(async () => {
    const viewer = await apiViewer(request);
    if (viewer instanceof Response) return viewer;
    await ready();
    // Nicknames hold no "%", so decoding a segment the router left encoded ("Big%20Manta") is safe.
    const raw = (await context.params).nickname;
    let name = raw;
    try {
      name = decodeURIComponent(raw);
    } catch {
      // Not encoded: keep it as it came.
    }
    const key = name.trim().toLowerCase();
    const user = readStore().users.find((item) => item.nickname.toLowerCase() === key);
    const diver = user ? await getDiverProfile(user.id) : null;
    if (!user || !diver) return apiError(404, "not_found", "No diver by that nickname.");
    const body: ApiDiver = {
      apiVersion: API_VERSION,
      nickname: diver.nickname,
      about: diver.about,
      sinceLine: sinceLine(diver.since, diver.allRank),
      points: diver.stats.points,
      reports: diver.stats.reports,
      reportSites: diver.stats.sites,
      ratings: diver.stats.ratings,
      sitesAdded: diver.sitesAdded,
      allRank: diver.allRank,
      badges: diver.badges.map((badge) => ({ id: badge.id, label: badge.label, detail: badge.detail })),
      isMe: viewer?.userId === user.id,
    };
    return apiJson(body, { cacheControl: viewerCache(viewer) });
  });
}
