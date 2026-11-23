/** The label on anything from the store-review account on /moderation: its content is shown only to itself. */
export function StoreReviewerChip({ className = "" }: { className?: string }) {
  return <span className={`rounded bg-foam/15 px-1.5 py-0.5 text-xs ${className}`.trim()}>Store reviewer: hidden from others</span>;
}
