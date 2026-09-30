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

/**
 * Words that name the kind of site rather than the site, so "Fotteyo" matches "Fotteyo Kandu", each mapped to its
 * kind. Two names that both say their kind must agree on it: Kandooma Caves is not Kandooma Thila.
 */
const KIND_WORDS = new Map<string, string>(
  // Keys go through normalizeName like the names they are compared with ("reef" becomes "rif").
  (
    [
      ["kandu", "kandu"],
      ["express", "kandu"], // an "express" is a kandu drift
      ["tila", "tila"],
      ["giri", "giri"],
      ["faru", "faru"],
      ["reef", "reef"],
      ["house", "house reef"],
      ["housereef", "house reef"],
      ["wreck", "wreck"],
      ["point", "point"],
      ["caves", "caves"],
      ["cave", "caves"],
      ["corner", "corner"],
    ] as const
  ).map(([word, kind]) => [normalizeName(word), kind]),
);

/** The kinds a name states; "house reef" is one kind, not two. */
function kindsOf(words: readonly string[]): Set<string> {
  const kinds = new Set(words.flatMap((word) => (KIND_WORDS.has(word) ? [KIND_WORDS.get(word)!] : [])));
  if (kinds.has("house reef")) kinds.delete("reef");
  return kinds;
}

function bigrams(text: string): string[] {
  const compact = text.replace(/ /g, "");
  return Array.from({ length: Math.max(0, compact.length - 1) }, (_, i) => compact.slice(i, i + 2));
}

/**
 * 0 to 1. The distinctive words of one name all in the other counts as 1; otherwise bigram overlap (Dice).
 * Names that both state a kind of site, and disagree on it, are different sites: at most 0.5.
 */
export function nameSimilarity(a: string, b: string): number {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftKinds = kindsOf(left.split(" "));
  const rightKinds = kindsOf(right.split(" "));
  const kindsClash =
    leftKinds.size > 0 && rightKinds.size > 0 && ![...leftKinds].some((kind) => rightKinds.has(kind));
  if (kindsClash) return Math.min(0.5, bigramSimilarity(left, right));
  const distinct = (text: string) => text.split(" ").filter((word) => word && !KIND_WORDS.has(word));
  const leftWords = distinct(left);
  const rightWords = distinct(right);
  if (leftWords.length > 0 && rightWords.length > 0) {
    const [short, long] = leftWords.length <= rightWords.length ? [leftWords, rightWords] : [rightWords, leftWords];
    if (short.every((word) => long.includes(word))) return 1;
  }
  return bigramSimilarity(left, right);
}

/** Dice coefficient on letter pairs, spaces ignored. */
function bigramSimilarity(left: string, right: string): number {
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
  let closestExact = false;
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
    // A match beats a review; then the same name spelled the same way (Fesdu Wreck over Fesdhoo); then the nearer.
    const exact = normalizeName(guide.name) === normalizeName(site.name);
    const better =
      closest.kind === "new" ||
      (verdict.kind === "match" && closest.kind !== "match") ||
      (verdict.kind === closest.kind && (exact !== closestExact ? exact : km < closestKm));
    if (better) {
      closest = verdict;
      closestKm = km;
      closestExact = exact;
    }
  }
  return closest;
}

/**
 * Seeded atolls each guide atoll code belongs to. Only needed where two seeded atolls share one outline
 * (North and South Ari, one OSM atoll): the administrative code, not the nearer ocean point, decides.
 */
const GUIDE_ATOLL_IDS: Record<string, readonly string[]> = {
  AA: ["north-ari", "rasdhoo"],
  ADh: ["south-ari"],
};

/**
 * The atoll a guide site belongs to, given the one its position picked. When that atoll shares its outline with
 * another and the guide's atoll code names the other, the other wins.
 */
export function atollForGuideCode<T extends { id: string; rimSourceUrl: string }>(
  picked: T,
  atolls: readonly T[],
  atollCode: string,
): T {
  const wanted = GUIDE_ATOLL_IDS[atollCode];
  if (!wanted || wanted.includes(picked.id)) return picked;
  return atolls.find((atoll) => atoll.rimSourceUrl === picked.rimSourceUrl && wanted.includes(atoll.id)) ?? picked;
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
