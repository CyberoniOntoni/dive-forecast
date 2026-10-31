import type { Metadata } from "next";
import Link from "next/link";
import { getLeaderboard } from "@/lib/account-actions";
import { currentSession } from "@/lib/auth";
import { signInHref } from "@/lib/sign-in";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Leaderboard · Dive current" };

const PERIODS = [
  { id: "month", label: "This month" },
  { id: "all", label: "All time" },
] as const;

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const period = (await searchParams).period === "all" ? "all" : "month";
  const [rows, session] = await Promise.all([getLeaderboard(period), currentSession()]);

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-3xl min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-8 sm:py-8">
      <header className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foam">Top current reporters</h1>
        <p className="text-sm leading-6 text-foam/80">
          Every report after a dive makes the forecast better for the next diver. Points for reporting, for reporting
          soon after the dive, and for sites nobody has reported lately.
        </p>
      </header>
      <nav aria-label="Period" className="flex gap-0.5 self-start rounded-full bg-foam/10 p-0.5 ring-1 ring-foam/15">
        {PERIODS.map((item) => (
          <Link
            key={item.id}
            href={item.id === "month" ? "/leaderboard" : "/leaderboard?period=all"}
            aria-current={period === item.id ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium ${
              period === item.id ? "bg-foam text-ink" : "text-foam/80 hover:text-foam"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <section className="flex min-w-0 flex-col surface p-2 sm:p-3" aria-label="Leaderboard">
        {rows.length === 0 ? (
          <p className="p-3 text-sm leading-6 text-foam/80">
            No reports {period === "month" ? "this month" : ""} yet. Be the first: open a site after your dive and
            report the current.
          </p>
        ) : (
          <ol className="flex min-w-0 flex-col">
            {rows.map((row) => (
              <li
                key={row.nickname}
                className={`flex min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 ${row.isMe ? "bg-incoming/15 ring-1 ring-incoming/50" : ""}`}
              >
                <span className={`w-8 shrink-0 text-right font-mono text-sm tabular-nums ${row.rank <= 3 ? "text-incoming" : "text-foam/70"}`}>
                  {row.rank}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foam">
                    {row.nickname}
                    {row.isMe ? <span className="text-foam/70"> (you)</span> : null}
                  </span>
                  <span className="block text-xs text-foam/70">
                    {row.reports} {row.reports === 1 ? "report" : "reports"} · {row.sites}{" "}
                    {row.sites === 1 ? "site" : "sites"}
                    {row.badges ? ` · ${row.badges} ★` : ""}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-base font-semibold tabular-nums text-foam">{row.points}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
      {session ? (
        <Link href="/account" className="button-quiet justify-center px-4 sm:self-start">
          Your points and badges
        </Link>
      ) : (
        <Link href={signInHref("/leaderboard")} className="button-quiet justify-center px-4 sm:self-start">
          Sign in to join
        </Link>
      )}
    </main>
  );
}
