import { apiHandler, apiJson, apiPlanSites } from "@/lib/api-v1";
import { toMaldivesWall } from "@/lib/forecast";
import { pickerSites } from "@/lib/plan-picker";
import { ready } from "@/lib/ready";

/**
 * Every site the plan editor can pick, by name, with whether it is a channel (the only dives that take a wanted way),
 * and the Maldives date a new plan starts on. API.md § GET /api/v1/plan-sites.
 */
export async function GET() {
  return apiHandler(async () => {
    await ready();
    const today = toMaldivesWall(new Date().toISOString()).slice(0, 10);
    return apiJson(apiPlanSites(pickerSites(), today), { cacheControl: "public, max-age=300" });
  });
}
