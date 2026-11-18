"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { blockDiver } from "@/lib/moderation-actions";

/** Unblocks a diver the signed-in one blocked, then shows the page again with their content. */
export function UnblockButton({ userId, nickname }: { userId: string; nickname: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`Unblock ${nickname}`}
      onClick={() =>
        startTransition(async () => {
          await blockDiver(userId, false);
          router.refresh();
        })
      }
      className="button-quiet px-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming disabled:opacity-50"
    >
      Unblock
    </button>
  );
}
