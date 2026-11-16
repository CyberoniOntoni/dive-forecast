import { apiError, apiHandler, apiJson, apiPlanLegs } from "@/lib/api-v1";
import { getPlanDayLegs } from "@/lib/plan-actions";
import { findPlan, listMergedSites } from "@/lib/store";

/**
 * The boat legs between one plan day's dives (no current), with leave-by times, as the plan page shows them. Anyone with
 * the plan's id reads them. API.md § GET /api/v1/plans/{id}/days/{day}/legs.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string; day: string }> }) {
  return apiHandler(async () => {
    const { id, day } = await context.params;
    const dayIndex = /^\d{1,2}$/.test(day) ? Number(day) : -1;
    const legs = await getPlanDayLegs(id, dayIndex);
    const plan = legs ? findPlan(id) : null;
    if (!legs || !plan) return apiError(404, "not_found", "No such plan day.");
    // The dives the legs join: as getPlanDayLegs counts them, a site removed since the plan was saved drops out.
    const known = new Set(listMergedSites().map((site) => site.id));
    const times = plan.days[dayIndex].stops.filter((stop) => known.has(stop.siteId)).map((stop) => stop.time);
    return apiJson(apiPlanLegs(id, dayIndex, legs, times, plan.boatSpeedKn), { cacheControl: "public, max-age=60" });
  });
}
