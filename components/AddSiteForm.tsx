"use client";

import { useState, useTransition } from "react";
import { addSite } from "@/lib/actions";

type Point = { lat: number; lon: number };

export function AddSiteForm({
  point,
  onAdded,
}: {
  point: Point | null;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const pinCopy = describePin(point);

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
      try {
        await addSite({ name: trimmed, lat, lon });
        setName("");
        onAdded();
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "";
        setError(message || "Could not add that site.");
      }
    });
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
          className="min-h-11 rounded-md border border-foam/25 bg-ink px-3 text-base font-normal text-foam outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
        />
      </label>
      <p className="text-sm leading-5 text-foam/80">{pinCopy}</p>
      {error ? <p className="text-sm text-outgoing">{error}</p> : null}
      <button
        type="submit"
        disabled={pending || !point || name.trim().length === 0}
        className="min-h-11 rounded-md bg-incoming px-4 text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foam disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add site"}
      </button>
    </form>
  );
}

function describePin(point: Point | null): string {
  if (!point) return "Click the map to set the pin.";
  const lat = point.lat.toFixed(5);
  const lon = point.lon.toFixed(5);
  return `Pin ${lat}, ${lon}. Click the map again to move it.`;
}
