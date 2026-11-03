"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { whoAmI } from "@/lib/account-actions";
import { submitSite } from "@/lib/actions";
import { DIVER_SITE_TYPES, HOW_TO_DIVE_MAX, MAX_DIVE_DEPTH_M } from "@/lib/site-details";
import { MAX_PHOTOS_PER_SITE } from "@/lib/site-photos-limits";
import { signInHref } from "@/lib/sign-in";
import { ScoreButtons } from "./ScoreButtons";
import { PhotoPicker, uploadPhotos, type PickedPhoto } from "./PhotoPicker";

type Point = { lat: number; lon: number };

export function AddSiteForm({
  point,
  onAdded,
}: {
  point: Point | null;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [siteType, setSiteType] = useState("");
  const [top, setTop] = useState("");
  const [max, setMax] = useState("");
  const [howToDive, setHowToDive] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  // Added, but some photos did not go up: the form stays open to say so.
  const [added, setAdded] = useState<{ id: string; note: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const typeHint = DIVER_SITE_TYPES.find((option) => option.type === siteType)?.hint ?? null;
  const pinCopy = describePin(point);
  // Only signed-in divers add sites. Asked when the form opens, so the map page itself stays the same for everyone.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    whoAmI()
      .then((me) => live && setSignedIn(me != null))
      .catch(() => live && setSignedIn(true));
    return () => {
      live = false;
    };
  }, []);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!point) {
      setError(pinCopy);
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Site name is required.");
      return;
    }
    setError(null);
    const lat = point.lat;
    const lon = point.lon;
    startTransition(async () => {
      setProgress("Adding…");
      const result = await submitSite({
        name: trimmed,
        lat,
        lon,
        diverSiteType: siteType || undefined,
        diveTopM: top.trim() || undefined,
        diveMaxM: max.trim() || undefined,
        howToDive: howToDive.trim() || undefined,
        rating: rating ?? undefined,
      }).catch(() => ({ ok: false as const, error: "Could not add that site." }));
      if (!result.ok) {
        setProgress(null);
        setError(result.error);
        return;
      }
      const sent = photos.length
        ? await uploadPhotos(result.site.id, photos, (done) =>
            setProgress(`Sending photo ${done + 1} of ${photos.length}…`),
          )
        : { saved: 0, error: null };
      setProgress(null);
      if (sent.saved < photos.length) {
        const missing = photos.length - sent.saved;
        setAdded({
          id: result.site.id,
          note: `${missing === 1 ? "One photo was" : `${missing} photos were`} not saved${sent.error ? `: ${sent.error}` : "."} You can add photos on the site page.`,
        });
        return;
      }
      onAdded();
    });
  }

  if (added) {
    return (
      <div id="add-site-form" className="flex flex-col gap-2 pt-3" role="status">
        <p className="text-sm leading-5 text-foam">Site added.</p>
        <p className="text-sm leading-5 text-outgoing">{added.note}</p>
        <div className="flex gap-2">
          <Link
            href={`/sites/${added.id}`}
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-foam/30 px-4 text-sm font-semibold text-foam hover:bg-foam/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
          >
            Open site page
          </Link>
          <button
            type="button"
            onClick={onAdded}
            className="min-h-11 flex-1 rounded-xl bg-incoming px-4 text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foam"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  if (signedIn === false) {
    return (
      <div id="add-site-form" className="flex flex-col gap-2 pt-3">
        <p className="text-sm leading-5 text-foam/80">Sign in with your email to add a dive site.</p>
        <Link
          href={signInHref("/")}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-incoming px-4 text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foam"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form id="add-site-form" onSubmit={onSubmit} className="flex flex-col gap-2 pt-3">
      <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="site-name">
        Site name
        <input
          id="site-name"
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          autoComplete="off"
          className="field font-normal outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
        />
      </label>
      <p className="text-sm leading-5 text-foam/80">{pinCopy}</p>
      <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="site-kind">
        Kind of site
        <select
          id="site-kind"
          value={siteType}
          onChange={(event) => setSiteType(event.target.value)}
          className="field font-normal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
        >
          <option value="">Not sure</option>
          {DIVER_SITE_TYPES.map((option) => (
            <option key={option.type} value={option.type}>
              {option.label}
            </option>
          ))}
        </select>
        {typeHint ? <span className="text-xs font-normal leading-5 text-foam/70">{typeHint}</span> : null}
      </label>
      <fieldset className="flex flex-col gap-1">
        <legend className="pb-1 text-sm font-medium">Depth (m)</legend>
        <div className="flex gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-foam/80" htmlFor="site-top">
            From
            <input
              id="site-top"
              type="number"
              inputMode="decimal"
              min={0}
              max={MAX_DIVE_DEPTH_M}
              step="any"
              placeholder="5"
              value={top}
              onChange={(event) => setTop(event.target.value)}
              className="field w-full min-w-0 text-sm text-foam focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-foam/80" htmlFor="site-max">
            To
            <input
              id="site-max"
              type="number"
              inputMode="decimal"
              min={0}
              max={MAX_DIVE_DEPTH_M}
              step="any"
              placeholder="30"
              value={max}
              onChange={(event) => setMax(event.target.value)}
              className="field w-full min-w-0 text-sm text-foam focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
            />
          </label>
        </div>
      </fieldset>
      <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="site-how">
        How to dive it
        <textarea
          id="site-how"
          rows={4}
          maxLength={HOW_TO_DIVE_MAX}
          value={howToDive}
          onChange={(event) => setHowToDive(event.target.value)}
          placeholder="Where to drop in, which way to go on an incoming or outgoing current, what you see, hazards."
          className="field min-h-24 font-normal leading-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
        />
      </label>
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium" id="site-rating-label">
          Your rating <span className="font-normal text-foam/70">· optional</span>
        </span>
        <ScoreButtons
          selected={rating}
          onPick={(value) => setRating(rating === value ? null : value)}
          labelledBy="site-rating-label"
        />
      </div>
      <PhotoPicker photos={photos} onChange={setPhotos} max={MAX_PHOTOS_PER_SITE} disabled={pending} />
      {error ? <p className="text-sm text-outgoing">{error}</p> : null}
      <button
        type="submit"
        disabled={pending || !point || name.trim().length === 0}
        className="min-h-11 rounded-xl bg-incoming px-4 text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foam disabled:opacity-50"
      >
        {pending ? (progress ?? "Adding…") : "Add site"}
      </button>
      <p className="text-xs leading-5 text-foam/70">Everything but the name is optional. The kind of site picks the forecast; with Not sure, the pin&apos;s position decides.</p>
    </form>
  );
}

function describePin(point: Point | null): string {
  if (!point) return "Click the map to set the pin.";
  const lat = point.lat.toFixed(5);
  const lon = point.lon.toFixed(5);
  return `Pin ${lat}, ${lon}. Click the map again to move it.`;
}
