/**
 * A word-level diff of two plain texts, for moderators reviewing a site edit and for the site's history page. Words and
 * the whitespace after them are the units, so a changed word shows as one word struck out and one added, and the
 * joined parts read back as either text.
 */

export type DiffPart = { kind: "same" | "added" | "removed"; text: string };

/** Above this many units on each side the diff is not worth the work: the whole text shows as replaced. */
const MAX_UNITS = 2000;

/** Words with the whitespace that follows each, and any leading whitespace as its own unit. */
function units(text: string): string[] {
  return text.match(/\s+|\S+\s*/g) ?? [];
}

export function diffWords(before: string, after: string): DiffPart[] {
  if (before === after) return before ? [{ kind: "same", text: before }] : [];
  const a = units(before);
  const b = units(after);
  // Common start and end first: most edits touch a few words in the middle.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end += 1;
  const head = a.slice(0, start).join("");
  const tail = a.slice(a.length - end).join("");
  const midA = a.slice(start, a.length - end);
  const midB = b.slice(start, b.length - end);

  const middle: DiffPart[] =
    midA.length > MAX_UNITS || midB.length > MAX_UNITS
      ? [
          { kind: "removed", text: midA.join("") },
          { kind: "added", text: midB.join("") },
        ]
      : lcsDiff(midA, midB);
  return merge([
    ...(head ? [{ kind: "same" as const, text: head }] : []),
    ...middle,
    ...(tail ? [{ kind: "same" as const, text: tail }] : []),
  ]);
}

/** The longest common subsequence of the two unit lists, walked back into same / removed / added runs. */
function lcsDiff(a: readonly string[], b: readonly string[]): DiffPart[] {
  const width = b.length + 1;
  const table = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const parts: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      parts.push({ kind: "same", text: a[i] });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      parts.push({ kind: "removed", text: a[i] });
      i += 1;
    } else {
      parts.push({ kind: "added", text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) parts.push({ kind: "removed", text: a[i++] });
  while (j < b.length) parts.push({ kind: "added", text: b[j++] });
  return parts;
}

/** Joins runs of the same kind, and drops empty parts. */
function merge(parts: readonly DiffPart[]): DiffPart[] {
  const merged: DiffPart[] = [];
  for (const part of parts) {
    if (!part.text) continue;
    const last = merged[merged.length - 1];
    if (last && last.kind === part.kind) last.text += part.text;
    else merged.push({ ...part });
  }
  return merged;
}
