export type OceanDrift = {
  velocityMs: number;
  directionDeg: number;
};

const V_BASE = 0.35;
const V_CALM = 0.05;
const V_SW_BOOST = 0.08;
const V_NE_BOOST = 0.05;

function smoothstep(t: number): number {
  return 3 * t * t - 2 * t * t * t;
}

/**
 * Seasonal ocean surface current drift model for the Maldives archipelago.
 *
 * Physical climatology:
 * - Southwest Monsoon (Hulhangu, May 1 - Oct 31):
 *   Eastward drift (heading ~90°), velocity ~0.35 - 0.43 m/s peaking in mid-summer (July).
 * - Northeast Monsoon (Iruvai, Dec 1 - Mar 31):
 *   Westward drift (heading ~270°), velocity ~0.35 - 0.40 m/s peaking in mid-winter (Jan/Feb).
 * - Spring Inter-Monsoon Transition (April 1 - Apr 30):
 *   Continuous transition (speed has no jump, though its rate of change does at the month edges) dipping to calm conditions (~0.05 m/s) with heading rotating 270° -> 90° via South (180°).
 * - Autumn Inter-Monsoon Transition (November 1 - Nov 30):
 *   Continuous transition (speed has no jump, though its rate of change does at the month edges) dipping to calm conditions (~0.05 m/s) with heading rotating 90° -> 270° via South (180°).
 *
 * Uses UTC date methods throughout to guarantee timezone invariance.
 */
export function getMaldivesMonsoonDrift(date: Date): OceanDrift {
  const timeMs = date instanceof Date ? date.getTime() : new Date(date).getTime();
  if (!Number.isFinite(timeMs)) {
    return { velocityMs: 0, directionDeg: 90 };
  }

  const d = new Date(timeMs);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0-indexed: 0=Jan, 3=Apr, 4=May, 9=Oct, 10=Nov, 11=Dec

  // Regime 1: Spring Inter-Monsoon Transition (April: month === 3)
  if (month === 3) {
    const t0 = Date.UTC(year, 3, 1, 0, 0, 0);
    const t1 = Date.UTC(year, 4, 1, 0, 0, 0);
    const tau = Math.min(1, Math.max(0, (timeMs - t0) / (t1 - t0)));
    const s = smoothstep(tau);
    const directionDeg = 270 - 180 * s;
    const velocityMs = V_CALM + (V_BASE - V_CALM) * Math.pow(Math.cos(Math.PI * tau), 2);
    return { velocityMs, directionDeg };
  }

  // Regime 2: Southwest Monsoon (May to October: month 4 to 9)
  if (month >= 4 && month <= 9) {
    const t0 = Date.UTC(year, 4, 1, 0, 0, 0);
    const t1 = Date.UTC(year, 10, 1, 0, 0, 0);
    const tau = Math.min(1, Math.max(0, (timeMs - t0) / (t1 - t0)));
    const velocityMs = V_BASE + V_SW_BOOST * Math.sin(Math.PI * tau);
    return { velocityMs, directionDeg: 90 };
  }

  // Regime 3: Autumn Inter-Monsoon Transition (November: month === 10)
  if (month === 10) {
    const t0 = Date.UTC(year, 10, 1, 0, 0, 0);
    const t1 = Date.UTC(year, 11, 1, 0, 0, 0);
    const tau = Math.min(1, Math.max(0, (timeMs - t0) / (t1 - t0)));
    const s = smoothstep(tau);
    const directionDeg = 90 + 180 * s;
    const velocityMs = V_CALM + (V_BASE - V_CALM) * Math.pow(Math.cos(Math.PI * tau), 2);
    return { velocityMs, directionDeg };
  }

  // Regime 4: Northeast Monsoon (December to March: month 11 or 0..2)
  const isDec = month === 11;
  const t0 = isDec ? Date.UTC(year, 11, 1, 0, 0, 0) : Date.UTC(year - 1, 11, 1, 0, 0, 0);
  const t1 = isDec ? Date.UTC(year + 1, 3, 1, 0, 0, 0) : Date.UTC(year, 3, 1, 0, 0, 0);
  const tau = Math.min(1, Math.max(0, (timeMs - t0) / (t1 - t0)));
  const velocityMs = V_BASE + V_NE_BOOST * Math.sin(Math.PI * tau);
  return { velocityMs, directionDeg: 270 };
}
