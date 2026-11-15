import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PlanEditor } from "@/components/PlanEditor";
import { currentSession } from "@/lib/auth";
import { toMaldivesWall } from "@/lib/forecast";
import { getPlanForEdit } from "@/lib/plan-actions";
import { pickerSites } from "@/lib/plan-picker";
import { ready } from "@/lib/ready";
import { signInHref } from "@/lib/sign-in";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Edit dive plan · Dive current", robots: { index: false, follow: false } };

export default async function EditPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await ready();
  const session = await currentSession();
  if (!session) redirect(signInHref(`/plans/${id}/edit`));
  const plan = await getPlanForEdit(id);
  if (!plan) notFound();
  return (
    <main className="mx-auto flex min-h-0 w-full max-w-3xl min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-8 sm:py-8">
      <header className="flex min-w-0 flex-col gap-1">
        <Link href={`/plans/${plan.id}`} className="text-sm text-foam/80 underline decoration-incoming/60 underline-offset-4">
          Back to the plan
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-foam">Edit {plan.title}</h1>
      </header>
      <PlanEditor sites={pickerSites()} plan={plan} today={toMaldivesWall(new Date().toISOString()).slice(0, 10)} />
    </main>
  );
}
