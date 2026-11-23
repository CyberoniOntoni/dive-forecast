import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ModerationActions } from "@/components/ModerationActions";
import { ModerationActivity } from "@/components/ModerationActivity";
import { ModerationPhotos } from "@/components/ModerationPhotos";
import { readActivityFilter } from "@/lib/activity";
import { listOpenFlags, listRecentActivity } from "@/lib/moderation-actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Moderation · 50Bar", robots: { index: false, follow: false } };

/**
 * For moderators (MODERATOR_EMAILS): open content reports, one card per reported thing, then everything divers did in
 * the last 30 days (lib/activity.ts). Anyone else gets a 404.
 */
export default async function ModerationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const filter = readActivityFilter(params.show);
  const page = typeof params.page === "string" ? Number.parseInt(params.page, 10) || 1 : 1;
  const [flags, activity] = await Promise.all([listOpenFlags(), listRecentActivity(filter, page)]);
  if (!flags || !activity) notFound();

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-3xl min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-8 sm:py-8">
      <header className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foam">Moderation</h1>
        <p className="text-sm text-foam/75">
          {flags.length ? `${flags.length} open report${flags.length === 1 ? "" : "s"}, oldest first.` : "No open reports."} Rules:{" "}
          <Link href="/terms" className="underline decoration-incoming underline-offset-4">
            /terms
          </Link>
          .
        </p>
      </header>
      {flags.map((flag) => (
        <article key={flag.id} className="flex min-w-0 flex-col gap-2 surface p-4 sm:p-5">
          <p className="text-sm text-foam">
            <strong>{flag.reasonLabel}</strong> · {flag.kind === "review" ? "Review" : flag.kind === "site" ? "Added site" : "Diver profile"}
            {flag.alsoReported ? ` · ${flag.alsoReported + 1} reports` : ""} · {flag.createdAt.slice(0, 16).replace("T", " ")} UTC
            {flag.reporter ? ` · by ${flag.reporter}` : ""}
          </p>
          {flag.note ? <p className="text-sm italic text-foam/80">“{flag.note}”</p> : null}
          {flag.diver ? (
            <p className="text-sm text-foam/85">
              Diver:{" "}
              {flag.diver.storeReview ? (
                <>
                  {flag.diver.nickname} <span className="rounded bg-foam/15 px-1.5 py-0.5 text-xs">Store reviewer: hidden from others</span>
                </>
              ) : (
                <Link href={`/divers/${flag.diver.userId}`} className="underline decoration-incoming underline-offset-4">
                  {flag.diver.nickname}
                </Link>
              )}
              {flag.diver.banned ? " (banned)" : ""}
              {flag.kind === "diver" && flag.diver.about ? <span className="block whitespace-pre-line">About: {flag.diver.about}</span> : null}
            </p>
          ) : null}
          {flag.site ? (
            <p className="text-sm text-foam/85">
              Site:{" "}
              <Link href={`/sites/${flag.site.id}`} className="underline decoration-incoming underline-offset-4">
                {flag.site.name}
              </Link>
              {flag.site.hidden ? " (hidden)" : ""}
              {flag.kind === "site" && flag.site.howToDive ? <span className="block whitespace-pre-line">Notes: {flag.site.howToDive}</span> : null}
            </p>
          ) : null}
          {flag.review ? (
            <p className="text-sm whitespace-pre-line text-foam/85">
              {flag.review.score}/5{flag.review.text ? `: ${flag.review.text}` : ""}
            </p>
          ) : null}
          <ModerationPhotos urls={flag.photos} alt="Reported photo" />
          <ModerationActions flagId={flag.id} canBan={flag.canBan} />
        </article>
      ))}
      <ModerationActivity view={activity} filter={filter} />
    </main>
  );
}
