"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  addReviewPhoto,
  getSiteReviews,
  removeMyRating,
  removeReviewPhoto,
  saveReview,
  submitRating,
  type ReviewActionResult,
  type SiteReview,
  type SiteReviews as Reviews,
} from "@/lib/actions";
import { POINTS } from "@/lib/points-rules";
import { REVIEW_MAX } from "@/lib/site-details";
import { MAX_PHOTOS_PER_SITE } from "@/lib/site-photos-limits";
import { signInHref } from "@/lib/sign-in";
import { PhotoPicker, uploadPhotos, type PickedPhoto } from "./PhotoPicker";
import { ScoreButtons } from "./ScoreButtons";

/** "4.2 from 5 divers". */
function summaryLine(summary: Reviews["summary"]): string {
  if (summary.average == null) return "No ratings yet";
  return `${summary.average} from ${summary.count} ${summary.count === 1 ? "diver" : "divers"}`;
}

/** "9 Nov 2026", in Maldives time on the server and in the browser alike. */
function reviewDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { timeZone: "Indian/Maldives", day: "numeric", month: "short", year: "numeric" });
}

const textareaClass =
  "min-h-28 w-full rounded-xl border border-foam/20 bg-ink px-3 py-2 text-sm leading-6 text-foam placeholder:text-foam/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming";
const primaryButton =
  "min-h-11 rounded-xl bg-incoming px-4 text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foam disabled:opacity-50";
const quietButton =
  "button-quiet justify-center px-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming disabled:opacity-50";

/**
 * The site page's ratings and reviews: the average, the signed-in diver's own score, written review and photos (each
 * can be changed or removed), and other divers' reviews. Reviews and photos are the divers' own; the forecast never
 * reads them.
 */
