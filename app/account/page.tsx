import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AboutForm } from "@/components/AboutForm";
import { AccountControls } from "@/components/AccountControls";
import { BadgeGrid, Stat } from "@/components/ProfileParts";
import { getAccount } from "@/lib/account-actions";
import { POINTS, FRESH_HOURS, PATHFINDER_DAYS, RATINGS_PER_DAY, REPORTS_PER_DAY } from "@/lib/points-rules";
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
        <Stat label="Reports" value={stats.reports} note={stats.ratings ? `${stats.ratings} rating${stats.ratings === 1 ? "" : "s"}` : null} />
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
        <BadgeGrid badges={account.badges} />
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
            {POINTS.rating} points for rating a site, once per site, up to {RATINGS_PER_DAY} ratings a day.
          </li>
          <li>
            Up to {REPORTS_PER_DAY} reports a day count, and one per dive. Agreeing with the forecast earns nothing: report
            what you felt.
          </li>
        </ul>
      </section>

      <AboutForm about={account.about} userId={account.userId} />
      <AccountControls nickname={account.nickname} />
    </main>
  );
}
