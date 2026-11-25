import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EditReviewActions } from "@/components/EditReviewActions";
import { ModerationActions } from "@/components/ModerationActions";
import { ModerationActivity } from "@/components/ModerationActivity";
import { ModerationPhotos } from "@/components/ModerationPhotos";
import { StoreReviewerChip } from "@/components/StoreReviewerChip";
import { TextDiff } from "@/components/TextDiff";
import { readActivityFilter } from "@/lib/activity";
import { listOpenFlags, listRecentActivity } from "@/lib/moderation-actions";
import { listPendingEdits } from "@/lib/wiki-actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Moderation · 50Bar", robots: { index: false, follow: false } };

/**
 * For moderators (MODERATOR_EMAILS): open content reports, one card per reported thing, then divers' site edits waiting
 * for review (lib/site-wiki.ts), then everything divers did in the last 30 days (lib/activity.ts). Anyone else gets a 404.
 */
export default async function ModerationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const filter = readActivityFilter(params.show);
  const page = typeof params.page === "string" ? Number.parseInt(params.page, 10) || 1 : 1;
  const [flags, activity, edits] = await Promise.all([listOpenFlags(), listRecentActivity(filter, page), listPendingEdits()]);
  if (!flags || !activity || !edits) notFound();

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-3xl min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-8 sm:py-8">
      <header className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foam">Moderation</h1>
        <p className="text-sm text-foam/75">
          {flags.length ? `${flags.length} open report${flags.length === 1 ? "" : "s"}, oldest first.` : "No open reports."}{" "}
          {edits.length ? (
            <a href="#site-edits" className="underline decoration-incoming underline-offset-4">
              {edits.length} site edit{edits.length === 1 ? "" : "s"} to review.
            </a>
          ) : (
            "No site edits to review."
          )}{" "}
          Rules:{" "}
          <Link href="/terms" className="underline decoration-incoming underline-offset-4">
            /terms
          </Link>
          .
        </p>
      </header>
      {flags.map((flag) => (
        <article key={flag.id} className="flex min-w-0 flex-col gap-2 surface p-4 sm:p-5">
          <p className="text-sm text-foam">
            <strong>{flag.reasonLabel}</strong> · {flag.kind === "review" ? "Review" : flag.kind === "site" ? "Added site" : flag.kind === "text" ? "Site text" : "Diver profile"}
            {flag.alsoReported ? ` · ${flag.alsoReported + 1} reports` : ""} · {flag.createdAt.slice(0, 16).replace("T", " ")} UTC
            {flag.reporter ? ` · by ${flag.reporter}` : ""}
          </p>
          {flag.note ? <p className="text-sm italic text-foam/80">“{flag.note}”</p> : null}
          {flag.diver ? (
            <p className="text-sm text-foam/85">
              Diver:{" "}
              {flag.diver.storeReview ? (
                <>
                  {flag.diver.nickname} <StoreReviewerChip />
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
          {flag.texts.map((item) => (
            <p key={item.label} className="text-sm whitespace-pre-line text-foam/85">
              <span className="font-medium">{item.label}:</span> {item.text}
            </p>
          ))}
          {flag.kind === "text" && flag.texts.length === 0 ? (
            <p className="text-sm text-foam/70">None of this diver&apos;s text is live on the site any more.</p>
          ) : null}
          <ModerationPhotos urls={flag.photos} alt="Reported photo" />
          <ModerationActions flagId={flag.id} canBan={flag.canBan} />
        </article>
      ))}
      {edits.length ? (
        <section id="site-edits" className="flex min-w-0 scroll-mt-4 flex-col gap-3" aria-labelledby="site-edits-heading">
          <h2 id="site-edits-heading" className="text-lg font-semibold text-foam">
            Site edits to review
          </h2>
          {edits.map((edit) => (
            <article key={edit.id} className="flex min-w-0 flex-col gap-3 surface p-4 sm:p-5">
              <p className="text-sm text-foam">
                <Link href={`/sites/${edit.site.id}#about`} className="font-medium underline decoration-incoming underline-offset-4">
                  {edit.site.name}
                </Link>{" "}
                · {edit.createdAt.slice(0, 16).replace("T", " ")} UTC · by{" "}
                {edit.diver ? (
                  edit.diver.storeReview ? (
                    <>
                      {edit.diver.nickname} <StoreReviewerChip />
                    </>
                  ) : (
                    <Link href={`/divers/${edit.diver.userId}`} className="underline decoration-incoming underline-offset-4">
                      {edit.diver.nickname}
                    </Link>
                  )
                ) : (
                  "a deleted account"
                )}
              </p>
              {edit.note ? <p className="text-sm italic text-foam/80">“{edit.note}”</p> : null}
              {edit.stale.length ? (
                <p className="text-sm text-outgoing">
                  {edit.stale.join(" and ")} changed after this diver started. The diff is against the text live now; approving
                  writes over it.
                </p>
              ) : null}
              {edit.changes.map((change) => (
                <TextDiff key={change.field} change={change} />
              ))}
              <EditReviewActions editId={edit.id} cannotApprove={edit.cannotApprove} stale={edit.stale.length > 0} />
            </article>
          ))}
        </section>
      ) : null}
      <ModerationActivity view={activity} filter={filter} />
    </main>
  );
}
