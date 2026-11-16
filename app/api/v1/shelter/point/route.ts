import { getShelterPoint } from "@/lib/actions";
import { apiError, apiHandler, apiJson, apiShelterPoint } from "@/lib/api-v1";
import { readPointDestination } from "@/lib/point-destination";
import { WALL_HOUR } from "@/lib/shelter-limits";

/**
 * The sea state at one tapped spot of the sheltered-water layer (`at=lat,lon`) at `time`, with the words the web
 * map's popup shows. API.md § GET /api/v1/shelter/point.
 */
export async function GET(request: Request) {
  return apiHandler(async () => {
    const params = new URL(request.url).searchParams;
    const at = readPointDestination(params.get("at")?.trim() ?? "");
    if (!at) return apiError(400, "bad_request", "Give the spot as at=lat,lon.");
    const time = params.get("time") ?? "";
    if (!WALL_HOUR.test(time)) return apiError(400, "bad_request", "Give the hour as time=YYYY-MM-DDTHH:00.");
    return apiJson(apiShelterPoint(time, await getShelterPoint(at.lat, at.lon, time)));
  });
}
