import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PlanEditor } from "@/components/PlanEditor";
import { currentSession } from "@/lib/auth";
import { toMaldivesWall } from "@/lib/forecast";
import { pickerSites } from "@/lib/plan-picker";
import { ready } from "@/lib/ready";
import { signInHref } from "@/lib/sign-in";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "New dive plan · Dive current" };

export default async function NewPlanPage() {
  await ready();
  const session = await currentSession();
  if (!session) redirect(signInHref("/plans/new"));
  return (
    <main className="mx-auto flex min-h-0 w-full max-w-3xl min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-8 sm:py-8">
      <header className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foam">New dive plan</h1>
        <p className="text-sm leading-6 text-foam/80">
          Add the days and the dives, each a site and a time in the water (Maldives time). The plan page shows the forecast
          current at every dive, warns when a dive lands on a very strong or wrong-way current, and draws the boat route
          between them. Share its link with your divers.
        </p>
      </header>
      <PlanEditor sites={pickerSites()} plan={null} today={toMaldivesWall(new Date().toISOString()).slice(0, 10)} />
    </main>
  );
}
