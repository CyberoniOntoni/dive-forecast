"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { changeAbout } from "@/lib/account-actions";
import { ABOUT_MAX } from "@/lib/accounts";

/** The diver's "About me", shown on their public page (opened from the scoreboard). */
export function AboutForm({ about, userId }: { about: string; userId: string }) {
  const router = useRouter();
  const [text, setText] = useState(about);
  const [saved, setSaved] = useState(about);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await changeAbout(text);
      if (!result.ok) {
        setMessage({ text: result.error ?? "Could not save About me.", error: true });
        return;
      }
      setText(result.about ?? "");
      setSaved(result.about ?? "");
      setMessage({ text: "Saved.", error: false });
      router.refresh();
    });
  }

  return (
    <section id="about" className="flex min-w-0 scroll-mt-4 flex-col gap-3 surface p-4 sm:p-5" aria-labelledby="about-heading">
      <h2 id="about-heading" className="text-base font-semibold text-foam">
        About me
      </h2>
      <p className="text-sm text-foam/75">
        Shown to everyone on{" "}
        <Link href={`/divers/${userId}`} className="underline decoration-incoming underline-offset-4">
          your public page
        </Link>
        , which opens from your nickname on the scoreboard. Where you dive, how long, what you like to see.
      </p>
      <form onSubmit={save} className="flex min-w-0 flex-col gap-2">
        <label className="sr-only" htmlFor="about-text">
          About me
        </label>
        <textarea
          id="about-text"
          value={text}
          maxLength={ABOUT_MAX}
          rows={4}
          onChange={(event) => setText(event.target.value)}
          className="field w-full min-w-0 resize-y py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs tabular-nums text-foam/70">
            {Array.from(text).length} / {ABOUT_MAX}
          </span>
          <button
            type="submit"
            disabled={pending || text.trim() === saved}
            className="min-h-11 rounded-xl bg-foam px-4 text-base font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </form>
      {message ? (
        <p role={message.error ? "alert" : "status"} className={`text-sm ${message.error ? "text-outgoing" : "text-foam"}`}>
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
