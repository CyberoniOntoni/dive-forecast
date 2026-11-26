/**
 * Two faint tide lines across the top of a card: the welcome card's motif (components/ForecastIntro.tsx), used on the
 * app's main cards so they read as one family. The card needs `relative overflow-hidden` (or the `tideline-card`
 * class) and enough top padding to clear it (about 2rem).
 */
export function TideLine({ className = "text-incoming" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 400 60"
      preserveAspectRatio="none"
      className={`pointer-events-none absolute inset-x-0 top-0 h-9 w-full ${className}`}
    >
      <path d="M0 38c40-14 80-14 120 0s80 14 120 0 80-14 120 0 40 7 40 7" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" />
      <path d="M0 48c40-12 80-12 120 0s80 12 120 0 80-12 120 0 40 6 40 6" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1.5" />
    </svg>
  );
}
