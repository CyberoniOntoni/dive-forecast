"use client";

import { useState } from "react";
import { ModerationError, useModerationAction } from "@/components/useModerationAction";
import { EDIT_NOTE_MAX } from "@/lib/site-wiki-limits";
import { reviewSiteEdit, revertSiteEdit } from "@/lib/wiki-actions";

/**
 * A moderator's answers to a diver's site edit on /moderation: Approve (it goes live with the diver's name on it) or
 * Reject with an optional reason the diver sees. Approve is left out when the server would refuse it.
 */
export function EditReviewActions({ editId, cannotApprove, stale }: { editId: string; cannotApprove: string | null; stale: boolean }) {
  const { confirm, pending, run, error } = useModerationAction<"approve" | "reject">();
  const [reason, setReason] = useState("");
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label className="flex min-w-0 flex-col gap-1 text-xs text-foam/75">
        Reason, if you reject it (the diver sees it)
        <input
          value={reason}
          maxLength={EDIT_NOTE_MAX}
          onChange={(event) => setReason(event.target.value)}
          className="field w-full min-w-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {cannotApprove ? null : (
          <button
            type="button"
            disabled={pending}
            // Over a newer edit, approving writes over it: a second tap.
            onClick={() => run("approve", stale, () => reviewSiteEdit(editId, "approve"))}
            className="button-primary"
          >
            {confirm === "approve" ? "Tap again to write over the newer text" : "Approve"}
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => run("reject", false, () => reviewSiteEdit(editId, "reject", reason))}
          className="button-quiet px-4 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
      {cannotApprove ? <p className="meta">{cannotApprove}</p> : null}
      <ModerationError error={error} />
    </div>
  );
}

/** A moderator takes back the live revision of a site's text, on its history page. Takes a second tap. */
export function RevertButton({ editId }: { editId: string }) {
  const { confirm, pending, run, error } = useModerationAction<"revert">();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => run("revert", true, () => revertSiteEdit(editId))}
        className="button-quiet self-start px-3 text-sm text-stop disabled:opacity-50"
      >
        {confirm === "revert" ? "Tap again to take it back" : "Take back this edit"}
      </button>
      <ModerationError error={error} />
    </div>
  );
}
