/** The reviews card's words, shared by the web card (components/SiteReviews.tsx) and the app's API (lib/api-v1.ts). */

/** "9 Nov 2026", in Maldives time on the server and in the browser alike. */
export function reviewDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { timeZone: "Indian/Maldives", day: "numeric", month: "short", year: "numeric" });
}

/** "4.2 from 5 divers", or "No ratings yet". */
export function reviewSummaryLine(summary: { average: number | null; count: number }): string {
  if (summary.average == null) return "No ratings yet";
  return `${summary.average} from ${summary.count} ${summary.count === 1 ? "diver" : "divers"}`;
}
