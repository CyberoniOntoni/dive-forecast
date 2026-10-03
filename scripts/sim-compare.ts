import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { parseWall } from "../lib/forecast";
import { loadSite, type SiteLoad } from "../lib/load-site";
import { readCatalog } from "../lib/store";
import type { HourForecast, Site, Strength } from "../lib/types";

/**
 * Compares the shallow-water simulation in sim/ with the forecast the app shows, site by site, over the hours the
 * simulation covers. Research only: nothing here feeds the forecast.
 *
 *   python3 sim/fetch_terrain.py && python3 sim/grid.py && python3 sim/forcing.py && python3 sim/swe.py && python3 sim/export.py
 *   npm run sim-compare
 *
 * Both models get the same ocean: Open-Meteo is stubbed with the same 90-day series the simulation's edges come
 * from (sim/marine.py's cache, sim/cache/marine/). Every point the forecast asks for (a site's seaward sample point,
 * the atoll ring points) gets that point's own ocean-model cell over the simulated window, fetched once with curl
 * if sim/forcing.py did not already fetch it. With SIM_CASE=uniform every point gets the east edge's series at its
 * latitude instead, as the simulation's edges do in that case.
 *
 * The simulated current is projected on the axis the app shows for the site: the inward bearing at a channel,
 * the reef heading at a wall, the main axis in the lagoon, the strait's axis at a strait wall. Positive is
 * "incoming" (toward that heading). Its strength uses the strait bands, the one set the app keeps in real m/s.
 * Writes sim/out/<case>/compare.json and prints a summary.
 */

/** The forcing case (sim/domain.py): "chain" (west and east edges at their own levels) or "uniform" (one level). */
const CASE = process.env.SIM_CASE || "chain";
const SIM = path.join(process.cwd(), "sim", "out", CASE);
const ATOLLS = ["north-male", "south-male"];
const CACHE = path.join(process.cwd(), "sim", "cache", "marine");
const CELL_DEG = 1 / 12;
/** The forcing's window and edges (sim/domain.py), read from forcing.json. */
type Forcing = { start: string; lats: number[]; edge_lon: { west: number; east: number }; hours: { time: string }[] };
const forcing = JSON.parse(fs.readFileSync(path.join(SIM, "forcing.json"), "utf8")) as Forcing;
const WINDOW = [forcing.start.slice(0, 10), forcing.hours[forcing.hours.length - 1].time.slice(0, 10)];
const shift = (wall: string, hours: number) => new Date(parseWall(wall) + hours * 3_600_000).toISOString().slice(0, 16);
/** The first day is the simulation's spin-up; the forecast has no 25-hour mean in its last 12 hours. */
const FROM = shift(forcing.start, 24);
const TO = shift(forcing.hours[forcing.hours.length - 1].time, -12);
/** The app's real-speed bands (STRAIT_BANDS_MS), used for the simulated speed. */
const SIM_BANDS = { slack: 0.2, mild: 0.6, strong: 1.3 };
/** Below this the simulation's direction is not counted. */
const SIM_CALM_MS = 0.05;
const RANK: Record<Strength, number> = { slack: 0, mild: 1, strong: 2, too_strong: 3 };

type SimHour = { time: string; eta: number; u: number; v: number };
type SimSite = { id: string; cell: [number, number]; offsetM: number; depthM: number; hours: SimHour[] };
type Kind = "channel" | "along-reef" | "lagoon" | "strait";

/** The ocean-model cell a point falls in, as sim/marine.py keys its cache. */
function cellKey(lat: number, lon: number): string {
  const snap = (x: number) => Math.round((x - CELL_DEG / 2) / CELL_DEG) * CELL_DEG + CELL_DEG / 2;
  return `${snap(lat).toFixed(4)}_${snap(lon).toFixed(4)}`;
}

