import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RevertButton } from "@/components/EditReviewActions";
import { TextDiff } from "@/components/TextDiff";
import { WIKI_LABELS } from "@/lib/site-wiki-limits";
import { getSiteHistory } from "@/lib/wiki-actions";
import type { WikiField } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const history = await getSiteHistory(id);
  return { title: history ? `${history.siteName}: history · 50Bar` : "Site not found · 50Bar", robots: { index: false, follow: true } };
}

const link = "underline decoration-incoming underline-offset-4";

/**
 * Every approved edit of a site's description and how to dive it, newest first, each with what it changed and who
 * wrote it. A moderator can take back the live one (vandalism that got through).
 */
export default async function SiteHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const history = await getSiteHistory(id);
  if (!history) notFound();
  const fields = Object.keys(history.original) as WikiField[];
  const startedWith = fields.filter((field) => history.original[field]);

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-3xl min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-8 sm:py-8">
      <nav aria-label="Site">
        <Link href={`/sites/${history.siteId}#about`} className={`text-sm text-foam/80 ${link}`}>
          Back to {history.siteName}
        </Link>
      </nav>
      <header className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foam">History of {history.siteName}</h1>
        <p className="text-sm text-foam/75">
          Divers write these texts together; a moderator reads every edit before it shows.{" "}
          {history.revisions.length === 0 ? "No edits yet." : null}
        </p>
      </header>
      {history.revisions.map((revision) => (
        <article key={revision.id} className="flex min-w-0 flex-col gap-3 surface p-4 sm:p-5">
          <p className="text-sm text-foam">
            {revision.diver ? (
              <Link href={`/divers/${revision.diver.userId}`} className={`font-medium ${link}`}>
                {revision.diver.nickname}
              </Link>
            ) : (
              <span className="font-medium">A former diver</span>
            )}{" "}
            · {revision.at.slice(0, 16).replace("T", " ")} UTC{revision.reverted ? " · taken back by a moderator" : ""}
          </p>
          <div className={`flex min-w-0 flex-col gap-3 ${revision.reverted ? "opacity-60" : ""}`}>
            {revision.changes.map((change) => (
              <TextDiff key={change.field} change={change} />
            ))}
          </div>
          {revision.canRevert ? <RevertButton editId={revision.id} /> : null}
        </article>
      ))}
      {startedWith.length > 0 ? (
        <p className="text-sm text-foam/70">
          Before any edit: {startedWith.map((field) => WIKI_LABELS[field]).join(" and ")} from the site&apos;s first entry.
        </p>
      ) : null}
    </main>
  );
}
