import { resolveBearing } from "../lib/bearing";
import { STRAIT_BANDS_MS, STRAIT_DRIFT_GAIN, STRAIT_TIDE_GAIN, straitFlow } from "../lib/forecast";
import { seawardPoint } from "../lib/marine";
import { rimForAtoll } from "../lib/rim";
import { straitHeading } from "../lib/site-type";
import { readCatalog } from "../lib/store";
import type { MarineHour, Site } from "../lib/types";
import { limited, longSeries } from "./long-series";

/**
 * Checks and calibrates the strait-wall model (HYDRODYNAMICS_PLAN §4.11) on about 99 days of ocean data, against the
 * owner's account of Vaadhoo Kandu:
 * - the monsoon sets the main direction (east in the SW monsoon, which this window covers);
 * - the rising tide pushes east and the falling tide pulls west;
 * - mild days run 0.4–0.8 m/s, spring tides with the monsoon 1.0–1.8 m/s and reach very strong.
 *
 *   npm run strait-calibrate
 *
 * For a sweep of the tide and drift gains it prints the share of hours running east, east at mid-flood and west at
 * mid-ebb, the daily peak speed on neap and spring days, and how the bands fall.
 */
const SWEEP: [number, number][] = [
  [4, 2],
  [2, 2.5],
  [2, 3],
  [2.5, 3],
  [2.5, 3.5],
  [3, 3.5],
  [3, 4],
];
const CHUNK_HOURS = 8 * 24;

type Wall = { site: Site; axis: number; hours: MarineHour[] };

const quantile = (values: number[], q: number) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : Number.NaN;
};
const pct = (part: number, total: number) => `${total > 0 ? Math.round((100 * part) / total) : 0} %`;

function chunks(hours: readonly MarineHour[]): MarineHour[][] {
  const pieces: MarineHour[][] = [];
  for (let start = 0; start + 48 <= hours.length; start += CHUNK_HOURS) pieces.push(hours.slice(start, start + CHUNK_HOURS));
  return pieces;
}

async function loadWalls(): Promise<Wall[]> {
  const catalog = readCatalog();
  const sites = catalog.sites.filter((site) => site.siteType === "strait-wall");
  const loaded = await limited(
    sites.map((site) => async () => {
      const atoll = catalog.atolls.find((item) => item.id === site.atollId);
      if (!atoll) return null;
      const { deg } = resolveBearing(site, catalog.sites, { lat: atoll.oceanLat, lon: atoll.oceanLon }, rimForAtoll(atoll));
      const point = seawardPoint(site.lat, site.lon, deg);
      const hours = await longSeries(point.lat, point.lon);
      return hours ? { site, axis: straitHeading(deg), hours } : null;
    }),
  );
  return loaded.filter((wall): wall is Wall => wall != null);
}

async function main(): Promise<void> {
  const walls = await loadWalls();
  console.log(`${walls.length} strait walls: ${walls.map((wall) => wall.site.name).join(", ")}.`);
  const band = (speed: number) =>
    speed < STRAIT_BANDS_MS.slack ? 0 : speed < STRAIT_BANDS_MS.mild ? 1 : speed < STRAIT_BANDS_MS.strong ? 2 : 3;
  console.log(`bands (m/s): slack < ${STRAIT_BANDS_MS.slack}, mild < ${STRAIT_BANDS_MS.mild}, strong < ${STRAIT_BANDS_MS.strong}, very strong above\n`);
  console.log("tide/drift gain | east hours | east at mid-flood | west at mid-ebb | daily peak m/s: neap p50, all p50, spring p50, p90 | hours slack/mild/strong/very | days very strong");
  for (const [tide, drift] of SWEEP) {
    let east = 0;
    let total = 0;
    let floodEast = 0;
    let floodTotal = 0;
    let ebbWest = 0;
    let ebbTotal = 0;
    const bands = [0, 0, 0, 0];
    const peaks: { peak: number; range: number }[] = [];
    for (const wall of walls) {
      for (const piece of chunks(wall.hours)) {
        const flow = straitFlow({ hours: piece, axisDeg: wall.axis }, { tide, drift });
        if (flow.length === 0) continue;
        const steepest = Math.max(...flow.map((hour) => Math.abs(hour.slope)));
        const days = new Map<string, { peak: number; low: number; high: number }>();
        for (const hour of flow) {
          total += 1;
          if (hour.speedMs > 0) east += 1;
          bands[band(Math.abs(hour.speedMs))] += 1;
          if (hour.slope >= 0.6 * steepest) {
            floodTotal += 1;
            if (hour.speedMs > 0) floodEast += 1;
          }
          if (hour.slope <= -0.6 * steepest) {
            ebbTotal += 1;
            if (hour.speedMs < 0) ebbWest += 1;
          }
          const key = hour.time.slice(0, 10);
          const day = days.get(key) ?? { peak: 0, low: Infinity, high: -Infinity };
          day.peak = Math.max(day.peak, Math.abs(hour.speedMs));
          day.low = Math.min(day.low, hour.levelM);
          day.high = Math.max(day.high, hour.levelM);
          days.set(key, day);
        }
        for (const day of days.values()) peaks.push({ peak: day.peak, range: day.high - day.low });
      }
    }
    const ranges = peaks.map((item) => item.range);
    const neapCut = quantile(ranges, 0.25);
    const springCut = quantile(ranges, 0.75);
    const neap = peaks.filter((item) => item.range <= neapCut).map((item) => item.peak);
    const spring = peaks.filter((item) => item.range >= springCut).map((item) => item.peak);
    const all = peaks.map((item) => item.peak);
    const veryDays = all.filter((peak) => peak >= STRAIT_BANDS_MS.strong).length;
    console.log(
      `${`${tide}/${drift}`.padEnd(15)} | ${pct(east, total).padStart(10)} | ${pct(floodEast, floodTotal).padStart(17)} | ${pct(ebbWest, ebbTotal).padStart(15)} | ${quantile(neap, 0.5).toFixed(2)}, ${quantile(all, 0.5).toFixed(2)}, ${quantile(spring, 0.5).toFixed(2)}, ${quantile(all, 0.9).toFixed(2)} | ${bands.map((count) => pct(count, total)).join(" / ")} | ${pct(veryDays, all.length)}`,
    );
  }
  console.log(`\nShipped: tide ${STRAIT_TIDE_GAIN}, drift ${STRAIT_DRIFT_GAIN}.`);
}

void main();