export function SiteReviews({
  siteId,
  siteName,
  initial,
  signedIn,
}: {
  siteId: string;
  siteName: string;
  initial: Reviews;
  signedIn: boolean;
}) {
  const [shown, setShown] = useState(initial);
  const [draft, setDraft] = useState(initial.mine?.review ?? "");
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const mine = shown.mine;
  const room = MAX_PHOTOS_PER_SITE - (mine?.photos.length ?? 0);
  const textChanged = draft.trim() !== (mine?.review ?? "");

  function run(action: () => Promise<ReviewActionResult>, done?: string, after?: (reviews: Reviews) => void) {
    setError(null);
    setNote(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setShown(result.reviews);
        after?.(result.reviews);
        if (done) setNote(done);
      } catch {
        setError("Could not save that. Check your connection and try again.");
      }
    });
  }

  function choose(score: number) {
    run(() => submitRating(siteId, score), mine ? "Rating changed." : "Rating saved.");
  }

  function sendReview() {
    run(() => saveReview(siteId, draft), draft.trim() ? "Review saved." : "Review cleared.", (reviews) =>
      setDraft(reviews.mine?.review ?? ""),
    );
  }

  function sendPhotos() {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const sent = await uploadPhotos(
        siteId,
        photos,
        (done) => setProgress(`Sending photo ${done + 1} of ${photos.length}…`),
        addReviewPhoto,
      );
      setProgress(null);
      photos.forEach((photo) => URL.revokeObjectURL(photo.preview));
      setPhotos([]);
      if (sent.error) setError(sent.error);
      else setNote(sent.saved === 1 ? "Photo added." : `${sent.saved} photos added.`);
      try {
        setShown(await getSiteReviews(siteId));
      } catch {
        // The photos were sent; the page shows them on its next load.
      }
    });
  }

  function dropPhoto(photoId: string) {
    run(() => removeReviewPhoto(siteId, photoId), "Photo removed.");
  }

  function removeAll() {
    setConfirmRemove(false);
    run(() => removeMyRating(siteId), "Your rating was removed.", () => {
      setDraft("");
      photos.forEach((photo) => URL.revokeObjectURL(photo.preview));
      setPhotos([]);
    });
  }

  return (
    <section className="flex min-w-0 flex-col gap-4 surface p-4 sm:p-5" aria-labelledby="reviews-heading">
      <div className="flex flex-col gap-1">
        <h2 id="reviews-heading" className="text-base font-semibold text-foam">
          Ratings and reviews
        </h2>
        <p className="text-sm text-foam/80">{summaryLine(shown.summary)}. Reviews do not change the current.</p>
      </div>

      {signedIn ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-foam" id="my-rating-label">
            Your rating {mine?.score ?? "—"}
            {mine == null ? <span className="text-foam/70"> · rate it for {POINTS.rating} points</span> : null}
          </p>
          <ScoreButtons
            selected={mine?.score ?? null}
            onPick={choose}
            disabled={pending}
            label="Rate this dive site from 1 to 5"
          />
          {mine ? (
            <>
              <label className="flex flex-col gap-2 text-sm font-medium text-foam">
                <span>
                  Your review <span className="font-normal text-foam/70">· optional, up to {REVIEW_MAX} characters</span>
                </span>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  maxLength={REVIEW_MAX}
                  disabled={pending}
                  placeholder="What was the dive like? Marine life, visibility, best time, things to know."
                  className={textareaClass}
                />
              </label>
              {textChanged ? (
                <button type="button" onClick={sendReview} disabled={pending} className={`${primaryButton} sm:self-start`}>
                  {draft.trim() ? (mine.review ? "Save changes" : "Save review") : "Clear review"}
                </button>
              ) : null}

              {mine.photos.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-foam">Your photos</span>
                  <ul className="grid grid-cols-3 gap-2">
                    {mine.photos.map((photo, index) => (
                      <li key={photo.id} className="relative aspect-square overflow-hidden rounded-lg bg-foam/10">
                        {/* eslint-disable-next-line @next/next/no-img-element -- already sized in the browser before upload */}
                        <img src={photo.url} alt={`Your photo ${index + 1}`} loading="lazy" className="h-full w-full object-cover" />
                        <button
                          type="button"
                          onClick={() => dropPhoto(photo.id)}
                          disabled={pending}
                          aria-label={`Delete your photo ${index + 1}`}
                          className="absolute top-1 right-1 flex h-8 w-8 items-center justify-center rounded-full bg-ink/85 text-base leading-none text-foam focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {room > 0 ? (
                <PhotoPicker
                  photos={photos}
                  onChange={setPhotos}
                  max={room}
                  disabled={pending}
                  label={mine.photos.length ? "Add more photos" : "Add your photos"}
                />
              ) : null}
              {photos.length > 0 ? (
                <button type="button" onClick={sendPhotos} disabled={pending} className={`${primaryButton} sm:self-start`}>
                  {pending && progress ? progress : photos.length === 1 ? "Save photo" : `Save ${photos.length} photos`}
                </button>
              ) : null}

              {confirmRemove ? (
                <div className="flex flex-col gap-2 rounded-xl border border-outgoing/50 p-3" role="group" aria-label="Remove your rating">
                  <p className="text-sm text-foam">
                    Remove your rating{mine.review ? ", review" : ""}
                    {mine.photos.length ? " and photos" : ""}? You lose its {POINTS.rating} points; rating the site again
                    gives them back.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={removeAll}
                      disabled={pending}
                      className="min-h-11 rounded-xl bg-outgoing px-4 text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foam disabled:opacity-50"
                    >
                      Remove
                    </button>
                    <button type="button" onClick={() => setConfirmRemove(false)} disabled={pending} className={quietButton}>
                      Keep it
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmRemove(true)}
                  disabled={pending}
                  className={`${quietButton} sm:self-start`}
                >
                  Remove my rating
                </button>
              )}
            </>
          ) : (
            <p className="text-sm text-foam/70">Rate it, then you can write a review and add photos.</p>
          )}
        </div>
      ) : (
        <Link href={signInHref(`/sites/${siteId}`)} className={`${quietButton} sm:self-start`}>
          Sign in to rate and review
        </Link>
      )}

      {error ? (
        <p role="alert" className="text-sm text-outgoing">
          {error}
        </p>
      ) : null}
      {note && !error ? (
        <p role="status" className="text-sm text-foam/80">
          {note}
        </p>
      ) : null}

      {shown.reviews.length > 0 ? (
        <ul className="flex flex-col gap-4 border-t border-foam/10 pt-4" aria-label="Reviews from other divers">
          {shown.reviews.map((review) => (
            <ReviewItem key={review.userId} review={review} siteName={siteName} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function ReviewItem({ review, siteName }: { review: SiteReview; siteName: string }) {
  return (
    <li className="flex min-w-0 flex-col gap-2">
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-foam">
        <Link
          href={`/divers/${review.userId}`}
          className="font-medium underline decoration-incoming underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
        >
          {review.nickname}
        </Link>
        <span aria-label={`rated ${review.score} of 5`}>{review.score}/5</span>
        <span className="text-xs text-foam/60">{reviewDate(review.updatedAt)}</span>
      </p>
      {review.review ? (
        <p className="text-sm leading-6 break-words whitespace-pre-line text-foam/90">{review.review}</p>
      ) : null}
      {review.photos.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2" aria-label={`Photos by ${review.nickname}`}>
          {review.photos.map((photo, index) => (
            <li key={photo.id} className="aspect-square overflow-hidden rounded-lg bg-foam/10">
              <a
                href={photo.url}
                target="_blank"
                rel="noopener"
                className="block h-full w-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- already sized in the browser before upload */}
                <img
                  src={photo.url}
                  alt={`${siteName}, photo ${index + 1} by ${review.nickname}`}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
