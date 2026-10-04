/** Spacing of the across-channel transect, metres. */
export const GAP_STEP_M = 10;

/** A gap narrower than this is a hole in the reef map, not a channel. */
export const MIN_GAP_M = 100;

/** How far either side of the pin the gap may start, in transect steps. */
const SEARCH_STEPS = 50;

/**
 * Width of the open-water gap nearest the middle of a transect, metres.
 * `reefTop[i]` is true where sample i lies on reef crest or reef flat. The gap must have reef on
 * both sides inside the transect, otherwise the edge was not found and the result is null.
 */
export function gapWidthM(reefTop: readonly boolean[], stepM = GAP_STEP_M): number | null {
  const n = reefTop.length;
  if (n < 3) return null;
  const mid = Math.floor((n - 1) / 2);
  for (let off = 0; off <= SEARCH_STEPS; off += 1) {
    for (const at of off === 0 ? [mid] : [mid - off, mid + off]) {
      if (at < 0 || at >= n || reefTop[at]) continue;
      let lo = at;
      let hi = at;
      while (lo > 0 && !reefTop[lo - 1]) lo -= 1;
      while (hi < n - 1 && !reefTop[hi + 1]) hi += 1;
      const width = (hi - lo + 1) * stepM;
      if (width < MIN_GAP_M) continue;
      if (lo === 0 || hi === n - 1) return null;
      return width;
    }
  }
  return null;
}
