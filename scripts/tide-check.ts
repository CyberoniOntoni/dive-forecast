import { netFlowSeries, residualLevels, toMaldivesWall } from "../lib/forecast";
import type { MarineHour } from "../lib/types";
import { limited, longSeries } from "./long-series";

/**
 * Checks the timing and size of the model's tide slope against the Maldives tide gauges (HYDRODYNAMICS_PLAN §4.13).
 *
 * For each UHSLC gauge it fetches the gauge's hourly levels (fast-delivery data, about one to two months behind) and
 * about 92 past days of Open-Meteo sea level at the gauge, and compares, over the hours both have:
 *
 * - the model's tide slope at each hour, exactly as the channel model computes it (netFlowSeries with no drift and no
 *   head, so only the tide part), against
 * - the gauge's real slope centred on the hour: half the change from the hour before to the hour after, of the
 *   gauge's residual (level less its 25 h mean, as the app does).
 *
 * At lags from −3 to +3 h it prints the correlation, how often the two agree on the sign while the gauge's water is
 * moving (|slope| ≥ 2 cm/h), and the model's size against the gauge's (least-squares ratio). The model is on time when
 * the best lag is 0; a lag of +1 means the model's slope at an hour matches the gauge an hour later (the model is
 * early), as v20 was. It exits 1 if any gauge's best lag is not 0 or its correlation there is under 0.95, so it can
 * run after a change to the slope or to the feed.
 *
 * Usage: npm run tide-check. Needs marine-api.open-meteo.com and uhslc.soest.hawaii.edu.
 */

type Gauge = { id: number; name: string; lat: number; lon: number };

/** UHSLC hourly gauges in the Maldives. The ids are UHSLC's (Gan is 109; 103 is another station). */
const GAUGES: Gauge[] = [
  { id: 117, name: "Hanimaadhoo", lat: 6.764, lon: 73.1725 },
  { id: 108, name: "Malé", lat: 4.187, lon: 73.525 },
  { id: 109, name: "Gan (Addu)", lat: -0.6878, lon: 73.152 },
];

const LAGS = [-3, -2, -1, 0, 1, 2, 3];
/** Gauge slope the sign test counts: below this the water is close to turning. */
const MOVING_M_PER_H = 0.02;
const MIN_CORRELATION = 0.95;
/** UHSLC's missing value, in millimetres. */
const MISSING_MM = -32767;

/** Gauge levels by Maldives wall time (YYYY-MM-DDTHH:00), metres. The CSV is year, month, day, hour (GMT), mm. */
async function gaugeLevels(gauge: Gauge): Promise<Map<string, number> | null> {
  const response = await fetch(`https://uhslc.soest.hawaii.edu/data/csv/fast/hourly/h${gauge.id}.csv`);
  if (!response.ok) return null;
  const levels = new Map<string, number>();
  for (const line of (await response.text()).split("\n")) {
    const parts = line.split(",").map((part) => Number(part.trim()));
    if (parts.length < 5 || parts.some((part) => !Number.isFinite(part))) continue;
    const [year, month, day, hour, mm] = parts;
    if (mm === MISSING_MM) continue;
    const utc = new Date(Date.UTC(year, month - 1, day, hour)).toISOString().slice(0, 19) + "Z";
    levels.set(toMaldivesWall(utc), mm / 1000);
  }
  return levels;
}

/** The model's tide slope at each hour: the channel model's net flow with no drift and no head across the atoll. */
function modelSlopes(hours: readonly MarineHour[]): (number | null)[] {
  const still = hours.map((hour) => ({ ...hour, currentVelocityMs: 0, currentDirectionDeg: 0 }));
  return netFlowSeries({ hours: still, inwardBearingDeg: 0 });
}

/** The gauge's slope centred on each hour of `times`, from its residual; null where an hour either side is missing. */
function gaugeSlopes(times: readonly string[], levels: Map<string, number>): (number | null)[] {
  const hours: MarineHour[] = times.map((time) => ({
    time,
    seaLevelM: levels.get(time) ?? null,
    currentVelocityMs: null,
    currentDirectionDeg: null,
  }));
  const residual = residualLevels(hours);
  return residual.map((_, index) => {
    const before = residual[index - 1];
    const after = residual[index + 1];
    return before == null || after == null ? null : (after - before) / 2;
  });
}

