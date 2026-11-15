import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PlanDay } from "@/components/PlanDay";
import { PlanShare } from "@/components/PlanShare";
import { loadPlanView } from "@/lib/plan-view";
import { canReportDive } from "@/lib/dive-plan";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const plan = await loadPlanView(id);
  // Shared by link only: search engines leave it out.
  return {
    title: plan ? `${plan.title} · Dive plan` : "Plan not found · Dive current",
    robots: { index: false, follow: false },
    ...(plan ? { description: `Dive plan, ${plan.span}: dives with the forecast current at each dive time and the boat route between them.` } : {}),
  };
}

/** A dive plan, read only, for everyone with the link; its owner also gets Edit. */
export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plan = await loadPlanView(id);
  if (!plan) notFound();
  const reportable = plan.days.some((day) => day.stops.some((stop) => stop.reportHref));
  const anyAhead = plan.days.some((day) => day.stops.some((stop) => !canReportDive(day.date, stop.time, plan.nowWall)));

  return (
    <main className="plan-page mx-auto flex min-h-0 w-full max-w-3xl min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-8 sm:py-8">
      <header className="flex min-w-0 flex-col gap-2">
        <p className="text-sm font-medium uppercase tracking-wide text-incoming">Dive plan · {plan.span}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-foam sm:text-3xl">{plan.title}</h1>
        <p className="text-sm text-foam/75">
          {plan.ownerNickname ? (
            <>
              By{" "}
              <Link href={`/divers/${encodeURIComponent(plan.ownerId)}`} className="font-medium text-foam underline decoration-incoming/60 underline-offset-4">
                {plan.ownerNickname}
              </Link>
              {" · "}
            </>
          ) : null}
          Boat at {plan.boatSpeedKn} kn · Times are Maldives time (UTC+5)
        </p>
        {plan.notes ? <p className="whitespace-pre-line text-base leading-7 text-foam/90">{plan.notes}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <PlanShare title={plan.title} path={`/plans/${plan.id}`} />
          {plan.isOwner ? (
            <Link
              href={`/plans/${plan.id}/edit`}
              className="button-quiet justify-center px-4 print:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
            >
              Edit plan
            </Link>
          ) : null}
        </div>
      </header>
      {reportable ? (
        <aside className="surface flex flex-col gap-1 p-4 print:hidden">
          <h2 className="text-base font-semibold text-foam">After the dive</h2>
          <p className="text-sm leading-6 text-foam/85">
            Tell the next divers how the current really ran: one tap on each dive below. Every report sharpens the forecast
            at that site.
          </p>
        </aside>
      ) : null}
      {plan.days.map((day, index) => (
        <PlanDay key={day.date} planId={plan.id} index={index} day={day} boatSpeedKn={plan.boatSpeedKn} />
      ))}
      {anyAhead ? (
        <p className="text-xs leading-5 text-foam/65">
          The current at each dive is this app&apos;s forecast from the tide, the monsoon drift and divers&apos; reports, read
          a week ahead at most. It is a guide, not a guarantee: check the water before you drop in. Boat routes keep to
          satellite outlines of islands and reef, not a chart, and leave out the current.
        </p>
      ) : null}
    </main>
  );
}
