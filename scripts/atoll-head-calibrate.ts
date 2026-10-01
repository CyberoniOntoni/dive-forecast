import { ringLevelFromSeries, ringPoints } from "../lib/atoll-ring";
import { resolveBearing } from "../lib/bearing";
import { forecastHours, residualLevels, throughflowAt } from "../lib/forecast";
import { fetchMarine, siteMarineHours } from "../lib/marine";
import { rimForAtoll } from "../lib/rim";
import { flowsAlongReef } from "../lib/site-type";
import { readCatalog } from "../lib/store";
import { STRENGTHS, type MarineHour, type RingLevel, type Site } from "../lib/types";

/**
 * Checks and calibrates the head across the atoll (HYDRODYNAMICS_PLAN §4.8).
 *
 *   MARINE_CACHE_DIR=<fresh dir> npm run atoll-head-calibrate
 *
 * Fetches (or reads from the cache) twelve ring points round each atoll outline and every channel's sample point.
 * Point it at a fresh cache so all series come from one model run. It prints:
 * 1. whether the head (a channel's residual level less the ring level) is a smooth gradient: neighbouring channels on
 *    one rim agree, and opposite rims differ more than one rim does;
 * 2. whether the head is tidal: the share of its variance at M2, S2, K1 and O1;
 * 3. for a sweep of tau, how often opposite-rim channels run opposite ways at mid-tide, how much of the country runs
 *    the same way at once, and the facing / far-side shares the through-flow was calibrated on.
 */
const TAUS = [Number.POSITIVE_INFINITY, 2, 1, 0.5, 0.25, 0.15, 0.1];
const PERIODS_H = [12.4206, 12.0, 23.9345, 25.8193];

type Channel = {
  site: Site;
  bearing: number;
  hours: MarineHour[];
  head: (number | null)[];
  flux: number;
  ring: RingLevel[];
};

function correlation(left: readonly number[], right: readonly number[]): number {
  const n = left.length;
  if (n < 3) return Number.NaN;
  const ml = left.reduce((s, v) => s + v, 0) / n;
  const mr = right.reduce((s, v) => s + v, 0) / n;
  let c = 0;
  let vl = 0;
  let vr = 0;
  for (let i = 0; i < n; i += 1) {
    c += (left[i] - ml) * (right[i] - mr);
    vl += (left[i] - ml) ** 2;
    vr += (right[i] - mr) ** 2;
  }
  return c / Math.sqrt(vl * vr);
}

/** Share of a series' variance explained by a least-squares fit of the main tidal constituents plus a mean. */
function tidalShare(values: readonly number[]): number {
  if (values.length < 24) return Number.NaN;
  const rows = values.map((_, t) => [
    1,
    ...PERIODS_H.flatMap((p) => [Math.cos((2 * Math.PI * t) / p), Math.sin((2 * Math.PI * t) / p)]),
  ]);
  const k = rows[0].length;
  const ata = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const atb = new Array<number>(k).fill(0);
  rows.forEach((row, t) => {
    for (let i = 0; i < k; i += 1) {
      atb[i] += row[i] * values[t];
      for (let j = 0; j < k; j += 1) ata[i][j] += row[i] * row[j];
    }
  });
  // A small ridge: over a few days the four periods are only partly separable.
  for (let i = 0; i < k; i += 1) ata[i][i] += 1e-6;
  for (let i = 0; i < k; i += 1) {
    for (let j = i + 1; j < k; j += 1) {
      const f = ata[j][i] / ata[i][i];
      for (let m = i; m < k; m += 1) ata[j][m] -= f * ata[i][m];
      atb[j] -= f * atb[i];
    }
  }
  const x = new Array<number>(k).fill(0);
  for (let i = k - 1; i >= 0; i -= 1) {
    let s = atb[i];
    for (let j = i + 1; j < k; j += 1) s -= ata[i][j] * x[j];
    x[i] = s / ata[i][i];
  }
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const total = values.reduce((s, v) => s + (v - mean) ** 2, 0);
  const resid = values.reduce((s, v, t) => s + (v - rows[t].reduce((acc, r, i) => acc + r * x[i], 0)) ** 2, 0);
  return total > 0 ? 1 - resid / total : Number.NaN;
}

const km = (a: Site, b: Site) =>
  Math.hypot((a.lat - b.lat) * 110.57, (a.lon - b.lon) * 111.32 * Math.cos((a.lat * Math.PI) / 180));
const bearingGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
const quantile = (values: number[], q: number) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : Number.NaN;
};
const pct = (value: number) => (Number.isFinite(value) ? `${Math.round(100 * value)} %` : "n/a");

/** Paired values of two head series at the hours both have. */
function paired(a: Channel, b: Channel): [number[], number[]] {
  const byTime = new Map(b.hours.map((hour, index) => [hour.time, b.head[index]]));
  const left: number[] = [];
  const right: number[] = [];
  a.hours.forEach((hour, index) => {
    const x = a.head[index];
    const y = byTime.get(hour.time);
    if (x != null && y != null) {
      left.push(x);
      right.push(y);
    }
  });
  return [left, right];
}

async function loadChannels(): Promise<{ channels: Channel[]; atolls: number }> {
  const catalog = readCatalog();
  const channels: Channel[] = [];
  let atolls = 0;
  for (const atoll of catalog.atolls) {
    const ring = rimForAtoll(atoll);
    if (!ring) continue;
    const fetched = await Promise.all(ringPoints(ring).map((point) => fetchMarine(point.lat, point.lon)));
    const level = ringLevelFromSeries(fetched.flatMap((result) => (result.ok ? [result.hours] : [])));
    if (level.length === 0) continue;
    atolls += 1;
    const ringAt = new Map(level.map((item) => [item.time, item.levelM]));
    const outside = { lat: atoll.oceanLat, lon: atoll.oceanLon };
    for (const site of catalog.sites) {
      if (site.atollId !== atoll.id || !site.siteType || site.siteType === "lagoon") continue;
      if (flowsAlongReef(site, catalog.sites)) continue;
      const { deg } = resolveBearing(site, catalog.sites, outside, ring);
      const marine = await siteMarineHours(site.lat, site.lon, deg, outside.lat, outside.lon);
      if (!marine.ok) continue;
      const residual = residualLevels(marine.hours);
      const head = marine.hours.map((hour, index) => {
        const lagoon = ringAt.get(hour.time);
        const own = residual[index];
        return own == null || lagoon == null ? null : own - lagoon;
      });
      const fluxes = marine.hours
        .map((hour) => throughflowAt(marine.hours, hour.time, deg))
        .filter((value): value is number => value != null);
      const flux = fluxes.reduce((s, v) => s + v, 0) / Math.max(1, fluxes.length);
      channels.push({ site, bearing: deg, hours: marine.hours, head, flux, ring: level });
    }
  }
  return { channels, atolls };
}

function gradientCheck(channels: readonly Channel[]): void {
  const near: number[] = [];
  const sameRim: number[] = [];
  const opposite: number[] = [];
  for (let i = 0; i < channels.length; i += 1) {
    for (let j = i + 1; j < channels.length; j += 1) {
      const a = channels[i];
      const b = channels[j];
      if (a.site.atollId !== b.site.atollId) continue;
      const [x, y] = paired(a, b);
      if (x.length < 24) continue;
      const rms = Math.sqrt(x.reduce((s, v, k) => s + (v - y[k]) ** 2, 0) / x.length);
      const gap = bearingGap(a.bearing, b.bearing);
      if (gap <= 60 && km(a.site, b.site) < 10) {
        near.push(correlation(x, y));
        sameRim.push(rms);
      } else if (gap >= 120) {
        opposite.push(rms);
      }
    }
  }
  const heads = channels.flatMap((item) => item.head.filter((v): v is number => v != null).map(Math.abs));
  console.log("1. Is the head a smooth gradient?");
  console.log(`   |head| p50 ${quantile(heads, 0.5).toFixed(3)} m, p90 ${quantile(heads, 0.9).toFixed(3)} m`);
  console.log(`   neighbours on one rim (< 10 km): ${near.length} pairs, head correlation median ${quantile(near, 0.5).toFixed(2)} (gate ≥ 0.70)`);
  console.log(`   head difference RMS: same rim ${quantile(sameRim, 0.5).toFixed(3)} m, opposite rims ${quantile(opposite, 0.5).toFixed(3)} m (${opposite.length} pairs)\n`);
}

function tidalCheck(channels: readonly Channel[]): void {
  const shares = channels.map((item) => tidalShare(item.head.filter((v): v is number => v != null)));
  console.log("2. Is the head tidal?");
  console.log(`   share of head variance at M2/S2/K1/O1: median ${pct(quantile(shares, 0.5))}, p25 ${pct(quantile(shares, 0.25))}\n`);
}

