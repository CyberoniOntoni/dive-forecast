"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Result = { ok: boolean; error: string | null };

/**
 * The shell shared by the /moderation buttons: an action that needs confirming waits for a second tap, then runs the
 * server action, shows its error or refreshes the page. `confirm` is the action waiting for that second tap.
 */
export function useModerationAction<A extends string>() {
  const router = useRouter();
  const [confirm, setConfirm] = useState<A | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: A, needsConfirm: boolean, call: () => Promise<Result>) {
    if (needsConfirm && confirm !== action) {
      setConfirm(action);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await call();
      setConfirm(null);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  return { confirm, pending, run, error };
}

/** The error line under a row of moderation buttons. */
export function ModerationError({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm text-outgoing">
      {error}
    </p>
  ) : null;
}
