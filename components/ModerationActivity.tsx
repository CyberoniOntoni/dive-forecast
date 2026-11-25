import Link from "next/link";
import { ModerationActions } from "@/components/ModerationActions";
import { ModerationPhotos } from "@/components/ModerationPhotos";
import { ReportModeration } from "@/components/ReportModeration";
import { StoreReviewerChip } from "@/components/StoreReviewerChip";
import { ACTIVITY_DAYS, ACTIVITY_FILTERS, ACTIVITY_PAGE_SIZE, type ActivityFilter, type ActivityKind } from "@/lib/activity";
import type { ActivityView } from "@/lib/moderation-actions";

const KIND_LABELS: Record<ActivityKind, string> = {
  report: "Dive report",
  review: "Review",
  rating: "Rating",
  site: "New site",
  plan: "Dive plan",
  signup: "Sign-up",
  edit: "Site edit",
  flag: "Content report",
};

function pageHref(filter: ActivityFilter, page: number): string {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("show", filter);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/moderation?${query}` : "/moderation";
}

const link = "underline decoration-incoming underline-offset-4";

/** The moderators' feed of recent activity on /moderation, with filter tabs and Remove / Ban where they apply. */
export function ModerationActivity({ view, filter }: { view: ActivityView; filter: ActivityFilter }) {
  const filters = Object.entries(ACTIVITY_FILTERS) as [ActivityFilter, (typeof ACTIVITY_FILTERS)[ActivityFilter]][];
  return (
    <section aria-labelledby="activity" className="flex min-w-0 flex-col gap-3">
      <header className="flex min-w-0 flex-col gap-1">
        <h2 id="activity" className="text-xl font-semibold tracking-tight text-foam">
          Recent activity
        </h2>
        <p className="text-sm text-foam/75">
          The last {ACTIVITY_DAYS} days, newest first
          {view.pages > 1 ? `, ${ACTIVITY_PAGE_SIZE} to a page (page ${view.page} of ${view.pages})` : ""}. Times in UTC.
        </p>
      </header>
      <nav aria-label="Show" className="flex flex-wrap gap-1.5">
        {filters.map(([id, item]) => {
          const count = item.kinds.reduce((sum, kind) => sum + view.counts[kind], 0);
          return (
            <Link
              key={id}
              href={id === "all" ? "/moderation" : `/moderation?show=${id}`}
              aria-current={filter === id ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-full px-3.5 text-sm font-medium ring-1 ring-foam/15 ${
                filter === id ? "bg-foam text-ink" : "bg-foam/10 text-foam/80 hover:text-foam"
              }`}
            >
              {item.label} · {count}
            </Link>
          );
        })}
      </nav>
      {view.items.length === 0 ? <p className="text-sm text-foam/75">Nothing in the last {ACTIVITY_DAYS} days.</p> : null}
      <ol className="flex min-w-0 flex-col gap-3">
        {view.items.map((item) => (
          <li key={item.key} className="flex min-w-0 flex-col gap-1.5 surface p-4">
            <p className="text-xs tracking-wide text-foam/65 uppercase">
              {KIND_LABELS[item.kind]} · {item.at.slice(0, 16).replace("T", " ")}
              {item.openFlags ? ` · ${item.openFlags} open report${item.openFlags === 1 ? "" : "s"}` : ""}
            </p>
            <p className="text-sm text-foam">
              {item.diver?.storeReview ? (
                <span>{item.diver.nickname}</span>
              ) : item.diver ? (
                <Link href={`/divers/${item.diver.userId}`} className={link}>
                  {item.diver.nickname}
                </Link>
              ) : (
                <span className="text-foam/70">{item.noDiver}</span>
              )}
              {item.diver?.storeReview ? <StoreReviewerChip className="ml-1.5" /> : null}
              {item.diver?.banned ? <span className="ml-1.5 rounded bg-stop/25 px-1.5 py-0.5 text-xs">Banned</span> : null}
              {item.site ? (
                <>
                  {" at "}
                  <Link href={`/sites/${item.site.id}`} className={link}>
                    {item.site.name}
                  </Link>
                  {item.site.hidden ? " (hidden)" : ""}
                </>
              ) : null}
            </p>
            <p className="text-sm text-foam/85">
              {item.href ? (
                <Link href={item.href} className={link}>
                  {item.summary}
                </Link>
              ) : (
                item.summary
              )}
            </p>
            {item.text ? <p className="text-sm whitespace-pre-line text-foam/80 italic">“{item.text}”</p> : null}
            <ModerationPhotos urls={item.photos} alt={`${KIND_LABELS[item.kind]} photo`} />
            <ModerationActions target={item.removable} banTarget={item.banTarget} />
            {item.report ? (
              <ReportModeration reportId={item.report.id} hidden={item.report.hidden} userId={item.report.userId} diverVisible={item.report.diverVisible} />
            ) : null}
          </li>
        ))}
      </ol>
      {view.pages > 1 ? (
        <nav aria-label="Pages" className="flex flex-wrap gap-2">
          {view.page > 1 ? (
            <Link href={pageHref(filter, view.page - 1)} className="button-quiet px-4">
              Newer
            </Link>
          ) : null}
          {view.page < view.pages ? (
            <Link href={pageHref(filter, view.page + 1)} className="button-quiet px-4">
              Older
            </Link>
          ) : null}
        </nav>
      ) : null}
    </section>
  );
}
