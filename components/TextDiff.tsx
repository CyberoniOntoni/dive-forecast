import type { FieldChange } from "@/lib/site-wiki";

/**
 * One field's change, word by word: removed words struck through, added ones underlined, so it reads without colour
 * too. For moderators reviewing an edit and the site's history.
 */
export function TextDiff({ change }: { change: FieldChange }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-xs font-semibold tracking-wide text-foam/70 uppercase">
        {change.label}
        {change.cleared ? " · cleared" : ""}
      </p>
      <p className="rounded-lg bg-ink/60 p-3 text-sm leading-6 break-words whitespace-pre-line text-foam/85">
        {change.diff.length === 0 ? <span className="text-foam/60">(empty)</span> : null}
        {change.diff.map((part, index) =>
          part.kind === "same" ? (
            <span key={index}>{part.text}</span>
          ) : part.kind === "removed" ? (
            <del key={index} className="bg-outgoing/20 text-foam/70 decoration-outgoing" aria-label={`removed: ${part.text}`}>
              {part.text}
            </del>
          ) : (
            <ins key={index} className="bg-incoming/20 text-foam underline decoration-incoming" aria-label={`added: ${part.text}`}>
              {part.text}
            </ins>
          ),
        )}
      </p>
    </div>
  );
}
