import { compassWord } from "./nowcast-glance";
import type { SeaStateHour } from "./types";

const KNOTS_PER_MS = 3600 / 1852;

/** "1.2 m swell from SW, 11 s · 0.4 m wind chop · wind 14 kt from W", leaving out waves too small to feel. */
export function seaDetail(sea: SeaStateHour): string {
  const parts: string[] = [];
  if (sea.swell) {
    const period = sea.swell.periodS == null ? "" : `, ${Math.round(sea.swell.periodS)} s`;
    parts.push(`${metres(sea.swell.heightM)} swell from ${compassWord(sea.swell.fromDeg)}${period}`);
  }
  if (sea.windWaveM >= 0.1) parts.push(`${metres(sea.windWaveM)} wind chop`);
  const waves = parts.length > 0 ? parts.join(" · ") : "no swell or wind chop to speak of";
  if (sea.wind == null) return waves;
  const knots = Math.round(sea.wind.speedMs * KNOTS_PER_MS);
  return `${waves} · ${knots < 2 ? "almost no wind" : `wind ${knots} kt from ${compassWord(sea.wind.fromDeg)}`}`;
}

export function metres(value: number): string {
  return `${(Math.round(value * 10) / 10).toFixed(1)} m`;
}
