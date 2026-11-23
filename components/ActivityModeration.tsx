"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActivityTarget } from "@/lib/activity";
import { moderateContent } from "@/lib/moderation-actions";

/** A moderator's answers to something in the activity feed, with no content report needed. Both take a second tap. */
export function ActivityModeration({ target, canBan }: { target: ActivityTarget; canBan: boolean }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<"remove" | "ban" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const removeLabel = target.kind === "review" ? "Remove review" : target.kind === "site" ? "Hide site" : "Reset profile";

  function act(action: "remove" | "ban") {
    if (confirm !== action) {
      setConfirm(action);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await moderateContent(target, action);
      setConfirm(null);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={() => act("remove")} className="button-quiet px-3 text-sm disabled:opacity-50">
          {confirm === "remove" ? "Tap again to confirm" : removeLabel}
        </button>
        {canBan ? (
          <button type="button" disabled={pending} onClick={() => act("ban")} className="button-quiet px-3 text-sm text-stop disabled:opacity-50">
            {confirm === "ban" ? "Tap again to ban and remove all their posts" : "Ban diver"}
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-outgoing">
          {error}
        </p>
      ) : null}
    </div>
  );
}
