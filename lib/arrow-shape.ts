import type { Strength } from "./types";

/** Arrow width, px on the pin. The head is this wide; the shaft tapers to a rounded tail. */
export const ARROW_WIDTH = 16;

/** Arrow length on the pin by strength: a short stub at slack, longest when very strong. */
export const ARROW_LENGTH: Record<Strength, number> = { slack: 14, mild: 20, strong: 26, too_strong: 32 };

/** The longest arrow, for boxes that must hold any strength. */
export const ARROW_MAX_LENGTH = ARROW_LENGTH.too_strong;

const HEAD_LENGTH = 10;
const HEAD_HALF = ARROW_WIDTH / 2 - 0.5;
/** Half the shaft's width where it leaves the head, and at the tail. */
const SHAFT_TOP_HALF = 2.4;
const SHAFT_TAIL_HALF = 1.3;
/** How far the back of the head sweeps forward of its wing tips. */
const HEAD_SWEEP = 2.6;

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * A slim tapered arrow pointing up (north before rotation), in a box ARROW_WIDTH wide and `length` tall. The tip is
 * at the top centre and the rounded tail at the bottom centre, where it meets the pin's dot. The wings curve slightly
 * and the back of the head sweeps forward, so it reads as flow rather than a block.
 */
export function arrowPath(length: number): string {
  const cx = ARROW_WIDTH / 2;
  const headBack = HEAD_LENGTH;
  const notch = HEAD_LENGTH - HEAD_SWEEP;
  const tailY = Math.max(notch + 1, length - SHAFT_TAIL_HALF);
  const points = [
    `M${round(cx)} 0`,
    `Q${round(cx + HEAD_HALF * 0.45)} ${round(headBack * 0.55)} ${round(cx + HEAD_HALF)} ${round(headBack)}`,
    `Q${round(cx + SHAFT_TOP_HALF + 1)} ${round(notch + 0.4)} ${round(cx + SHAFT_TOP_HALF)} ${round(notch)}`,
    `L${round(cx + SHAFT_TAIL_HALF)} ${round(tailY)}`,
    `A${SHAFT_TAIL_HALF} ${SHAFT_TAIL_HALF} 0 0 1 ${round(cx - SHAFT_TAIL_HALF)} ${round(tailY)}`,
    `L${round(cx - SHAFT_TOP_HALF)} ${round(notch)}`,
    `Q${round(cx - SHAFT_TOP_HALF - 1)} ${round(notch + 0.4)} ${round(cx - HEAD_HALF)} ${round(headBack)}`,
    `Q${round(cx - HEAD_HALF * 0.45)} ${round(headBack * 0.55)} ${round(cx)} 0`,
    "Z",
  ];
  return points.join(" ");
}

/**
 * The SVG for an arrow of this strength: filled with a thin dark edge for a measured or rim-derived heading, and a
 * see-through fill with a solid edge for an estimated one. Colour comes from `currentColor`.
 */
export function arrowSvgBody(strength: Strength, estimated: boolean): string {
  const path = arrowPath(ARROW_LENGTH[strength]);
  if (estimated) {
    return `<path d="${path}" fill="currentColor" fill-opacity="0.22" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>`;
  }
  return `<path d="${path}" fill="currentColor" stroke="var(--ink)" stroke-width="1" stroke-linejoin="round"/>`;
}
