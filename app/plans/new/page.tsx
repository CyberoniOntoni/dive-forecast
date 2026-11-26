import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PlanEditor } from "@/components/PlanEditor";
import { currentSession } from "@/lib/auth";
import { toMaldivesWall } from "@/lib/forecast";
import { pickerSites } from "@/lib/plan-picker";
import { ready } from "@/lib/ready";
import { signInHref } from "@/lib/sign-in";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "New dive plan · 50Bar" };

export default async function NewPlanPage() {
  await ready();
  const session = await currentSession();
  if (!session) redirect(signInHref("/plans/new"));
  return (
    <main className="mx-auto flex min-h-0 w-full max-w-3xl min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-8 sm:py-8">
      <header className="rise-in flex min-w-0 flex-col gap-1">
        <p className="eyebrow">Dive plans</p>
        <h1 className="text-2xl font-semibold tracking-tight text-foam">New dive plan</h1>
        <p className="text-sm leading-6 text-foam/80">
          Add days and dives: a site and a time in the water for each, in Maldives time. Saving gives you a link to share.
        </p>
      </header>
      <PlanEditor sites={pickerSites()} plan={null} today={toMaldivesWall(new Date().toISOString()).slice(0, 10)} />
    </main>
  );
}
