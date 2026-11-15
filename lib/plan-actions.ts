"use server";

import { unstable_rethrow as rethrowIfNextError } from "next/navigation";
import { currentSession, requireSession } from "./auth";
import { planLeg } from "./boat-route-data";
import {
  diveCount,
  isPlanId,
  legMinutes,
  newPlanId,
  planDateSpan,
  PLANS_PER_DIVER_MAX,
  requirePlanInput,
} from "./dive-plan";
import { ready } from "./ready";
import { addPlanRecord, deletePlanRecord, findPlan, listMergedSites, plansForOwner, updatePlanRecord } from "./store";
import type { DivePlan } from "./types";

/**
 * Dive plans from the UI: the owner saves, changes and deletes; anyone with a plan's link reads it and its boat routes.
 * The plan page itself is put together by lib/plan-view.ts.
 */

export type PlanSummary = {
  id: string;
  title: string;
  span: string;
  /** First and last dates, "YYYY-MM-DD". */
  first: string;
  last: string;
  days: number;
  dives: number;
  updatedAt: string;
};

/** The signed-in diver's plans, newest change first; null when signed out. */
export async function getMyPlans(): Promise<PlanSummary[] | null> {
  await ready();
  const session = await currentSession();
  if (!session) return null;
  return plansForOwner(session.userId).map((plan) => ({
    id: plan.id,
    title: plan.title,
    span: planDateSpan(plan.days),
    first: plan.days[0]?.date ?? "",
    last: plan.days.at(-1)?.date ?? "",
    days: plan.days.length,
    dives: diveCount(plan),
    updatedAt: plan.updatedAt,
  }));
}

/** The plan for its editor: only its owner gets it. */
export async function getPlanForEdit(id: string): Promise<DivePlan | null> {
  await ready();
  const session = await currentSession();
  if (!session || !isPlanId(id)) return null;
  const plan = findPlan(id);
  return plan && plan.ownerId === session.userId ? plan : null;
}

export type SavePlanResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Saves the editor's plan: a new one when `id` is null, else the diver's own plan with that id. The reason comes back
 * as a value, because a production build hides a thrown action's message.
 */
export async function savePlan(id: string | null, input: unknown): Promise<SavePlanResult> {
  try {
    await ready();
    const session = await requireSession();
    if (id !== null && !isPlanId(id)) return { ok: false, error: "Unknown plan." };
    const known = new Set(listMergedSites().map((site) => site.id));
    const body = requirePlanInput(input, (siteId) => known.has(siteId));
    const now = new Date().toISOString();
    if (id === null) {
      // A new plan always gets its id here, never from the caller, so a link cannot be picked in advance.
      const plan: DivePlan = { id: newPlanId(), ownerId: session.userId, ...body, createdAt: now, updatedAt: now };
      const added = await addPlanRecord(plan, PLANS_PER_DIVER_MAX);
      if (added === "full") {
        return { ok: false, error: `You can keep up to ${PLANS_PER_DIVER_MAX} plans. Delete an old one first.` };
      }
      if (added === "taken") return { ok: false, error: "Could not save the plan. Try again." };
      return { ok: true, id: plan.id };
    }
    const plan: DivePlan = { id, ownerId: session.userId, ...body, createdAt: now, updatedAt: now };
    const updated = await updatePlanRecord(plan);
    if (updated === "missing") return { ok: false, error: "That plan is gone." };
    if (updated === "not-yours") return { ok: false, error: "Only the diver who made this plan can change it." };
    return { ok: true, id: plan.id };
  } catch (error) {
    rethrowIfNextError(error);
    return { ok: false, error: error instanceof Error && error.message ? error.message : "Could not save the plan." };
  }
}

export async function deletePlan(id: string): Promise<{ ok: boolean; error: string | null }> {
  try {
    await ready();
    const session = await requireSession();
    if (!isPlanId(id)) return { ok: false, error: "Unknown plan." };
    const removed = await deletePlanRecord(id, session.userId);
    return removed ? { ok: true, error: null } : { ok: false, error: "That plan is not yours, or it is gone." };
  } catch (error) {
    rethrowIfNextError(error);
    return { ok: false, error: error instanceof Error && error.message ? error.message : "Could not delete the plan." };
  }
}

/** One boat leg between two dives of a day: from stop `from` to stop `from + 1`. */
export type PlanLeg = {
  from: number;
  points: [number, number][];
  lengthKm: number;
  /** False when no way round the known reef was found; the points are then the straight line. */
  routed: boolean;
  /** At the plan's boat speed, with no current. */
  minutes: number;
};

/**
 * The boat routes between one day's dives, in order. Anyone with the plan's link reads them. A day of the most dives
 * plans five legs of about a tenth of a second each, so the page asks for each day on its own.
 */
export async function getPlanDayLegs(id: string, dayIndex: number): Promise<PlanLeg[] | null> {
  await ready();
  if (!isPlanId(id) || !Number.isInteger(dayIndex) || dayIndex < 0) return null;
  const plan = findPlan(id);
  const day = plan?.days[dayIndex];
  if (!plan || !day) return null;
  const sites = listMergedSites();
  const byId = new Map(sites.map((site) => [site.id, site]));
  const legs: PlanLeg[] = [];
  for (let index = 0; index + 1 < day.stops.length; index += 1) {
    const from = byId.get(day.stops[index].siteId);
    const to = byId.get(day.stops[index + 1].siteId);
    if (!from || !to) continue;
    const route = planLeg(from, to, sites);
    legs.push({
      from: index,
      points: route.points,
      lengthKm: route.lengthKm,
      routed: route.routed,
      minutes: legMinutes(route.lengthKm, plan.boatSpeedKn),
    });
  }
  return legs;
}
