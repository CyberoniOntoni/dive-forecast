import type { Metadata } from "next";
import Link from "next/link";
import { getMyPlans } from "@/lib/plan-actions";
import { signInHref } from "@/lib/sign-in";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Dive plans · Dive current" };

const PRIMARY =
  "inline-flex min-h-11 items-center justify-center self-start rounded-xl bg-incoming px-5 text-base font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foam";

/** The signed-in diver's dive plans, and the way to start one. */
export default async function PlansPage() {
  const plans = await getMyPlans();

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-3xl min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-8 sm:py-8">
      <header className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foam">Dive plans</h1>
        <p className="text-sm leading-6 text-foam/80">
          Plan a day or a whole trip: the dives by day, the current forecast at each dive time, and the boat route between
          them. Share the link with your divers or guests; they see it without signing in, and after each dive it asks them
          how the current really ran.
        </p>
      </header>
      {plans == null ? (
        <Link href={signInHref("/plans")} className={PRIMARY}>
          Sign in to make a plan
        </Link>
      ) : (
        <>
          <Link href="/plans/new" className={PRIMARY}>
            New plan
          </Link>
          {plans.length === 0 ? (
            <p className="text-sm text-foam/75">No plans yet.</p>
          ) : (
            <ul className="flex min-w-0 flex-col gap-2">
              {plans.map((plan) => (
                <li key={plan.id}>
                  <Link
                    href={`/plans/${plan.id}`}
                    className="flex min-w-0 flex-col gap-0.5 surface px-4 py-3 hover:bg-foam/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
                  >
                    <span className="truncate text-base font-semibold text-foam">{plan.title}</span>
                    <span className="text-sm text-foam/75">
                      {plan.span} · {plan.days} day{plan.days === 1 ? "" : "s"} · {plan.dives} dive{plan.dives === 1 ? "" : "s"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
