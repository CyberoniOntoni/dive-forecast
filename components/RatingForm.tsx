"use client";

import { useState, useTransition } from "react";
import { rateSite } from "@/lib/actions";

const SCORES = [1, 2, 3, 4, 5] as const;

export function RatingForm({
  siteId,
  score,
}: {
  siteId: string;
  score: number | null;
}) {
  const [shownScore, setShownScore] = useState(score);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(next: number) {
    setError(null);
    startTransition(async () => {
      try {
        const saved = await rateSite(siteId, next);
        setShownScore(saved.score);
      } catch {
        setError("Could not save the rating.");
      }
    });
  }

  const averageText = shownScore == null ? "—" : shownScore.toFixed(1);
  // The store keeps one rating per site.
  const count = shownScore == null ? 0 : 1;

  return (
    <section
      className="flex flex-col gap-3 rounded-2xl border border-foam/15 bg-glass p-4 sm:p-5"
      aria-labelledby="rating-heading"
    >
      <h2 id="rating-heading" className="text-base font-semibold text-foam">
        Site rating
      </h2>
      <p className="text-sm text-foam/80">This rating does not change the current.</p>
      <p className="text-sm text-foam">
        Average {averageText} · {count} {count === 1 ? "rating" : "ratings"}
      </p>
      <div className="flex gap-2" role="group" aria-label="Rate this dive site from 1 to 5">
        {SCORES.map((value) => {
          const selected = shownScore === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={selected}
              disabled={pending}
              onClick={() => choose(value)}
              className={`min-h-11 flex-1 rounded-md border text-base font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming disabled:opacity-60 ${
                selected
                  ? "border-foam bg-foam text-ink"
                  : "border-foam/20 bg-ink text-foam"
              }`}
            >
              {value}
            </button>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-outgoing">
          {error}
        </p>
      ) : null}
    </section>
  );
}
