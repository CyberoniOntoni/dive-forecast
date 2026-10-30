"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { whoAmI } from "@/lib/account-actions";
import { addSite } from "@/lib/actions";
import { signInHref } from "@/lib/sign-in";

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
      {error ? <p className="text-sm text-outgoing">{error}</p> : null}
      <button
        type="submit"
        disabled={pending || !point || name.trim().length === 0}
        className="min-h-11 rounded-xl bg-incoming px-4 text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foam disabled:opacity-50"
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
