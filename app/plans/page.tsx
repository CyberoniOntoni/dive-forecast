import type { Metadata } from "next";
import Link from "next/link";
import { planSize } from "@/lib/dive-plan";
import { toMaldivesWall } from "@/lib/forecast";
import { getMyPlans, type PlanSummary } from "@/lib/plan-actions";
import { signInHref } from "@/lib/sign-in";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Dive plans · 50Bar" };

const PRIMARY =
  "inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-xl bg-incoming px-5 text-base font-semibold text-[#07151d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foam";

const WHAT_YOU_GET = [
  ["Current at every dive", "the forecast at each dive time, with a red note when it lands on a very strong or wrong-way slot, and a better time that day"],
  ["Boat route", "a map of each day, the route round the reef between dives, and the time at your boat's speed"],
  ["One link for the group", "guests open it without an account, and after each dive it asks them how the current really ran"],
] as const;

/** The signed-in diver's dive plans, and the way to start one. */
export default async function PlansPage() {
  const plans = await getMyPlans();
  const today = toMaldivesWall(new Date().toISOString()).slice(0, 10);
  const groups: { label: string; plans: PlanSummary[] }[] = [
    { label: "On now", plans: (plans ?? []).filter((plan) => plan.first <= today && today <= plan.last) },
    { label: "Coming up", plans: (plans ?? []).filter((plan) => plan.first > today).sort((a, b) => a.first.localeCompare(b.first)) },
    { label: "Past", plans: (plans ?? []).filter((plan) => plan.last < today) },
  ];

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-3xl min-w-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-5 sm:px-8 sm:py-8">
      <header className="flex min-w-0 flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foam">Dive plans</h1>
        <p className="text-sm leading-6 text-foam/80">
          Plan a day or a whole trip and share it with your divers or guests.
        </p>
      </header>

      {plans == null || plans.length === 0 ? (
        <section className="flex min-w-0 flex-col gap-4 surface p-4 sm:p-5">
          <ul className="flex min-w-0 flex-col gap-3">
            {WHAT_YOU_GET.map(([title, text]) => (
              <li key={title} className="flex min-w-0 gap-3">
                <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-incoming" />
                <p className="text-sm leading-6 text-foam/85">
                  <span className="font-semibold text-foam">{title}:</span> {text}.
                </p>
              </li>
            ))}
          </ul>
          <Link href={plans == null ? signInHref("/plans/new") : "/plans/new"} className={PRIMARY}>
            {plans == null ? "Sign in to make a plan" : "Make your first plan"}
          </Link>
        </section>
      ) : (
        <>
          <Link href="/plans/new" className={PRIMARY}>
            <span aria-hidden="true" className="text-lg leading-none">+</span> New plan
          </Link>
          {groups
            .filter((group) => group.plans.length > 0)
            .map((group) => (
              <section key={group.label} className="flex min-w-0 flex-col gap-2" aria-label={group.label}>
                <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-foam/60">{group.label}</h2>
                <ul className="flex min-w-0 flex-col gap-2">
                  {group.plans.map((plan) => (
                    <li key={plan.id}>
                      <Link
                        href={`/plans/${plan.id}`}
                        className={`flex min-w-0 items-center gap-3 surface px-4 py-3 hover:bg-foam/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming ${
                          group.label === "Past" ? "opacity-75" : ""
                        } ${group.label === "On now" ? "ring-2 ring-incoming/50" : ""}`}
                      >
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate text-base font-semibold text-foam">{plan.title}</span>
                          <span className="text-sm text-foam/70">
                            {plan.span} · {planSize(plan.days, plan.dives)}
                          </span>
                        </span>
                        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" className="shrink-0 text-foam/50" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 5l7 7-7 7" />
                        </svg>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </>
      )}
    </main>
  );
}