/** Open-Meteo's answer for a point over the window, from sim/marine.py's cache or fetched into it. */
function marineBody(lat: number, lon: number): string {
  const file = path.join(CACHE, `${WINDOW[0]}_${WINDOW[1]}_${cellKey(lat, lon)}.json`);
  if (!fs.existsSync(file)) {
    const query = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lon.toFixed(4),
      hourly: "sea_level_height_msl,ocean_current_velocity,ocean_current_direction",
      cell_selection: "sea",
      timezone: "Indian/Maldives",
      start_date: WINDOW[0],
      end_date: WINDOW[1],
    });
    // curl, not fetch: it goes through the machine's proxy settings, and fetch is stubbed below.
    const body = execFileSync("curl", ["-sS", "--fail", "--retry", "4", `https://marine-api.open-meteo.com/v1/marine?${query}`], { encoding: "utf8" });
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(file, body);
  }
  return fs.readFileSync(file, "utf8");
}

function stubOpenMeteo() {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const lat = Number(url.searchParams.get("latitude"));
    let lon = Number(url.searchParams.get("longitude"));
    // The uniform case: the east edge's level at this latitude, as the simulation's west edge gets.
    if (CASE === "uniform") lon = forcing.edge_lon.east;
    return new Response(marineBody(lat, lon), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

function kindOf(site: Site, load: SiteLoad): Kind {
  if (site.siteType === "strait-wall") return "strait";
  if (load.alongHeadingDeg == null) return "channel";
  return site.siteType === "lagoon" ? "lagoon" : "along-reef";
}

function simStrength(speed: number): Strength {
  if (speed < SIM_BANDS.slack) return "slack";
  if (speed < SIM_BANDS.mild) return "mild";
  if (speed < SIM_BANDS.strong) return "strong";
  return "too_strong";
}

const signed = (hour: HourForecast) => (hour.direction === "incoming" ? 1 : -1) * RANK[hour.strength];

function correlation(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 3) return Number.NaN;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let k = 0; k < n; k += 1) {
    sab += (a[k] - ma) * (b[k] - mb);
    saa += (a[k] - ma) ** 2;
    sbb += (b[k] - mb) ** 2;
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : Number.NaN;
}

type Row = {
  id: string;
  name: string;
  atoll: string;
  kind: Kind;
  axisDeg: number;
  offsetM: number;
  depthM: number;
  hours: number;
  /** Hours both call non-slack in which they agree on direction, of those hours. */
  direction: number;
  directionHours: number;
  /** Same band, of all hours. */
  strength: number;
  /** Correlation of the forecast's signed strength with the simulated along-axis current, lag 0. */
  correlation: number;
  /** The lag (hours, positive = the forecast runs late) at which that correlation peaks, and its value. */
  bestLag: number;
  bestCorrelation: number;
  /** Simulated current along the axis: share of hours incoming, and its 95th-percentile speed. */
  simIncoming: number;
  simP95: number;
  /** The forecast's share of hours incoming, of its non-slack hours. */
  forecastIncoming: number;
  forecastStrength: Record<Strength, number>;
  simStrength: Record<Strength, number>;
  /** Hour by hour: the forecast's signed strength (-3 very strong out … +3 very strong in) and the simulated m/s. */
  series: { time: string; forecast: number; sim: number }[];
};

async function main() {
  const simFile = path.join(SIM, "sites.json");
  if (!fs.existsSync(simFile)) throw new Error(`no ${simFile}: run the simulation first (see the header)`);
  const sim = JSON.parse(fs.readFileSync(simFile, "utf8")) as { sites: SimSite[] };
  const catalog = readCatalog();
  process.env.MARINE_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sim-compare-"));
  stubOpenMeteo();
  // The forecast treats a series as stale 12 hours after its last hour.
  const now = parseWall(shift(forcing.hours[forcing.hours.length - 1].time, -11));
  Date.now = () => now;

  const rows: Row[] = [];
  const projected = new Map<string, Map<string, number>>();
  for (const simSite of sim.sites) {
    const site = catalog.sites.find((item) => item.id === simSite.id);
    if (!site || !ATOLLS.includes(site.atollId)) continue;
    const atoll = catalog.atolls.find((item) => item.id === site.atollId);
    const load = await loadSite(site, catalog.sites, atoll, []);
    if (load.unavailable || load.bearing == null) {
      console.warn(`${site.id}: forecast unavailable`);
      continue;
    }
    const kind = kindOf(site, load);
    const axisDeg = load.alongHeadingDeg ?? load.bearing;
    const rad = (axisDeg * Math.PI) / 180;
    const along = new Map(simSite.hours.map((hour) => [hour.time, hour.u * Math.sin(rad) + hour.v * Math.cos(rad)]));
    projected.set(site.id, along);
    const pairs = load.hours
      .filter((hour) => hour.time >= FROM && hour.time <= TO && along.has(hour.time))
      .map((hour) => ({ hour, p: along.get(hour.time)! }));
    const both = pairs.filter(({ hour, p }) => hour.strength !== "slack" && Math.abs(p) >= SIM_CALM_MS);
    const agree = both.filter(({ hour, p }) => (hour.direction === "incoming") === p > 0).length;
    const sameBand = pairs.filter(({ hour, p }) => simStrength(Math.abs(p)) === hour.strength).length;
    const series = pairs.map(({ hour }) => signed(hour));
    const simSeries = pairs.map(({ p }) => p);
    let bestLag = 0;
    let bestCorrelation = Number.NEGATIVE_INFINITY;
    for (let lag = -6; lag <= 6; lag += 1) {
      // Forecast at hour t against the simulation at t - lag: a positive lag means the forecast turns later.
      const a: number[] = [];
      const b: number[] = [];
      pairs.forEach(({ hour }, index) => {
        const other = pairs[index - lag];
        if (other) {
          a.push(signed(hour));
          b.push(other.p);
        }
      });
      const c = correlation(a, b);
      if (c > bestCorrelation) {
        bestCorrelation = c;
        bestLag = lag;
      }
    }
    const count = (values: Strength[]) =>
      Object.fromEntries((["slack", "mild", "strong", "too_strong"] as Strength[]).map((s) => [s, values.filter((v) => v === s).length])) as Record<Strength, number>;
    const speeds = simSeries.map(Math.abs).sort((a, b) => a - b);
    const moving = pairs.filter(({ hour }) => hour.strength !== "slack");
    rows.push({
      id: site.id,
      name: site.name,
      atoll: site.atollId,
      kind,
      axisDeg: Math.round(axisDeg),
      offsetM: simSite.offsetM,
      depthM: simSite.depthM,
      hours: pairs.length,
      direction: both.length ? agree / both.length : Number.NaN,
      directionHours: both.length,
      strength: pairs.length ? sameBand / pairs.length : Number.NaN,
      correlation: correlation(series, simSeries),
      bestLag,
      bestCorrelation,
      simIncoming: simSeries.filter((p) => p > 0).length / Math.max(simSeries.length, 1),
      simP95: speeds[Math.floor(0.95 * (speeds.length - 1))] ?? Number.NaN,
      forecastIncoming: moving.filter(({ hour }) => hour.direction === "incoming").length / Math.max(moving.length, 1),
      forecastStrength: count(pairs.map(({ hour }) => hour.strength)),
      simStrength: count(simSeries.map((p) => simStrength(Math.abs(p)))),
      series: pairs.map(({ hour, p }) => ({ time: hour.time, forecast: signed(hour), sim: Math.round(p * 1000) / 1000 })),
    });
  }

  const bench = benchmark(projected);
  fs.writeFileSync(path.join(SIM, "compare.json"), JSON.stringify({ from: FROM, to: TO, rows, benchmark: bench }, null, 1));
  print(rows, bench);
}

type BenchRow = { id: string; siteId: string; time: string; expected: string; sim: number | null };

/** The curated fixtures (not real dives) that fall inside the simulated hours, against the simulated direction. */
function benchmark(projected: Map<string, Map<string, number>>): BenchRow[] {
  const file = path.join(process.cwd(), "data", "benchmark-reports.json");
  const reports = (JSON.parse(fs.readFileSync(file, "utf8")) as { reports: { id: string; siteId: string; time: string; direction: string; isOutlier?: boolean }[] }).reports;
  return reports
    .filter((report) => projected.has(report.siteId) && report.time >= FROM && report.time <= TO && !report.isOutlier)
    .map((report) => {
      const hour = `${report.time.slice(0, 13)}:00`;
      return { id: report.id, siteId: report.siteId, time: report.time, expected: report.direction, sim: projected.get(report.siteId)?.get(hour) ?? null };
    });
}

const pctOf = (value: number) => (Number.isFinite(value) ? `${Math.round(100 * value)} %` : "–");
const median = (values: number[]) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : Number.NaN;
};

