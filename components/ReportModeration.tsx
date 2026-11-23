"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moderateReports } from "@/lib/moderation-actions";

type Action = "hide" | "show" | "hide-all";

/**
 * A moderator's answers to a dive report in the activity feed: hide it (it stops teaching the forecast), show it again,
 * or hide every report its diver filed. Hiding takes a second tap; showing again does not.
 */
export function ReportModeration({ reportId, hidden, userId, diverVisible }: { reportId: string; hidden: boolean; userId: string | null; diverVisible: number }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function act(action: Action) {
    if (action !== "show" && confirm !== action) {
      setConfirm(action);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await moderateReports(action === "hide-all" ? userId : reportId, action);
      setConfirm(null);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {hidden ? (
          <button type="button" disabled={pending} onClick={() => act("show")} className="button-quiet px-3 text-sm disabled:opacity-50">
            Show report again
          </button>
        ) : (
          <button type="button" disabled={pending} onClick={() => act("hide")} className="button-quiet px-3 text-sm disabled:opacity-50">
            {confirm === "hide" ? "Tap again to hide it from the forecast" : "Hide report"}
          </button>
        )}
        {userId && diverVisible > (hidden ? 0 : 1) ? (
          <button type="button" disabled={pending} onClick={() => act("hide-all")} className="button-quiet px-3 text-sm disabled:opacity-50">
            {confirm === "hide-all" ? `Tap again to hide all ${diverVisible}` : `Hide all ${diverVisible} of their reports`}
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
