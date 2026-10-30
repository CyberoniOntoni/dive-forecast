"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeNickname, signOut } from "@/lib/account-actions";
import { NICKNAME_MAX } from "@/lib/accounts";

/** Change the nickname, or sign out. */
export function AccountControls({ nickname }: { nickname: string }) {
  const router = useRouter();
  const [name, setName] = useState(nickname);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await changeNickname(name);
      if (!result.ok) {
        setMessage({ text: result.error ?? "Could not change the nickname.", error: true });
        return;
      }
      setMessage({ text: "Nickname saved.", error: false });
      router.refresh();
    });
  }

  return (
    <section className="flex min-w-0 flex-col gap-3 surface p-4 sm:p-5" aria-labelledby="nickname-heading">
      <h2 id="nickname-heading" className="text-base font-semibold text-foam">
        Nickname
      </h2>
      <form onSubmit={save} className="flex min-w-0 flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="nickname">
          Nickname
        </label>
        <input
          id="nickname"
          value={name}
          maxLength={NICKNAME_MAX}
          required
          onChange={(event) => setName(event.target.value)}
          className="field w-full min-w-0 flex-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
        />
        <button
          type="submit"
          disabled={pending || name.trim() === nickname}
          className="min-h-11 rounded-xl bg-foam px-4 text-base font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming disabled:opacity-50"
        >
          Save
        </button>
      </form>
      {message ? (
        <p role={message.error ? "alert" : "status"} className={`text-sm ${message.error ? "text-outgoing" : "text-foam"}`}>
          {message.text}
        </p>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await signOut();
            router.replace("/");
            router.refresh();
          })
        }
        className="button-quiet justify-center px-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming sm:self-start"
      >
        Sign out
      </button>
    </section>
  );
}
