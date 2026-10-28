/** Plane geometry shared by server and browser code (no file reads). */

/** How far along a segment (0 to 1) the foot of a point lies, given the point and the segment's end from its start. */
export function alongSegment(px: number, py: number, dx: number, dy: number): number {
  const lengthSq = dx * dx + dy * dy;
  return lengthSq === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSq));
}
