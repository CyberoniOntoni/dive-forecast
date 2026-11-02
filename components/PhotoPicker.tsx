"use client";

import { useEffect, useRef, useState } from "react";
import { addSitePhoto } from "@/lib/actions";
import { shrinkPhoto } from "@/lib/photo-shrink";

/** A photo picked and already shrunk in the browser, waiting to be sent. */
export type PickedPhoto = { key: string; blob: Blob; preview: string };

/**
 * Picks up to `max` photos, shrinks each as it is picked (lib/photo-shrink.ts) and shows them with a remove button.
 * Nothing is sent until the form calls uploadPhotos.
 */
export function PhotoPicker({
  photos,
  onChange,
  max,
  disabled,
  label = "Photos",
}: {
  photos: readonly PickedPhoto[];
  onChange: (photos: PickedPhoto[]) => void;
  max: number;
  disabled?: boolean;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const room = Math.max(0, max - photos.length);

  // Previews are object URLs; let them go when the picker goes.
  const latest = useRef(photos);
  useEffect(() => {
    latest.current = photos;
  }, [photos]);
  useEffect(() => () => latest.current.forEach((photo) => URL.revokeObjectURL(photo.preview)), []);

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setError(null);
    setBusy(true);
    const added: PickedPhoto[] = [];
    const problems: string[] = [];
    for (const file of files.slice(0, room)) {
      try {
        const blob = await shrinkPhoto(file);
        added.push({ key: crypto.randomUUID(), blob, preview: URL.createObjectURL(blob) });
      } catch (caught) {
        problems.push(caught instanceof Error ? caught.message : "Could not open that photo.");
      }
    }
    if (files.length > room) problems.push(`Up to ${max} photos.`);
    setBusy(false);
    if (problems.length) setError(problems[0]);
    if (added.length) onChange([...photos, ...added]);
  }

  function remove(key: string) {
    const gone = photos.find((photo) => photo.key === key);
    if (gone) URL.revokeObjectURL(gone.preview);
    onChange(photos.filter((photo) => photo.key !== key));
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">
        {label} <span className="font-normal text-foam/70">· up to {max}</span>
      </span>
      {photos.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2">
          {photos.map((photo, index) => (
            <li key={photo.key} className="relative aspect-square overflow-hidden rounded-lg bg-foam/10">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, not a remote image */}
              <img src={photo.preview} alt={`Photo ${index + 1}`} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => remove(photo.key)}
                disabled={disabled}
                aria-label={`Remove photo ${index + 1}`}
                className="absolute top-1 right-1 flex h-8 w-8 items-center justify-center rounded-full bg-ink/85 text-base leading-none text-foam focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {room > 0 ? (
        <>
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            onChange={onPick}
            disabled={disabled || busy}
            className="sr-only"
            id="site-photo-input"
          />
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={disabled || busy}
            className="min-h-11 rounded-xl border border-dashed border-foam/40 px-4 text-sm font-medium text-foam hover:bg-foam/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming disabled:opacity-50"
          >
            {busy ? "Preparing…" : photos.length ? "Add more photos" : "Add photos"}
          </button>
        </>
      ) : null}
      {error ? <p className="text-sm text-outgoing">{error}</p> : null}
    </div>
  );
}

/**
 * Sends picked photos one at a time (each is its own request, under the server action body limit). Returns how many
 * were saved and the first reason one was not.
 */
export async function uploadPhotos(
  siteId: string,
  photos: readonly PickedPhoto[],
  onProgress?: (done: number) => void,
): Promise<{ saved: number; error: string | null }> {
  let saved = 0;
  let error: string | null = null;
  for (const [index, photo] of photos.entries()) {
    onProgress?.(index);
    const form = new FormData();
    form.append("photo", photo.blob, "photo.jpg");
    try {
      const result = await addSitePhoto(siteId, form);
      if (result.ok) saved += 1;
      else error ??= result.error;
    } catch {
      error ??= "Could not send a photo.";
    }
  }
  return { saved, error };
}
