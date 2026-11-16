import { getBoatRoute } from "@/lib/actions";
import { apiBoatRoute, apiError, apiHandler, apiJson } from "@/lib/api-v1";
import { ROUTE_BAD_DESTINATION, ROUTE_BAD_POSITION, ROUTE_OUTSIDE } from "@/lib/boat-route-limits";

/** getBoatRoute's refusals in words a diver can act on. */
const REFUSED: Record<string, string> = {
  [ROUTE_BAD_POSITION]: "Give the boat's position as from=lat,lon.",
  [ROUTE_OUTSIDE]: "Routes start in the Maldives.",
  [ROUTE_BAD_DESTINATION]: "Routes go to a dive site or a point in the Maldives.",
};

/** "4.17,73.51" as numbers, or null. */
function readLatLon(value: string | null): { lat: number; lon: number } | null {
  const match = value ? /^(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/.exec(value.trim()) : null;
  return match ? { lat: Number(match[1]), lon: Number(match[2]) } : null;
}

/**
 * A boat route from the phone's position (`from=lat,lon`) to a site or a point (`to=<site id>` or `to=lat,lon`),
 * round the islands and reef, with the forecast current along it: what the web's Navigate panel asks getBoatRoute for.
 * Never cached: it is about one position and the current changes by the hour. API.md § GET /api/v1/boat-route.
 */
export async function GET(request: Request) {
  return apiHandler(async () => {
    const params = new URL(request.url).searchParams;
    const from = readLatLon(params.get("from"));
    const to = params.get("to")?.trim() ?? "";
    if (!from) return apiError(400, "bad_request", "Give the boat's position as from=lat,lon.");
    if (!to) return apiError(400, "bad_request", "Give the destination as to=<site id> or to=lat,lon.");
    try {
      const trip = await getBoatRoute(from, to);
      if (!trip) return apiError(404, "not_found", "No such site.");
      return apiJson(apiBoatRoute(trip), { cacheControl: "no-store" });
    } catch (error) {
      const refused = error instanceof Error ? REFUSED[error.message] : undefined;
      if (refused) return apiError(400, "bad_request", refused);
      throw error;
    }
  });
}
