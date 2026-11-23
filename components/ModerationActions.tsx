"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActivityTarget } from "@/lib/activity";
import { REMOVE_LABELS } from "@/lib/moderation";
import { moderateContent, moderateFlag } from "@/lib/moderation-actions";

type Action = "remove" | "ban" | "dismiss";

/**
 * A moderator's answers on /moderation: to an open report (`flagId`: Remove content, Ban diver, Dismiss), or to
 * something in the activity feed with no report (`target`: Remove, Ban diver). Ban always takes a second tap; in the
 * feed, Remove does too. Remove is left out when there is nothing to remove, Ban when the server would refuse it.
 */
export function ModerationActions(
  props:
    | { flagId: string; canBan: boolean; target?: never; banTarget?: never }
    | { target: ActivityTarget | null; banTarget: ActivityTarget | null; flagId?: never; canBan?: never },
) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fromReport = props.flagId != null;
  const target = props.target ?? null;
  const canBan = fromReport ? props.canBan : props.banTarget != null;
  const removeLabel = fromReport || !target ? "Remove content" : REMOVE_LABELS[target.kind];

  function act(action: Action) {
    const needsConfirm = action === "ban" || (action === "remove" && !fromReport);
    if (needsConfirm && confirm !== action) {
      setConfirm(action);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result =
        props.flagId != null
          ? await moderateFlag(props.flagId, action)
          : await moderateContent(action === "ban" ? props.banTarget : target, action);
      setConfirm(null);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  if (!fromReport && !target && !canBan) return null;
  const solid = "min-h-11 rounded-xl px-4 text-sm font-medium text-ink disabled:opacity-50";
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {fromReport || target ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => act("remove")}
            className={fromReport ? `${solid} bg-outgoing` : "button-quiet px-3 text-sm disabled:opacity-50"}
          >
            {confirm === "remove" ? "Tap again to confirm" : removeLabel}
          </button>
        ) : null}
        {canBan ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => act("ban")}
            className={fromReport ? `${solid} bg-stop` : "button-quiet px-3 text-sm text-stop disabled:opacity-50"}
          >
            {confirm === "ban" ? "Tap again to ban and remove all their posts" : "Ban diver"}
          </button>
        ) : null}
        {fromReport ? (
          <button type="button" disabled={pending} onClick={() => act("dismiss")} className="button-quiet px-4 disabled:opacity-50">
            Dismiss
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
