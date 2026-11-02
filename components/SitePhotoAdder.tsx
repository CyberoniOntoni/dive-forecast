"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PhotoPicker, uploadPhotos, type PickedPhoto } from "./PhotoPicker";

/** On the site page, for the diver who added the site: more photos, up to the site's limit. */
export function SitePhotoAdder({ siteId, room }: { siteId: string; room: number }) {
  const router = useRouter();
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    setError(null);
    startTransition(async () => {
      const sent = await uploadPhotos(siteId, photos, (done) => setProgress(`Sending photo ${done + 1} of ${photos.length}…`));
      setProgress(null);
      photos.forEach((photo) => URL.revokeObjectURL(photo.preview));
      setPhotos([]);
      if (sent.error) setError(sent.error);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <PhotoPicker photos={photos} onChange={setPhotos} max={room} disabled={pending} label="Add your photos" />
      {photos.length > 0 ? (
        <button
          type="button"
          onClick={send}
          disabled={pending}
          className="min-h-11 rounded-xl bg-incoming px-4 text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foam disabled:opacity-50"
        >
          {pending ? (progress ?? "Sending…") : photos.length === 1 ? "Save photo" : `Save ${photos.length} photos`}
        </button>
      ) : null}
      {error ? <p className="text-sm text-outgoing">{error}</p> : null}
    </div>
  );
}
