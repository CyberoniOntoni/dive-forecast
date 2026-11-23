import Link from "next/link";
import { ActivityModeration } from "@/components/ActivityModeration";
import { ACTIVITY_DAYS, ACTIVITY_FILTERS, ACTIVITY_MAX, type ActivityFilter, type ActivityKind } from "@/lib/activity";
import type { ActivityView } from "@/lib/moderation-actions";

const KIND_LABELS: Record<ActivityKind, string> = {
  report: "Dive report",
  review: "Review",
  rating: "Rating",
  site: "New site",
  plan: "Dive plan",
  signup: "Sign-up",
  flag: "Content report",
};

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
          The last {ACTIVITY_DAYS} days, newest first{view.total > ACTIVITY_MAX ? `, the latest ${ACTIVITY_MAX} of ${view.total}` : ""}. Times
          in UTC.
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
                <span className="text-foam/70">{item.kind === "rating" || item.kind === "review" ? "Anonymous" : "Deleted account"}</span>
              )}
              {item.diver?.storeReview ? <span className="ml-1.5 rounded bg-foam/15 px-1.5 py-0.5 text-xs">Store reviewer: hidden from others</span> : null}
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
            {item.photos.length ? (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {item.photos.map((url) => (
                  <li key={url} className="aspect-square overflow-hidden rounded-lg bg-foam/10">
                    <a href={url} target="_blank" rel="noopener" className="block h-full w-full">
                      {/* eslint-disable-next-line @next/next/no-img-element -- moderator view of user photos */}
                      <img src={url} alt={`${KIND_LABELS[item.kind]} photo`} loading="lazy" className="h-full w-full object-cover" />
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
            {item.removable ? (
              <ActivityModeration
                target={item.removable}
                canBan={Boolean(item.diver && !item.diver.banned && !item.diver.storeReview && item.diver.userId !== view.moderatorId)}
              />
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
