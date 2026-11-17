import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PlanDay } from "@/components/PlanDay";
import { PlanShare } from "@/components/PlanShare";
import { loadPlanView } from "@/lib/plan-view";
import { canReportDive, dayLabel, diveCount, planSize, warnedCount } from "@/lib/dive-plan";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const plan = await loadPlanView(id);
  // Shared by link only: search engines leave it out.
  return {
    title: plan ? `${plan.title} · Dive plan` : "Plan not found · 50bar",
    robots: { index: false, follow: false },
    ...(plan ? { description: `Dive plan, ${plan.span}: dives with the forecast current at each dive time and the boat route between them.` } : {}),
  };
}

/** A dive plan, read only, for everyone with the link; its owner also gets Edit. */
export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plan = await loadPlanView(id);
  if (!plan) notFound();
  const today = plan.nowWall.slice(0, 10);
  const reportable = plan.days.some((day) => day.stops.some((stop) => stop.reportHref));
  const anyAhead = plan.days.some((day) => day.stops.some((stop) => !canReportDive(day.date, stop.time, plan.nowWall)));
  const dives = diveCount(plan);
  const warned = plan.days.reduce((sum, day) => sum + warnedCount(day.stops), 0);

  return (
    <main className="plan-page mx-auto flex min-h-0 w-full max-w-3xl min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-10 sm:px-8">
      {/* The top padding is on the header, not the page, so the day bar sticks flush to the top edge. */}
      <header className="flex min-w-0 flex-col gap-3 pt-5 sm:pt-8">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-incoming">Dive plan · {plan.span}</p>
          <h1 className="text-2xl font-semibold tracking-tight text-balance text-foam sm:text-3xl">{plan.title}</h1>
          <p className="text-sm text-foam/70">
            {plan.ownerNickname ? (
              <>
                By{" "}
                <Link
                  href={`/divers/${encodeURIComponent(plan.ownerId)}`}
                  className="font-medium text-foam underline decoration-incoming/50 underline-offset-4"
                >
                  {plan.ownerNickname}
                </Link>
                {" · "}
              </>
            ) : null}
            {planSize(plan.days.length, dives)} · boat {plan.boatSpeedKn} kn
            · Maldives time
          </p>
        </div>
        {plan.notes ? (
          <p className="whitespace-pre-line rounded-2xl bg-foam/[0.06] px-4 py-3 text-base leading-7 text-foam/90 ring-1 ring-foam/10">
            {plan.notes}
          </p>
        ) : null}
        <PlanShare title={plan.title} path={`/plans/${plan.id}`}>
          {plan.isOwner ? (
            <Link
              href={`/plans/${plan.id}/edit`}
              className="button-quiet gap-2 justify-center px-4 print:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
              </svg>
              Edit
            </Link>
          ) : null}
        </PlanShare>
        {warned > 0 ? (
          <p className="text-sm text-stop">
            {warned === 1 ? "1 dive lands" : `${warned} dives land`} on a very strong, wrong-way or rough slot: look for the red
            notes below.
          </p>
        ) : null}
      </header>

      {plan.days.length > 1 ? (
        // One tap to any day of a long trip; stays at the top while the days scroll by.
        <nav
          aria-label="Days"
          className="sticky top-0 z-10 -mx-4 flex shrink-0 gap-1.5 overflow-x-auto bg-[color-mix(in_srgb,var(--ink)_88%,transparent)] px-4 py-2 backdrop-blur-md [scrollbar-width:none] print:hidden sm:-mx-8 sm:px-8"
        >
          {plan.days.map((day, index) => {
            const dayWarned = warnedCount(day.stops);
            const isToday = day.date === today;
            return (
              <a
                key={day.date}
                href={`#day-${day.date}`}
                className={`inline-flex min-h-11 shrink-0 flex-col justify-center rounded-xl px-3 text-left leading-tight ring-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming ${
                  isToday ? "bg-incoming/20 ring-incoming/50" : day.date < today ? "ring-foam/10 opacity-70" : "ring-foam/20"
                }`}
              >
                <span className="flex items-center gap-1.5 text-xs text-foam/70">
                  Day {index + 1}
                  {dayWarned > 0 ? <span aria-label={`${dayWarned} to check`} className="size-2 rounded-full bg-stop" /> : null}
                </span>
                <span className="text-sm font-semibold whitespace-nowrap text-foam">{isToday ? "Today" : dayLabel(day.date)}</span>
              </a>
            );
          })}
        </nav>
      ) : null}

      {reportable ? (
        <aside className="flex min-w-0 items-start gap-3 rounded-2xl bg-incoming/10 px-4 py-3 ring-1 ring-incoming/30 print:hidden">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" className="mt-0.5 shrink-0 text-incoming" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 15c2 0 2-2 4.5-2S10 15 12 15s2.5-2 4.5-2 2.5 2 4.5 2M6 9h11M14 6l3 3-3 3" />
          </svg>
          <p className="text-sm leading-6 text-foam/90">
            <span className="font-semibold text-foam">Back from a dive?</span> Tap &ldquo;Report the current&rdquo; under it and say
            how it really ran. Every report sharpens the forecast for the next divers.
          </p>
        </aside>
      ) : null}

      {plan.days.map((day, index) => (
        <PlanDay key={day.date} planId={plan.id} index={index} day={day} boatSpeedKn={plan.boatSpeedKn} today={today} />
      ))}

      {anyAhead ? (
        <p className="text-xs leading-5 text-foam/60">
          The current at each dive is this app&apos;s forecast from the tide, the monsoon drift and divers&apos; reports, read
          a week ahead at most. It is a guide, not a guarantee: check the water before you drop in. Boat routes keep to
          satellite outlines of islands and reef, not a chart, and leave out the current.
        </p>
      ) : null}
    </main>
  );
}
