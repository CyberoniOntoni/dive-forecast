import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDiverProfile } from "@/lib/account-actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const diver = await getDiverProfile(id);
  return { title: diver ? `${diver.nickname} · Dive current` : "Diver · Dive current" };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 2026" from "2026-10". */
function monthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  return MONTHS[month - 1] ? `${MONTHS[month - 1]} ${year}` : yearMonth;
}

/** A diver's public page, opened from their nickname on the scoreboard. Nickname, About me, numbers, badges. */
export default async function DiverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const diver = await getDiverProfile(id);
  if (!diver) notFound();

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-3xl min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-8 sm:py-8">
      <Link href="/scoreboard" className="self-start text-sm text-foam/80 underline decoration-incoming underline-offset-4">
        Scoreboard
      </Link>
      <header className="flex min-w-0 flex-col gap-1">
        <h1 className="break-words text-2xl font-semibold tracking-tight text-foam">{diver.nickname}</h1>
        <p className="text-sm text-foam/75">
          Diving with us since {monthLabel(diver.since)}
          {diver.allRank ? ` · #${diver.allRank} all time` : ""}
        </p>
      </header>

      {diver.about ? (
        <section className="surface p-4 sm:p-5" aria-label="About me">
          <p className="whitespace-pre-line break-words text-sm leading-6 text-foam">{diver.about}</p>
        </section>
      ) : diver.isMe ? (
        <p className="text-sm text-foam/75">
          Nothing about you yet.{" "}
          <Link href="/account#about" className="underline decoration-incoming underline-offset-4">
            Add an About me
          </Link>
        </p>
      ) : null}
      {diver.about && diver.isMe ? (
        <Link href="/account#about" className="self-start text-sm text-foam/80 underline decoration-incoming underline-offset-4">
          Edit your About me
        </Link>
      ) : null}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Numbers">
        <Stat label="Points" value={diver.points} />
        <Stat label="Reports" value={diver.reports} note={diver.sites ? `at ${diver.sites} site${diver.sites === 1 ? "" : "s"}` : null} />
        <Stat label="Ratings" value={diver.ratings} />
        <Stat label="Sites added" value={diver.sitesAdded} />
      </section>

      {diver.badges.length ? (
        <section className="flex min-w-0 flex-col gap-3 surface p-4 sm:p-5" aria-labelledby="badges-heading">
          <h2 id="badges-heading" className="text-base font-semibold text-foam">
            Badges
          </h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {diver.badges.map((badge) => (
              <li key={badge.id} className="flex min-w-0 items-start gap-3 rounded-xl border border-incoming/60 bg-incoming/10 px-3 py-2">
                <span aria-hidden="true" className="pt-0.5 text-base">
                  ★
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foam">{badge.label}</span>
                  <span className="block text-xs leading-5 text-foam/75">{badge.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
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
