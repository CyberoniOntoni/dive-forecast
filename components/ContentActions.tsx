"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FLAG_REASON_LABELS, FLAG_NOTE_MAX } from "@/lib/moderation";
import { blockDiver, reportContent } from "@/lib/moderation-actions";
import { signInHref } from "@/lib/sign-in";
import { FLAG_REASONS, type FlagKind, type FlagReason } from "@/lib/types";

const LINK =
  "min-h-11 text-xs text-foam/65 underline decoration-foam/30 underline-offset-4 hover:text-foam focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming disabled:opacity-50";

/**
 * Report (and, for another diver, Block) under a review, a site added in the app or a diver's page: what Google Play
 * asks of apps with content from users (lib/moderation.ts). Signed out, Report leads to sign-in.
 */
export function ContentActions({
  kind,
  siteId,
  userId,
  nickname,
  signedIn,
  returnTo,
  canBlock = true,
}: {
  kind: FlagKind;
  siteId?: string;
  /** Whose content it is. */
  userId?: string;
  nickname?: string;
  signedIn: boolean;
  /** Where sign-in comes back to. */
  returnTo: string;
  canBlock?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<FlagReason | "">("");
  const [note, setNote] = useState("");
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const what = kind === "review" ? "review" : kind === "site" ? "site" : kind === "text" ? "text" : "diver";

  if (!signedIn) {
    return (
      <Link href={signInHref(returnTo)} className={`${LINK} self-start`}>
        Report
      </Link>
    );
  }

  function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason) return;
    startTransition(async () => {
      const result = await reportContent({ kind, siteId, userId, reason, note });
      if (!result.ok) {
        setMessage({ text: result.error ?? "Could not send the report.", error: true });
        return;
      }
      setOpen(false);
      setMessage({ text: "Thanks. A moderator will look at it.", error: false });
    });
  }

  function block() {
    if (!userId) return;
    if (!confirmBlock) {
      setConfirmBlock(true);
      return;
    }
    startTransition(async () => {
      const result = await blockDiver(userId, true);
      if (!result.ok) {
        setMessage({ text: result.error ?? "Could not block.", error: true });
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap gap-x-4">
        <button type="button" className={LINK} onClick={() => setOpen((value) => !value)} aria-expanded={open} disabled={pending}>
          Report
        </button>
        {canBlock && userId ? (
          <button type="button" className={LINK} onClick={block} disabled={pending}>
            {confirmBlock ? `Tap again to block ${nickname ?? "this diver"}` : "Block"}
          </button>
        ) : null}
      </div>
      {open ? (
        <form onSubmit={send} className="flex min-w-0 flex-col gap-2 rounded-xl border border-foam/15 p-3">
          <label className="flex min-w-0 flex-col gap-1 text-sm text-foam">
            What is wrong with this {what}?
            <select
              required
              value={reason}
              onChange={(event) => setReason(event.target.value as FlagReason)}
              className="field w-full min-w-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
            >
              <option value="" disabled>
                Pick a reason
              </option>
              {FLAG_REASONS.map((item) => (
                <option key={item} value={item}>
                  {FLAG_REASON_LABELS[item]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-sm text-foam">
            Anything to add (optional)
            <textarea
              value={note}
              maxLength={FLAG_NOTE_MAX}
              rows={2}
              onChange={(event) => setNote(event.target.value)}
              className="field w-full min-w-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending || !reason}
              className="min-h-11 rounded-xl bg-foam px-4 text-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming disabled:opacity-50"
            >
              Send report
            </button>
            <button type="button" onClick={() => setOpen(false)} className="button-quiet px-4">
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {message ? (
        <p role={message.error ? "alert" : "status"} className={`text-xs ${message.error ? "text-outgoing" : "text-foam/80"}`}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
