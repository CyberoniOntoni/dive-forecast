"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { rateSite, type RatingSummary } from "@/lib/actions";
import { POINTS } from "@/lib/points-rules";
import { signInHref } from "@/lib/sign-in";

const SCORES = [1, 2, 3, 4, 5] as const;

function scoreButtonClass(selected: boolean): string {
  const tone = selected ? "border-foam bg-foam text-ink" : "border-foam/20 bg-ink text-foam";
  return `min-h-11 flex-1 rounded-xl border text-base font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming disabled:opacity-60 ${tone}`;
}

/** "4.2 from 5 divers". */
function summaryLine(summary: RatingSummary): string {
  if (summary.average == null) return "No ratings yet.";
  return `${summary.average} from ${summary.count} ${summary.count === 1 ? "diver" : "divers"}`;
}

export function RatingForm({
  siteId,
  summary,
  signedIn,
}: {
  siteId: string;
  summary: RatingSummary;
  signedIn: boolean;
}) {
  const [shown, setShown] = useState(summary);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(next: number) {
    setError(null);
    startTransition(async () => {
      try {
        setShown(await rateSite(siteId, next));
      } catch {
        setError("Could not save the rating.");
      }
    });
  }

  return (
    <section
      className="flex flex-col gap-3 surface p-4 sm:p-5"
      aria-labelledby="rating-heading"
    >
      <h2 id="rating-heading" className="text-base font-semibold text-foam">
        Site rating
      </h2>
      <p className="text-sm text-foam/80">
        {summaryLine(shown)}. Ratings do not change the current.
      </p>
      {signedIn ? (
        <>
          <p className="text-sm text-foam">
            Your rating {shown.mine ?? "—"}
            {shown.mine == null ? <span className="text-foam/70"> · rate it for {POINTS.rating} points</span> : null}
          </p>
          <div className="flex gap-2" role="group" aria-label="Rate this dive site from 1 to 5">
            {SCORES.map((value) => {
              const selected = shown.mine === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={selected}
                  disabled={pending}
                  onClick={() => choose(value)}
                  className={scoreButtonClass(selected)}
                >
                  {value}
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <Link
          href={signInHref(`/sites/${siteId}`)}
          className="button-quiet justify-center px-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming sm:self-start"
        >
          Sign in to rate
        </Link>
      )}
      {error ? (
        <p role="alert" className="text-sm text-outgoing">
          {error}
        </p>
      ) : null}
    </section>
  );
}
