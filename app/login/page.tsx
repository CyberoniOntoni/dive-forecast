import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/SignInForm";
import { currentSession } from "@/lib/auth";
import { localPath } from "@/lib/sign-in";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sign in · Dive current" };

function text(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = localPath(params.next);
  if (await currentSession()) redirect(next);

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-md min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-6 sm:py-10">
      <SignInForm initialEmail={text(params.email)} initialCode={text(params.code)} next={next} />
    </main>
  );
}
