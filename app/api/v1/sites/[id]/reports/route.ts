import { addReport, getRecentReports, getSite } from "@/lib/actions";
import {
  API_NO_STORE,
  apiError,
  apiHandler,
  apiJson,
  apiJsonBody,
  apiNeedsToken,
  apiRecentReports,
  apiReportSaved,
} from "@/lib/api-v1";
import { bearerToken, currentSession } from "@/lib/auth";
import { routeFor } from "@/lib/load-site";
import { reportAwards } from "@/lib/points";
import { ready } from "@/lib/ready";
import { SIGN_IN_FIRST } from "@/lib/sign-in";
import { countedReports, readCatalog, readStore } from "@/lib/store";

/**
 * Divers' newest reports at the site, as the site page lists them. Without a token the answer is the same for everyone
 * and kept a minute; with one it also holds what only that diver may see (the store-review account's own reports), and
 * is never kept. A token the server turns down is read as none. API.md § GET /api/v1/sites/{id}/reports.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return apiHandler(async () => {
    const { id } = await context.params;
    const site = await getSite(id);
    if (!site || site.hidden) return apiError(404, "not_found", "Unknown site.");
    const catalog = readCatalog();
    const atoll = catalog.atolls.find((item) => item.id === site.atollId);
    const route = routeFor(site, catalog.sites, atoll)?.route ?? "channel";
    if (bearerToken(request.headers.get("authorization")) !== undefined && (await currentSession())) {
      return apiJson(apiRecentReports(site.id, await getRecentReports(site.id, route)), { cacheControl: API_NO_STORE });
    }
    return apiJson(apiRecentReports(site.id, await getRecentReports(site.id, route, { signedOut: true })), {
      cacheControl: "public, max-age=60",
    });
  });
}

/**
 * Files the signed-in diver's report: `{ time, direction, strength }`, checked exactly as the web form's. Answers with
 * the report and what it earned. API.md § POST /api/v1/sites/{id}/reports.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return apiHandler(async () => {
    const denied = apiNeedsToken(request);
    if (denied) return denied;
    const body = await apiJsonBody(request);
    if (body instanceof Response) return body;
    const { id } = await context.params;
    await ready();
    const site = await getSite(id);
    if (!site || site.hidden) return apiError(404, "not_found", "Unknown site.");
    let report;
    try {
      report = await addReport({ siteId: site.id, time: body.time, direction: body.direction, strength: body.strength });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not add that report.";
      if (message === SIGN_IN_FIRST) return apiError(401, "unauthorized", "Sign in again.");
      // The checks in addReport throw words meant for the diver, as the web form shows them.
      return apiError(400, "bad_request", message);
    }
    const award = reportAwards(countedReports(readStore())).get(report.id) ?? null;
    return apiJson(apiReportSaved(report, award), { status: 201, cacheControl: API_NO_STORE });
  });
}
