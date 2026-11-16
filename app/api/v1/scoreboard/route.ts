import { getLeaderboard, getSiteScouts } from "@/lib/account-actions";
import { API_VERSION, apiHandler, apiJson, apiViewer, viewerCache, type ApiScoreboard } from "@/lib/api-v1";
import { boardWords, reporterDetail, scoutDetail, sitesUnit } from "@/lib/profile-words";

/**
 * The web's scoreboard (app/scoreboard): `?board=month` (default), `all` or `sites`. Nicknames only; with the app's
 * token the diver's own row is marked. API.md § GET /api/v1/scoreboard.
 */
export async function GET(request: Request) {
  return apiHandler(async () => {
    const viewer = await apiViewer(request);
    if (viewer instanceof Response) return viewer;
    const asked = new URL(request.url).searchParams.get("board");
    const board: ApiScoreboard["board"] = asked === "sites" ? "sites" : asked === "all" ? "all" : "month";
    const me = viewer?.userId ?? null;
    let body: ApiScoreboard;
    if (board === "sites") {
      const { scouts, newest } = await getSiteScouts();
      body = {
        apiVersion: API_VERSION,
        board,
        ...boardWords(board),
        rows: scouts.map((row) => ({
          rank: row.rank,
          nickname: row.nickname,
          detail: scoutDetail(row),
          score: row.sites,
          unit: sitesUnit(row.sites),
          isMe: row.userId === me,
        })),
        newest: newest.map((site) => ({ siteId: site.id, name: site.name, nickname: site.nickname })),
      };
    } else {
      const rows = await getLeaderboard(board);
      body = {
        apiVersion: API_VERSION,
        board,
        ...boardWords(board),
        rows: rows.map((row) => ({
          rank: row.rank,
          nickname: row.nickname,
          detail: reporterDetail(row),
          score: row.points,
          unit: null,
          isMe: row.userId === me,
        })),
        newest: [],
      };
    }
    return apiJson(body, { cacheControl: viewerCache(viewer) });
  });
}
