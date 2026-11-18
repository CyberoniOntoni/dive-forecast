"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moderateFlag } from "@/lib/moderation-actions";

/** A moderator's three answers to a report. Ban takes a second tap. */
export function ModerationActions({ flagId, canBan }: { flagId: string; canBan: boolean }) {
  const router = useRouter();
  const [confirmBan, setConfirmBan] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function act(action: "remove" | "ban" | "dismiss") {
    setError(null);
    startTransition(async () => {
      const result = await moderateFlag(flagId, action);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={() => act("remove")} className="min-h-11 rounded-xl bg-outgoing px-4 text-sm font-medium text-ink disabled:opacity-50">
          Remove content
        </button>
        {canBan ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => (confirmBan ? act("ban") : setConfirmBan(true))}
            className="min-h-11 rounded-xl bg-stop px-4 text-sm font-medium text-ink disabled:opacity-50"
          >
            {confirmBan ? "Tap again to ban and remove all their posts" : "Ban diver"}
          </button>
        ) : null}
        <button type="button" disabled={pending} onClick={() => act("dismiss")} className="button-quiet px-4 disabled:opacity-50">
          Dismiss
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-outgoing">
          {error}
        </p>
      ) : null}
    </div>
  );
}