type LagRow = { lag: number; pairs: number; r: number; sign: number; ratio: number };

function compare(model: readonly (number | null)[], gauge: readonly (number | null)[], lag: number): LagRow {
  const xs: number[] = [];
  const ys: number[] = [];
  model.forEach((value, index) => {
    const truth = gauge[index + lag];
    if (value == null || truth == null) return;
    xs.push(value);
    ys.push(truth);
  });
  const n = xs.length;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  let xy = 0;
  let yy = 0;
  let moving = 0;
  let agree = 0;
  for (let index = 0; index < n; index += 1) {
    sxy += (xs[index] - mx) * (ys[index] - my);
    sxx += (xs[index] - mx) ** 2;
    syy += (ys[index] - my) ** 2;
    xy += xs[index] * ys[index];
    yy += ys[index] ** 2;
    if (Math.abs(ys[index]) >= MOVING_M_PER_H) {
      moving += 1;
      if (Math.sign(xs[index]) === Math.sign(ys[index])) agree += 1;
    }
  }
  return {
    lag,
    pairs: n,
    r: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : Number.NaN,
    sign: moving > 0 ? agree / moving : Number.NaN,
    // Model size against the gauge's: the least-squares factor taking the gauge slope to the model's.
    ratio: yy > 0 ? xy / yy : Number.NaN,
  };
}

async function checkGauge(gauge: Gauge): Promise<{ gauge: Gauge; rows: LagRow[] } | string> {
  const [levels, hours] = await Promise.all([gaugeLevels(gauge), longSeries(gauge.lat, gauge.lon)]);
  if (!levels || levels.size === 0) return `${gauge.name}: no gauge data from UHSLC`;
  if (!hours || hours.length === 0) return `${gauge.name}: no Open-Meteo sea level`;
  const model = modelSlopes(hours);
  const observed = gaugeSlopes(
    hours.map((hour) => hour.time),
    levels,
  );
  const rows = LAGS.map((lag) => compare(model, observed, lag));
  if (rows.every((row) => row.pairs < 48)) {
    const last = [...levels.keys()].sort().at(-1);
    return `${gauge.name}: under two days where the gauge (last hour ${last}) and the model overlap`;
  }
  return { gauge, rows };
}

const pct = (value: number) => (Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "  -  ");
const fixed = (value: number, digits = 3) => (Number.isFinite(value) ? value.toFixed(digits) : "  -  ");

async function main() {
  const results = await limited(GAUGES.map((gauge) => () => checkGauge(gauge)));
  let failed = false;
  for (const result of results) {
    if (typeof result === "string") {
      console.log(result);
      failed = true;
      continue;
    }
    const { gauge, rows } = result;
    console.log(`\n${gauge.name} (UHSLC ${gauge.id}), ${rows.find((row) => row.lag === 0)?.pairs ?? 0} hours`);
    console.log("  lag h     r     sign   size");
    for (const row of rows) {
      console.log(`  ${String(row.lag).padStart(5)}  ${fixed(row.r)}  ${pct(row.sign).padStart(6)}  ${fixed(row.ratio, 2)}`);
    }
    const best = rows.reduce((top, row) => (row.r > top.r ? row : top));
    const onTime = best.lag === 0 && best.r >= MIN_CORRELATION;
    if (!onTime) failed = true;
    const timing = best.lag === 0 ? "on time" : best.lag > 0 ? `${best.lag} h early` : `${-best.lag} h late`;
    console.log(`  best lag ${best.lag} h (${timing}), r ${fixed(best.r)}: ${onTime ? "ok" : "CHECK"}`);
  }
  console.log(failed ? "\nRESULT: CHECK (see above)" : "\nRESULT: PASS: the model's tide slope is on time at every gauge");
  process.exitCode = failed ? 1 : 0;
}

void main();
