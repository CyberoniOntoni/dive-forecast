"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteAccount } from "@/lib/account-actions";

/** Deletes the account and its data once the diver types their nickname back. What goes and what stays is on /privacy. */
export function DeleteAccount({ nickname }: { nickname: string }) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const confirmed = typed.trim().toLowerCase() === nickname.toLowerCase();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteAccount();
      if (!result.ok) {
        setError(result.error ?? "Could not delete the account.");
        return;
      }
      router.replace("/");
      router.refresh();
    });
  }

  return (
    <section id="delete" className="flex min-w-0 scroll-mt-4 flex-col gap-3 surface p-4 sm:p-5" aria-labelledby="delete-heading">
      <h2 id="delete-heading" className="text-base font-semibold text-foam">
        Delete your account
      </h2>
      <p className="text-sm leading-6 text-foam/85">
        This deletes your email, nickname, About me, dive plans, ratings, reviews and photos, and signs you out everywhere.
        Your dive reports stay, with no name on them, because they teach the forecast. It cannot be undone.{" "}
        <Link href="/privacy#delete" className="underline decoration-foam/40 underline-offset-4 hover:text-foam">
          What is deleted
        </Link>
      </p>
      <form onSubmit={submit} className="flex min-w-0 flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="delete-confirm">
          Type your nickname to confirm
        </label>
        <input
          id="delete-confirm"
          value={typed}
          autoComplete="off"
          placeholder={`Type ${nickname} to confirm`}
          onChange={(event) => setTyped(event.target.value)}
          className="field w-full min-w-0 flex-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
        />
        <button
          type="submit"
          disabled={pending || !confirmed}
          className="min-h-11 rounded-xl bg-stop px-4 text-base font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming disabled:opacity-50"
        >
          Delete account
        </button>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-outgoing">
          {error}
        </p>
      ) : null}
    </section>
  );
}
