"use client";

const SCORES = [1, 2, 3, 4, 5] as const;

function scoreButtonClass(selected: boolean): string {
  const tone = selected ? "border-foam bg-foam text-ink" : "border-foam/20 bg-ink text-foam";
  return `min-h-11 flex-1 rounded-xl border text-base font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming disabled:opacity-60 ${tone}`;
}

/** A 1 to 5 site rating as a row of buttons: the site page's rating card and the add-site form. */
export function ScoreButtons({
  selected,
  onPick,
  disabled,
  label,
  labelledBy,
}: {
  selected: number | null;
  onPick: (score: number) => void;
  disabled?: boolean;
  label?: string;
  labelledBy?: string;
}) {
  return (
    <div className="flex gap-2" role="group" aria-label={label} aria-labelledby={labelledBy}>
      {SCORES.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={selected === value}
          disabled={disabled}
          onClick={() => onPick(value)}
          className={scoreButtonClass(selected === value)}
        >
          {value}
        </button>
      ))}
    </div>
  );
}
