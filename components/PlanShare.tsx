"use client";

import { useState } from "react";

const BUTTON =
  "button-quiet justify-center px-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming";

/** Share the plan's link (the phone's share sheet where there is one, else copy it) and print it for the briefing board. */
export function PlanShare({ title, path }: { title: string; path: string }) {
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);

  const share = async () => {
    const url = new URL(path, window.location.origin).toString();
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        // Closing the sheet is not a failure; anything else falls back to copying.
        if ((error as Error)?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <button type="button" onClick={share} className={`${BUTTON} bg-incoming/15`}>
        Share link
      </button>
      <button type="button" onClick={() => window.print()} className={BUTTON}>
        Print
      </button>
      <span role="status" className="text-sm text-foam/75">
        {copied === "copied" ? "Link copied. Anyone with it can see this plan." : copied === "failed" ? `Copy this link: ${path}` : ""}
      </span>
    </div>
  );
}
