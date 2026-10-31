import type { BadgeId } from "@/lib/points-rules";

/** A number tile on the account page and on a diver's public page. */
export function Stat({ label, value, note = null }: { label: string; value: number; note?: string | null }) {
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

export type BadgeCard = { id: BadgeId; label: string; detail: string; earned: boolean };

/** Badge cards: earned ones lit, the rest dimmed. */
export function BadgeGrid({ badges }: { badges: readonly BadgeCard[] }) {
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {badges.map((badge) => (
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
  );
}
