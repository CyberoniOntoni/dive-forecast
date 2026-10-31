import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountControls } from "@/components/AccountControls";
import { getAccount } from "@/lib/account-actions";
import { POINTS, FRESH_HOURS, PATHFINDER_DAYS, REPORTS_PER_DAY } from "@/lib/points-rules";
import { signInHref } from "@/lib/sign-in";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Your account · Dive current" };

export default async function AccountPage() {
  const account = await getAccount();
  if (!account) redirect(signInHref("/account"));
  const { stats } = account;

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-3xl min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-8 sm:py-8">
      <header className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foam">{account.nickname}</h1>
        <p className="text-sm text-foam/75">Signed in as {account.email}. Only you see your email.</p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Your numbers">
        <Stat label="Points" value={stats.points} />
        <Stat label="This month" value={stats.monthPoints} note={account.monthRank ? `#${account.monthRank}` : null} />
        <Stat label="Reports" value={stats.reports} />
        <Stat label="Sites" value={stats.sites} note={stats.atolls ? `${stats.atolls} atoll${stats.atolls === 1 ? "" : "s"}` : null} />
      </section>
      <Link
        href="/scoreboard"
        className="button-quiet justify-center px-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming sm:self-start"
      >
        See the scoreboard
      </Link>

      <section className="flex min-w-0 flex-col gap-3 surface p-4 sm:p-5" aria-labelledby="badges-heading">
        <h2 id="badges-heading" className="text-base font-semibold text-foam">
          Badges
        </h2>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {account.badges.map((badge) => (
            <li
              key={badge.id}
              className={`flex min-w-0 items-start gap-3 rounded-xl border px-3 py-2 ${
                badge.earned ? "border-incoming/60 bg-incoming/10" : "border-foam/15 opacity-60"
              }`}
            >
              <span aria-hidden="true" className="pt-0.5 text-base">
                {badge.earned ? "★" : "☆"}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foam">
                  {badge.label}
                  <span className="sr-only">{badge.earned ? " (earned)" : " (not yet)"}</span>
                </span>
                <span className="block text-xs leading-5 text-foam/75">{badge.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex min-w-0 flex-col gap-2 surface p-4 sm:p-5" aria-labelledby="points-heading">
        <h2 id="points-heading" className="text-base font-semibold text-foam">
          How points work
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-foam/85">
          <li>{POINTS.report} points for each current report.</li>
          <li>+{POINTS.fresh} when you file it within {FRESH_HOURS} hours of the dive, while it is fresh.</li>
          <li>+{POINTS.pathfinder} when nobody had reported that site in the {PATHFINDER_DAYS} days before your dive.</li>
          <li>
            Up to {REPORTS_PER_DAY} reports a day count, and one per dive. Agreeing with the forecast earns nothing: report
            what you felt.
          </li>
        </ul>
      </section>

      <AccountControls nickname={account.nickname} />
    </main>
  );
}

function Stat({ label, value, note = null }: { label: string; value: number; note?: string | null }) {
  return (
    <div className="flex min-w-0 flex-col surface px-4 py-3">
      <span className="text-xs text-foam/75">{label}</span>
      <span className="text-2xl font-semibold tabular-nums text-foam">
        {value}
        {note ? <span className="ml-2 text-sm font-normal text-foam/75">{note}</span> : null}
      </span>
    </div>
  );
}
