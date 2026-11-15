"use client";

import { useState, type ReactNode } from "react";

const BUTTON =
  "button-quiet justify-center px-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming";

/** Share the plan's link (the phone's share sheet where there is one, else copy it) and print it for the briefing board. */
export function PlanShare({ title, path, children }: { title: string; path: string; children?: ReactNode }) {
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
    <div className="flex min-w-0 flex-col gap-2 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={share}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-incoming px-4 text-sm font-semibold text-[#07151d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foam"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
          </svg>
          Share link
        </button>
        <button type="button" onClick={() => window.print()} className={`${BUTTON} gap-2`}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 9V3h10v6M7 18H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 14h10v7H7z" />
          </svg>
          Print
        </button>
        {children}
      </div>
      <p role="status" className="text-sm text-foam/75 empty:hidden">
        {copied === "copied" ? "Link copied. Anyone with it can see this plan." : copied === "failed" ? `Copy this link: ${path}` : ""}
      </p>
    </div>
  );
}
