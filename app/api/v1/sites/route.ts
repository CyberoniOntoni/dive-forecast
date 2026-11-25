import { getSite, listSites, submitSite } from "@/lib/actions";
import { adderNicknames, apiError, apiHandler, apiJson, apiJsonBody, apiNeedsToken, apiSiteSaved, apiSites, atollNameOf, wikiOf } from "@/lib/api-v1";
import { SIGN_IN_FIRST } from "@/lib/sign-in";
import { rimForAtoll } from "@/lib/rim";
import { readCatalog, readStore, siteRecord } from "@/lib/store";

/** Every site on the map (catalog and pins added in the app) and the atolls' names. API.md § GET /api/v1/sites. */
export async function GET() {
  return apiHandler(async () => {
    const sites = await listSites();
    const store = readStore();
    return apiJson(apiSites(sites, readCatalog().atolls, rimForAtoll, adderNicknames(store), wikiOf(store, (id) => siteRecord(store, id))));
  });
}

/**
 * Adds a dive site at a pin, as the web map's "Add a site" form: name, and optionally the kind of site, depths, how to
 * dive it and the adder's rating. Photos follow one by one (POST /api/v1/sites/{id}/photos). Answers 201 with the
 * site. API.md § POST /api/v1/sites.
 */
export async function POST(request: Request) {
  return apiHandler(async () => {
    const denied = apiNeedsToken(request);
    if (denied) return denied;
    const body = await apiJsonBody(request);
    if (body instanceof Response) return body;
    const result = await submitSite({
      name: body.name as string,
      lat: body.lat as number,
      lon: body.lon as number,
      diverSiteType: body.diverSiteType,
      diveTopM: body.diveTopM,
      diveMaxM: body.diveMaxM,
      howToDive: body.howToDive,
      rating: body.rating,
    });
    if (!result.ok) {
      if (result.error === SIGN_IN_FIRST) return apiError(401, "unauthorized", "Sign in again.");
      return apiError(400, "bad_request", result.error);
    }
    // As GET /api/v1/sites/{id} reads it: with the forecast's site type, which the pin's place sets.
    const site = (await getSite(result.site.id)) ?? result.site;
    return apiSiteSaved(site, atollNameOf(readCatalog().atolls, site.atollId), 201, adderNicknames(readStore())(site));
  });
}