/** The steepest-quarter hours of each channel's own tide: its mid-tide hours. */
function midTideHours(item: Channel): Set<string> {
  const residual = residualLevels(item.hours);
  const slopes = item.hours.map((_, i) =>
    residual[i] != null && residual[i + 1] != null ? (residual[i + 1] as number) - (residual[i] as number) : null,
  );
  const peak = Math.max(...slopes.map((s) => (s == null ? 0 : Math.abs(s))));
  return new Set(
    item.hours.filter((_, i) => slopes[i] != null && Math.abs(slopes[i] as number) >= 0.7 * peak).map((hour) => hour.time),
  );
}

function tauSweep(channels: readonly Channel[]): void {
  const strongHalf = (list: Channel[]) => {
    const sorted = [...list].sort((a, b) => Math.abs(a.flux) - Math.abs(b.flux));
    return new Set(sorted.slice(Math.floor(sorted.length / 2)).map((item) => item.site.id));
  };
  const facing = strongHalf(channels.filter((item) => item.flux > 0));
  const away = strongHalf(channels.filter((item) => item.flux < 0));
  const mid = new Map(channels.map((item) => [item.site.id, midTideHours(item)]));
  console.log("3. Tau sweep (∞ is today's model)");
  console.log("   tau h | opposite rims disagree, mid-tide | channels running the majority way | facing in | far side out | turns/day | slack  mild strong   too");
  for (const tau of TAUS) {
    const directions = new Map<string, Map<string, string>>();
    const bands = new Map<string, number>(STRENGTHS.map((s) => [s, 0]));
    let facingIn = 0;
    let facingTotal = 0;
    let awayOut = 0;
    let awayTotal = 0;
    const turns: number[] = [];
    for (const item of channels) {
      const forecast = forecastHours({
        hours: item.hours,
        inwardBearingDeg: item.bearing,
        ringLevel: item.ring,
        headTauHours: tau,
      });
      directions.set(item.site.id, new Map(forecast.map((hour) => [hour.time, hour.direction])));
      for (const hour of forecast) {
        bands.set(hour.strength, (bands.get(hour.strength) ?? 0) + 1);
        if (facing.has(item.site.id)) {
          facingTotal += 1;
          if (hour.direction === "incoming") facingIn += 1;
        }
        if (away.has(item.site.id)) {
          awayTotal += 1;
          if (hour.direction === "outgoing") awayOut += 1;
        }
      }
      const dirs = forecast.map((hour) => hour.direction);
      if (dirs.length) turns.push((dirs.slice(1).filter((d, i) => d !== dirs[i]).length * 24) / dirs.length);
    }
    let disagree = 0;
    let compared = 0;
    for (let i = 0; i < channels.length; i += 1) {
      for (let j = i + 1; j < channels.length; j += 1) {
        const a = channels[i];
        const b = channels[j];
        if (a.site.atollId !== b.site.atollId || bearingGap(a.bearing, b.bearing) < 120) continue;
        const da = directions.get(a.site.id)!;
        const db = directions.get(b.site.id)!;
        for (const time of mid.get(a.site.id)!) {
          const x = da.get(time);
          const y = db.get(time);
          if (!x || !y) continue;
          compared += 1;
          if (x !== y) disagree += 1;
        }
      }
    }
    const times = new Set(channels.flatMap((item) => [...directions.get(item.site.id)!.keys()]));
    const majority: number[] = [];
    for (const time of times) {
      let incoming = 0;
      let total = 0;
      for (const item of channels) {
        const d = directions.get(item.site.id)!.get(time);
        if (!d) continue;
        total += 1;
        if (d === "incoming") incoming += 1;
      }
      if (total >= channels.length / 2) majority.push(Math.max(incoming, total - incoming) / total);
    }
    const totalBands = [...bands.values()].reduce((s, v) => s + v, 0);
    const bandText = STRENGTHS.map((s) => pct((bands.get(s) ?? 0) / totalBands).padStart(5)).join(" ");
    console.log(
      `   ${String(tau).padStart(5)} | ${pct(disagree / compared).padStart(32)} | ${pct(quantile(majority, 0.5)).padStart(33)} | ${pct(facingIn / facingTotal).padStart(9)} | ${pct(awayOut / awayTotal).padStart(12)} | ${quantile(turns, 0.5).toFixed(1).padStart(9)} | ${bandText}`,
    );
  }
}

async function main(): Promise<void> {
  const { channels, atolls } = await loadChannels();
  console.log(`${atolls} atolls with a ring level, ${channels.length} channels.\n`);
  gradientCheck(channels);
  tidalCheck(channels);
  tauSweep(channels);
}

void main();