function print(rows: Row[], bench: BenchRow[]) {
  console.log(`\nSimulation vs forecast, ${FROM} to ${TO}, ${rows.length} sites\n`);
  console.log("| Kind | Sites | Direction agrees (hours both run) | Same band | Correlation | Best lag (h) | Sim p95 m/s | Sim incoming | Forecast incoming |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const kind of ["channel", "along-reef", "lagoon", "strait"] as Kind[]) {
    const group = rows.filter((row) => row.kind === kind);
    if (!group.length) continue;
    const agreeHours = group.reduce((s, row) => s + (Number.isFinite(row.direction) ? row.direction * row.directionHours : 0), 0);
    const bothHours = group.reduce((s, row) => s + row.directionHours, 0);
    console.log(
      `| ${kind} | ${group.length} | ${pctOf(agreeHours / bothHours)} | ${pctOf(median(group.map((r) => r.strength)))} | ` +
        `${median(group.map((r) => r.correlation)).toFixed(2)} | ${median(group.map((r) => r.bestLag))} | ` +
        `${median(group.map((r) => r.simP95)).toFixed(2)} | ${pctOf(median(group.map((r) => r.simIncoming)))} | ${pctOf(median(group.map((r) => r.forecastIncoming)))} |`,
    );
  }
  console.log("\nDirection agrees, by month (hours both run):");
  const months = [...new Set(rows.flatMap((row) => row.series.map((x) => x.time.slice(0, 7))))].sort();
  console.log(`| Kind | ${months.join(" | ")} |`);
  console.log(`|---|${months.map(() => "---").join("|")}|`);
  for (const kind of ["channel", "along-reef", "lagoon", "strait"] as Kind[]) {
    const group = rows.filter((row) => row.kind === kind);
    if (!group.length) continue;
    const cells = months.map((month) => {
      const both = group.flatMap((row) => row.series).filter((x) => x.time.startsWith(month) && x.forecast !== 0 && Math.abs(x.sim) >= SIM_CALM_MS);
      return pctOf(both.filter((x) => x.forecast > 0 === x.sim > 0).length / both.length);
    });
    console.log(`| ${kind} | ${cells.join(" | ")} |`);
  }
  console.log("\nPer site (direction agreement, correlation, best lag, sim p95):");
  for (const row of [...rows].sort((a, b) => a.kind.localeCompare(b.kind) || a.direction - b.direction)) {
    console.log(
      `  ${row.kind.padEnd(10)} ${row.atoll.padEnd(10)} ${row.name.slice(0, 28).padEnd(28)} dir ${pctOf(row.direction).padStart(5)}` +
        ` r ${row.correlation.toFixed(2).padStart(5)} lag ${String(row.bestLag).padStart(2)} (r ${row.bestCorrelation.toFixed(2)})` +
        ` sim p95 ${row.simP95.toFixed(2)} m/s, in ${pctOf(row.simIncoming)} / forecast in ${pctOf(row.forecastIncoming)}` +
        ` [cell ${row.offsetM} m off, ${row.depthM} m deep]`,
    );
  }
  if (bench.length) {
    console.log("\nBenchmark fixtures in the window (curated scenarios, not dives):");
    for (const row of bench) {
      const sim = row.sim == null ? "–" : `${row.sim > 0 ? "incoming" : "outgoing"} ${Math.abs(row.sim).toFixed(2)} m/s`;
      console.log(`  ${row.siteId} ${row.time} expected ${row.expected}, simulation ${sim}`);
    }
    const scored = bench.filter((row) => row.sim != null && Math.abs(row.sim) >= SIM_CALM_MS);
    const hits = scored.filter((row) => (row.expected === "incoming") === row.sim! > 0).length;
    console.log(`  simulation agrees on ${hits}/${scored.length}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
