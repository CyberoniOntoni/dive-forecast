import { getShelter } from "@/lib/actions";
import { apiError, apiHandler, apiJson, apiShelter } from "@/lib/api-v1";
import { SHELTER_MAX_VIEW_DEG, WALL_HOUR } from "@/lib/shelter-limits";

/**
 * The sheltered-water layer for a map view (`south`, `west`, `north`, `east` in degrees), at `time` (a Maldives wall
 * hour, `YYYY-MM-DDTHH:00`) or the current hour: what the web map's layer asks getShelter for. API.md § GET
 * /api/v1/shelter.
 */
export async function GET(request: Request) {
  return apiHandler(async () => {
    const params = new URL(request.url).searchParams;
    // Number("") is 0, so an empty value is read as missing, not as the equator or the meridian.
    const [south, west, north, east] = ["south", "west", "north", "east"].map((name) => {
      const raw = params.get(name)?.trim();
      return raw ? Number(raw) : Number.NaN;
    });
    const finite = [south, west, north, east].every(Number.isFinite);
    if (!finite || south >= north || west >= east || Math.abs(south) > 90 || Math.abs(north) > 90 || Math.abs(west) > 180 || Math.abs(east) > 180) {
      return apiError(400, "bad_request", "Give the view as south, west, north and east in degrees.");
    }
    // The web map asks only from zoom 8; a wider view would load the waves for every atoll at once.
    if (north - south > SHELTER_MAX_VIEW_DEG || east - west > SHELTER_MAX_VIEW_DEG) {
      return apiError(400, "bad_request", "Zoom in on an atoll to see it.");
    }
    const time = params.get("time") ?? undefined;
    if (time !== undefined && !WALL_HOUR.test(time)) return apiError(400, "bad_request", "Give the hour as time=YYYY-MM-DDTHH:00.");
    return apiJson(apiShelter(await getShelter({ south, west, north, east }, time)));
  });
}
