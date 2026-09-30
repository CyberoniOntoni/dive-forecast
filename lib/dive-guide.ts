/** Matching and parsing for the dive-guide import (scripts/import-dive-guide.ts). */

/** Same site when a name matches and the pins are this close. */
export const MATCH_KM = 1.5;
/** A similar name this far away, or a different name this close, needs a person to decide. */
export const REVIEW_KM = 5;
const SIMILAR = 0.72;

/** Lower case, letters and digits only, with the spelling swaps Maldivian names go through in English. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/dh/g, "d")
    .replace(/th/g, "t")
    .replace(/oo/g, "u")
    .replace(/ee/g, "i")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words that name the kind of site rather than the site, so "Fotteyo" matches "Fotteyo Kandu". */
const KIND_WORDS = new Set(["kandu", "tila", "giri", "faru", "reef", "house", "wreck", "point", "caves", "cave", "corner"]);

function bigrams(text: string): string[] {
  const compact = text.replace(/ /g, "");
  return Array.from({ length: Math.max(0, compact.length - 1) }, (_, i) => compact.slice(i, i + 2));
}

/** 0 to 1. The distinctive words of one name all in the other counts as 1; otherwise bigram overlap (Dice). */
export function nameSimilarity(a: string, b: string): number {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const distinct = (text: string) => text.split(" ").filter((word) => word && !KIND_WORDS.has(word));
  const leftWords = distinct(left);
  const rightWords = distinct(right);
  if (leftWords.length > 0 && rightWords.length > 0) {
    const [short, long] = leftWords.length <= rightWords.length ? [leftWords, rightWords] : [rightWords, leftWords];
    if (short.every((word) => long.includes(word))) return 1;
  }
  const x = bigrams(left);
  const y = bigrams(right);
  if (x.length === 0 || y.length === 0) return 0;
  const pool = [...y];
  let shared = 0;
  for (const pair of x) {
    const at = pool.indexOf(pair);
    if (at >= 0) {
      shared += 1;
      pool.splice(at, 1);
    }
  }
  return (2 * shared) / (x.length + y.length);
}

export type MatchVerdict =
  | { kind: "match"; siteId: string; km: number; similarity: number }
  | { kind: "review"; siteId: string; km: number; similarity: number; reason: string }
  | { kind: "new" };

/** Compares a guide site with the seeded sites: the same site, one a person must look at, or a new one. */
export function matchGuideSite(
  guide: { name: string; lat: number; lon: number },
  sites: readonly { id: string; name: string; lat: number; lon: number }[],
): MatchVerdict {
  let closest: MatchVerdict = { kind: "new" };
  let closestKm = Number.POSITIVE_INFINITY;
  for (const site of sites) {
    const km = distanceKm(guide.lat, guide.lon, site.lat, site.lon);
    const similarity = nameSimilarity(guide.name, site.name);
    const similar = similarity >= SIMILAR;
    let verdict: MatchVerdict | null = null;
    if (similar && km <= MATCH_KM) verdict = { kind: "match", siteId: site.id, km, similarity };
    else if (similar && km <= REVIEW_KM) {
      verdict = { kind: "review", siteId: site.id, km, similarity, reason: "similar name, pins apart" };
    } else if (km <= MATCH_KM / 3) {
      verdict = { kind: "review", siteId: site.id, km, similarity, reason: "different name, same spot" };
    }
    if (!verdict) continue;
    // A match beats a review; otherwise the nearer one wins.
    const better =
      closest.kind === "new" || (verdict.kind === "match" && closest.kind !== "match") || (verdict.kind === closest.kind && km < closestKm);
    if (better) {
      closest = verdict;
      closestKm = km;
    }
  }
  return closest;
}

/** "6m - 25m" → top 6, max 25; "30m" → max 30; blank or unreadable → neither. */
export function parseDepthRange(text: string | null): { diveTopM?: number; diveMaxM?: number } {
  if (!text) return {};
  const numbers = [...text.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0])).filter((n) => n > 0 && n < 200);
  if (numbers.length === 0) return {};
  if (numbers.length === 1) return { diveMaxM: numbers[0] };
  return { diveTopM: Math.min(...numbers), diveMaxM: Math.max(...numbers) };
}

/** kebab-case id from a name, with a numeric suffix when it is taken. */
export function siteIdFor(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "site";
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const x = (lon2 - lon1) * rad * Math.cos(((lat1 + lat2) / 2) * rad);
  const y = (lat2 - lat1) * rad;
  return 6371 * Math.hypot(x, y);
}
