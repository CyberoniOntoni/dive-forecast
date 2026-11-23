"use client";

import { ModerationError, useModerationAction } from "@/components/useModerationAction";
import { moderateReports } from "@/lib/moderation-actions";

type Action = "hide" | "show" | "hide-all";

/**
 * A moderator's answers to a dive report in the activity feed: hide it (it stops teaching the forecast), show it again,
 * or hide every report filed under its diver's id (a deleted account's too). Hiding takes a second tap; showing again
 * does not. `diverVisible` counts that id's reports still teaching the forecast; Hide all shows only when it would hide
 * more than this one card could.
 */
export function ReportModeration({ reportId, hidden, userId, diverVisible }: { reportId: string; hidden: boolean; userId: string | null; diverVisible: number }) {
  const { confirm, pending, run, error } = useModerationAction<Action>();
  const act = (action: Action) => run(action, action !== "show", () => moderateReports(action === "hide-all" ? userId : reportId, action));

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
        {userId && diverVisible > 1 ? (
          <button type="button" disabled={pending} onClick={() => act("hide-all")} className="button-quiet px-3 text-sm disabled:opacity-50">
            {confirm === "hide-all" ? `Tap again to hide all ${diverVisible}` : `Hide all ${diverVisible} of their reports`}
          </button>
        ) : null}
      </div>
      <ModerationError error={error} />
    </div>
  );
}
