import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { getLeaderboard, getSiteScouts, type LeaderboardRow } from "@/lib/account-actions";
import { currentSession } from "@/lib/auth";
import { signInHref } from "@/lib/sign-in";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Scoreboard · Dive current" };

type Board = "month" | "all" | "sites";

const BOARDS: readonly { id: Board; label: string; href: string }[] = [
  { id: "month", label: "This month", href: "/scoreboard" },
  { id: "all", label: "All time", href: "/scoreboard?period=all" },
  { id: "sites", label: "New sites", href: "/scoreboard?board=sites" },
];

/** Public: the divers who report the current and the ones who add dive sites. Nicknames only. */
export default async function ScoreboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const board: Board = params.board === "sites" ? "sites" : params.period === "all" ? "all" : "month";
  const session = await currentSession();

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-3xl min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-8 sm:py-8">
      <header className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foam">Scoreboard</h1>
        <p className="text-sm leading-6 text-foam/80">
          The divers who make this forecast better: every current report after a dive sharpens the next diver&apos;s
          forecast, every rating helps others pick a site, and every new site puts another reef on the map.
        </p>
      </header>
      <nav aria-label="Board" className="flex gap-0.5 self-start rounded-full bg-foam/10 p-0.5 ring-1 ring-foam/15">
        {BOARDS.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            aria-current={board === item.id ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-full px-3.5 text-sm font-medium sm:px-4 ${
              board === item.id ? "bg-foam text-ink" : "text-foam/80 hover:text-foam"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {board === "sites" ? <SitesBoard /> : <ReportsBoard period={board} />}
      {session ? (
        <Link href="/account" className="button-quiet justify-center px-4 sm:self-start">
          Your points and badges
        </Link>
      ) : (
        <Link href={signInHref(board === "sites" ? "/scoreboard?board=sites" : "/scoreboard")} className="button-quiet justify-center px-4 sm:self-start">
          Sign in to join
        </Link>
      )}
    </main>
  );
}

async function ReportsBoard({ period }: { period: "month" | "all" }) {
  const rows = await getLeaderboard(period);
  return (
    <section className="flex min-w-0 flex-col gap-2" aria-labelledby="reports-board-heading">
      <h2 id="reports-board-heading" className="text-base font-semibold text-foam">
        Current reporters
      </h2>
      <p className="text-xs leading-5 text-foam/70">
        Points for each report, more for reporting soon after the dive and at sites nobody has reported lately, and
        for rating the sites you dived.
      </p>
      <div className="surface p-2 sm:p-3">
        {rows.length === 0 ? (
          <Empty>
            No reports {period === "month" ? "this month " : ""}yet. Be the first: open a site after your dive and report
            the current.
          </Empty>
        ) : (
          <ol className="flex min-w-0 flex-col">
            {rows.map((row) => (
              <Row
                key={row.nickname}
                userId={row.userId}
                rank={row.rank}
                nickname={row.nickname}
                isMe={row.isMe}
                detail={reporterDetail(row)}
                score={row.points}
              />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

async function SitesBoard() {
  const { scouts, newest } = await getSiteScouts();
  return (
    <>
      <section className="flex min-w-0 flex-col gap-2" aria-labelledby="sites-board-heading">
        <h2 id="sites-board-heading" className="text-base font-semibold text-foam">
          Site scouts
        </h2>
        <p className="text-xs leading-5 text-foam/70">
          Divers who added dive sites to the map, and how many of those other divers have since reported at.
        </p>
        <div className="surface p-2 sm:p-3">
          {scouts.length === 0 ? (
            <Empty>No sites added yet. Know a site that is missing? Open Add site on the map.</Empty>
          ) : (
            <ol className="flex min-w-0 flex-col">
              {scouts.map((row) => (
                <Row
                  key={row.nickname}
                  userId={row.userId}
                  rank={row.rank}
                  nickname={row.nickname}
                  isMe={row.isMe}
                  detail={`${row.reportedByOthers} reported by other divers`}
                  score={row.sites}
                  unit={row.sites === 1 ? "site" : "sites"}
                />
              ))}
            </ol>
          )}
        </div>
      </section>
      {newest.length ? (
        <section className="flex min-w-0 flex-col gap-2" aria-labelledby="new-sites-heading">
          <h2 id="new-sites-heading" className="text-base font-semibold text-foam">
            Newest sites
          </h2>
          <ul className="surface flex min-w-0 flex-col divide-y divide-foam/10 px-4 py-1">
            {newest.map((site) => (
              <li key={site.id} className="flex min-w-0 items-baseline justify-between gap-3 py-2.5">
                <Link href={`/sites/${site.id}`} className="min-w-0 truncate text-sm font-medium text-foam underline decoration-incoming underline-offset-4">
                  {site.name}
                </Link>
                <span className="shrink-0 text-xs text-foam/70">
                  added by{" "}
                  <Link href={`/divers/${site.userId}`} className="underline decoration-foam/40 underline-offset-4 hover:text-foam">
                    {site.nickname}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function reporterDetail(row: LeaderboardRow): string {
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return [
    row.reports ? count(row.reports, "report", "reports") : null,
    row.reports ? count(row.sites, "site", "sites") : null,
    row.ratings ? count(row.ratings, "rating", "ratings") : null,
    row.badges ? `${row.badges} ★` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function Row({
  userId,
  rank,
  nickname,
  isMe,
  detail,
  score,
  unit,
}: {
  userId: string;
  rank: number;
  nickname: string;
  isMe: boolean;
  detail: string;
  score: number;
  unit?: string;
}) {
  return (
    <li className={`flex min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 ${isMe ? "bg-incoming/15 ring-1 ring-incoming/50" : ""}`}>
      <span className={`w-8 shrink-0 text-right font-mono text-sm tabular-nums ${rank <= 3 ? "text-incoming" : "text-foam/70"}`}>
        {rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : rank}
      </span>
      <span className="min-w-0 flex-1">
        <Link href={`/divers/${userId}`} className="block truncate text-sm font-medium text-foam underline decoration-foam/30 underline-offset-4 hover:decoration-incoming">
          {nickname}
          {isMe ? <span className="text-foam/70"> (you)</span> : null}
        </Link>
        <span className="block text-xs text-foam/70">{detail}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="font-mono text-base font-semibold tabular-nums text-foam">{score}</span>
        {unit ? <span className="ml-1 text-xs text-foam/70">{unit}</span> : null}
      </span>
    </li>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="p-3 text-sm leading-6 text-foam/80">{children}</p>;
}
