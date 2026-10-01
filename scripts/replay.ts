import fs from "fs";
import path from "path";
import crypto from "crypto";
import { inwardBearingDeg } from "../lib/bearing";
import { rimForAtoll } from "../lib/rim";
import { marineCacheDir, marineHoursFromApi, seawardPoint } from "../lib/marine";
import { replayReports, type BenchmarkMetrics } from "../lib/replay";
import { alongReefHeading, flowsAlongReef } from "../lib/site-type";
import { listMergedSites, readCatalog, readStore } from "../lib/store";
import type { MarineHour, Report } from "../lib/types";

/** Committed fixture caches so CI can score benchmark reports without live Open-Meteo files. */
export const BENCHMARK_CACHE_DIR = path.join(process.cwd(), "data", "benchmark-marine-cache");
export const REPLAY_OUT_PATH = path.join(process.cwd(), "data", "replay.json");
export const BENCHMARK_OUT_PATH = path.join(process.cwd(), "data", "benchmark-results.json");
export const BENCHMARK_DATASET_PATH = path.join(process.cwd(), "data", "benchmark-reports.json");

export type SiteBenchmarkResult = {
  siteId: string;
  siteName: string;
  atollName: string;
  evaluatedReports: number;
  slackReports: number;
  slackDeviationSumMins: number;
  failures: number;
  strengthMismatches: number;
  directionalMatches: number;
  directionalAccuracyPct: number;
  slackTimingDeviationMins: number;
  falseHighConfidenceRatePct: number;
  ok: boolean;
};

export type BenchmarkRunResult = {
  ok: boolean;
  failures: number;
  strengthMismatches: number;
  metrics: BenchmarkMetrics;
  datasetName: string;
  evaluatedAt: string;
  siteResults: SiteBenchmarkResult[];
  siteNotFound?: boolean;
  error?: string;
};

export type ReplayCliOptions = {
  mode: "benchmark" | "store" | "custom";
  datasetPath?: string;
  outPath?: string;
  siteId?: string;
  quiet?: boolean;
  json?: boolean;
};

/** CLI entrypoint */
export async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const result = runBenchmarkSuite(options);

  if (result.siteNotFound || (options.siteId && result.siteResults.length === 0)) {
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    }
    process.exit(1);
  }

  if (!options.quiet && !options.json) {
    printFormattedReport(result);
  } else if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  }

  // Atomically write data/replay.json for load-site.ts integration
  writeAtomicJson(REPLAY_OUT_PATH, {
    ok: result.ok,
    failures: result.failures,
    strengthMismatches: result.strengthMismatches,
    metrics: result.metrics,
    evaluatedAt: result.evaluatedAt,
  });

  // If running in benchmark mode or outPath specified, also write benchmark-results.json
  if (options.mode === "benchmark" || options.outPath) {
    const targetOut = options.outPath ? path.resolve(options.outPath) : BENCHMARK_OUT_PATH;
    writeAtomicJson(targetOut, result);
  }

  process.exit(result.ok ? 0 : 1);
}

export function parseCliArgs(args: string[]): ReplayCliOptions {
  const options: ReplayCliOptions = { mode: "store" };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--benchmark" || arg === "-b") {
      options.mode = "benchmark";
    } else if (arg === "--store" || arg === "-s") {
      options.mode = "store";
    } else if (arg === "--dataset" && i + 1 < args.length) {
      options.mode = "custom";
      options.datasetPath = args[++i];
    } else if (arg === "--out" && i + 1 < args.length) {
      options.outPath = args[++i];
    } else if (arg === "--site" && i + 1 < args.length) {
      options.siteId = args[++i];
    } else if (arg === "--quiet" || arg === "-q") {
      options.quiet = true;
    } else if (arg === "--json") {
      options.json = true;
    }
  }
  return options;
}

/** Execute benchmark evaluation across sites */
export function runBenchmarkSuite(options: ReplayCliOptions): BenchmarkRunResult {
  const { reports, datasetName } = loadReportsForMode(options);

  const catalog = readCatalog();
  const sites = listMergedSites();
  const siteById = new Map(sites.map((s) => [s.id, s]));
  const atollById = new Map(catalog.atolls.map((a) => [a.id, a]));

  const grouped = groupBySiteId(reports);

  if (options.siteId && (!siteById.has(options.siteId) || !grouped.has(options.siteId))) {
    const errorMsg = `Error: Site "${options.siteId}" was not found in catalog or dataset.`;
    console.error(errorMsg);
    return {
      ok: false,
      failures: 1,
      strengthMismatches: 0,
      metrics: {
        totalReports: 0,
        directionalAccuracyPct: 0,
        slackTimingDeviationMins: 0,
        slackReports: 0,
        falseHighConfidenceRatePct: 0,
        confidenceBreakdown: {
          high: { count: 0, accuracyPct: 0 },
          medium: { count: 0, accuracyPct: 0 },
          low: { count: 0, accuracyPct: 0 },
        },
      },
      datasetName,
      evaluatedAt: new Date().toISOString(),
      siteResults: [],
      siteNotFound: true,
      error: errorMsg,
    };
  }

  const siteResults: SiteBenchmarkResult[] = [];

  let totalReports = 0;
  let totalDirectionalMatches = 0;
  let totalFailures = 0;
  let totalStrengthMismatches = 0;
  let totalSlackCount = 0;
  let totalSlackDeviationSumMins = 0;

  const tierCounts = { high: 0, medium: 0, low: 0 };
  const tierMatches = { high: 0, medium: 0, low: 0 };

  for (const [siteId, siteReports] of grouped.entries()) {
    if (options.siteId && siteId !== options.siteId) continue;

    const site = siteById.get(siteId);
    if (!site) continue;
    const atoll = atollById.get(site.atollId);
    if (!atoll) continue;
    // A lagoon site is forecast from the flow through its atoll's rim and channels, which replay has no data for.
    // Its fixture reports were written as into or out of the atoll and have no reading along its flow's axis.
    if (site.siteType === "lagoon") continue;
    // A strait wall runs east or west through the strait, which the fixtures' in/out reports do not describe.
    if (site.siteType === "strait-wall") continue;

    const bearing = inwardBearingDeg(
      site,
      catalog.sites,
      { lat: atoll.oceanLat, lon: atoll.oceanLon },
      rimForAtoll(atoll),
    );
    const seaward = seawardPoint(site.lat, site.lon, bearing);
    const alongHeadingDeg = flowsAlongReef(site, catalog.sites) ? alongReefHeading(bearing) : undefined;
    const benchmarkOnly = options.mode === "benchmark";
    const hours =
      cachedHoursAt(seaward.lat, seaward.lon, benchmarkOnly) ??
      cachedHoursAt(atoll.oceanLat, atoll.oceanLon, benchmarkOnly);
    if (!hours) continue;

    // Run replayReports for site with channel constriction support
    const res = replayReports({
      hours,
      inwardBearingDeg: bearing,
      reports: siteReports,
      channelWidthM: site.channelWidthM,
      channelDepthM: site.channelDepthM,
      alongHeadingDeg,
    });

    const m = res.metrics;
    const siteTotal = m.totalReports;
    const siteMatches = Math.round((m.directionalAccuracyPct / 100) * siteTotal);
    const evaluatedSlackCount = m.slackReports;
    const siteSlackDevSum = m.slackTimingDeviationMins * evaluatedSlackCount;

    totalReports += siteTotal;
    totalDirectionalMatches += siteMatches;
    totalFailures += res.failures;
    totalStrengthMismatches += res.strengthMismatches;
    totalSlackCount += evaluatedSlackCount;
    totalSlackDeviationSumMins += siteSlackDevSum;

    // Confidence breakdown tally
    for (const tier of ["high", "medium", "low"] as const) {
      const tc = m.confidenceBreakdown[tier].count;
      const tm = Math.round((m.confidenceBreakdown[tier].accuracyPct / 100) * tc);
      tierCounts[tier] += tc;
      tierMatches[tier] += tm;
    }

    siteResults.push({
      siteId: site.id,
      siteName: site.name,
      atollName: atoll.name,
      evaluatedReports: siteTotal,
      slackReports: evaluatedSlackCount,
      slackDeviationSumMins: siteSlackDevSum,
      failures: res.failures,
      strengthMismatches: res.strengthMismatches,
      directionalMatches: siteMatches,
      directionalAccuracyPct: m.directionalAccuracyPct,
      slackTimingDeviationMins: m.slackTimingDeviationMins,
      falseHighConfidenceRatePct: m.falseHighConfidenceRatePct,
      ok: res.ok,
    });
  }

  const overallAccuracy =
    totalReports > 0 ? round2((totalDirectionalMatches / totalReports) * 100) : 0;
  const overallFalseHigh =
    totalReports > 0 ? round2((totalFailures / totalReports) * 100) : 0;
  const overallSlackMae =
    totalSlackCount > 0 ? round2(totalSlackDeviationSumMins / totalSlackCount) : 0;

  const metrics: BenchmarkMetrics = {
    totalReports,
    directionalAccuracyPct: overallAccuracy,
    slackTimingDeviationMins: overallSlackMae,
    slackReports: totalSlackCount,
    falseHighConfidenceRatePct: overallFalseHigh,
    confidenceBreakdown: {
      high: {
        count: tierCounts.high,
        accuracyPct: tierCounts.high > 0 ? round2((tierMatches.high / tierCounts.high) * 100) : 0,
      },
      medium: {
        count: tierCounts.medium,
        accuracyPct: tierCounts.medium > 0 ? round2((tierMatches.medium / tierCounts.medium) * 100) : 0,
      },
      low: {
        count: tierCounts.low,
        accuracyPct: tierCounts.low > 0 ? round2((tierMatches.low / tierCounts.low) * 100) : 0,
      },
    },
  };

  return {
    ok: totalFailures === 0,
    failures: totalFailures,
    strengthMismatches: totalStrengthMismatches,
    metrics,
    datasetName,
    evaluatedAt: new Date().toISOString(),
    siteResults,
  };
}

function loadReportsForMode(options: ReplayCliOptions): { reports: Report[]; datasetName: string } {
  if (options.mode === "custom" && options.datasetPath) {
    return {
      reports: readReportsFromFile(options.datasetPath),
      datasetName: path.basename(options.datasetPath),
    };
  }

  if (options.mode === "benchmark") {
    if (fs.existsSync(BENCHMARK_DATASET_PATH)) {
      return {
        reports: readReportsFromFile(BENCHMARK_DATASET_PATH),
        datasetName: "data/benchmark-reports.json",
      };
    }
    console.warn("Benchmark dataset not found at", BENCHMARK_DATASET_PATH, "- falling back to store");
  }

  const storeReports = readStore().reports;
  if (storeReports.length > 0) {
    return { reports: storeReports, datasetName: "data/store.json" };
  }

  // Fallback to benchmark reports if store is empty
  if (fs.existsSync(BENCHMARK_DATASET_PATH)) {
    return {
      reports: readReportsFromFile(BENCHMARK_DATASET_PATH),
      datasetName: "data/benchmark-reports.json (store empty fallback)",
    };
  }

  return { reports: [], datasetName: "empty" };
}

function readReportsFromFile(filePath: string): Report[] {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as Report[];
    if (parsed && typeof parsed === "object" && "reports" in parsed && Array.isArray((parsed as { reports: unknown }).reports)) {
      return (parsed as { reports: Report[] }).reports;
    }
  } catch (err) {
    console.error(`Failed to read reports from ${filePath}:`, err);
  }
  return [];
}

export function printFormattedReport(run: BenchmarkRunResult): void {
  const line = "=".repeat(80);
  const subline = "-".repeat(80);

  console.log(line);
  console.log("                    DIVE-CURRENT FORECAST BENCHMARK REPORT                      ");
  console.log(line);
  console.log(`Dataset: ${run.datasetName}`);
  console.log(`Evaluated: ${run.evaluatedAt}`);
  console.log("");
  console.log(
    "Site / Pass".padEnd(32) +
      "Reports".padStart(8) +
      "Accuracy".padStart(11) +
      "Slack MAE".padStart(12) +
      "False-High".padStart(12) +
      "Status".padStart(9),
  );
  console.log(subline);

  if (run.siteResults.length === 0) {
    console.log("  No site reports evaluated.".padEnd(80));
  } else {
    for (const s of run.siteResults) {
      const label = `${s.siteName} (${s.atollName})`.slice(0, 31);
      const acc = `${s.directionalAccuracyPct.toFixed(1)}%`;
      const slack = `${s.slackTimingDeviationMins.toFixed(1)}m`;
      const falseHigh = `${s.falseHighConfidenceRatePct.toFixed(1)}%`;
      const status = s.ok ? "PASS" : "FAIL";

      console.log(
        label.padEnd(32) +
          String(s.evaluatedReports).padStart(8) +
          acc.padStart(11) +
          slack.padStart(12) +
          falseHigh.padStart(12) +
          status.padStart(9),
      );
    }
  }

  console.log(subline);
  console.log("OVERALL BENCHMARK SUMMARY");
  console.log(subline);
  console.log(`Total Evaluated Reports:        ${run.metrics.totalReports}`);
  console.log(`Directional Accuracy:           ${run.metrics.directionalAccuracyPct.toFixed(1)}%`);
  console.log(`Slack Timing Deviation (MAE):   ${run.metrics.slackTimingDeviationMins.toFixed(1)} mins`);
  console.log(`False-High-Confidence Rate:     ${run.metrics.falseHighConfidenceRatePct.toFixed(1)}%`);
  console.log(`Total Failures (High Conf):     ${run.failures}`);
  console.log(`Total Strength Mismatches:      ${run.strengthMismatches}`);
  console.log("");
  console.log("CONFIDENCE BREAKDOWN:");
  const h = run.metrics.confidenceBreakdown.high;
  const m = run.metrics.confidenceBreakdown.medium;
  const l = run.metrics.confidenceBreakdown.low;
  const tot = run.metrics.totalReports || 1;
  console.log(
    `  High Confidence:    ${String(h.count).padStart(3)} reports (${((h.count / tot) * 100).toFixed(1)}%) | Accuracy: ${h.accuracyPct.toFixed(1)}%`,
  );
  console.log(
    `  Medium Confidence:  ${String(m.count).padStart(3)} reports (${((m.count / tot) * 100).toFixed(1)}%) | Accuracy: ${m.accuracyPct.toFixed(1)}%`,
  );
  console.log(
    `  Low Confidence:     ${String(l.count).padStart(3)} reports (${((l.count / tot) * 100).toFixed(1)}%) | Accuracy: ${l.accuracyPct.toFixed(1)}%`,
  );
  console.log("");
  console.log("OUTPUT ARTIFACTS:");
  console.log(`  Replay Status:      data/replay.json (written)`);
  console.log(`  Detailed Results:   data/benchmark-results.json (written)`);
  console.log("");
  console.log(`RESULT: ${run.ok ? "PASS (ok: true)" : "FAIL (ok: false - false-high-confidence failure detected)"}`);
  console.log(line);
}

function groupBySiteId(reports: readonly Report[]): Map<string, Report[]> {
  const grouped = new Map<string, Report[]>();
  for (const report of reports) {
    const list = grouped.get(report.siteId);
    if (list) list.push(report);
    else grouped.set(report.siteId, [report]);
  }
  return grouped;
}

/** Benchmark mode reads only the pinned fixtures, so a live cache cannot change its numbers. */
function cachedHoursAt(lat: number, lon: number, benchmarkOnly = false): MarineHour[] | null {
  const latPart = (lat === 0 ? 0 : lat).toFixed(4);
  const lonPart = (lon === 0 ? 0 : lon).toFixed(4);
  // Prefer real .json names. Also accept the old stripped key that ended in ".".
  const names = [`${latPart}_${lonPart}.json`, `${latPart}_${lonPart}.`];
  const dirs = benchmarkOnly ? [BENCHMARK_CACHE_DIR] : [marineCacheDir(), BENCHMARK_CACHE_DIR];

  for (const dir of dirs) {
    for (const name of names) {
      const filePath = path.join(dir, name);
      try {
        if (fs.existsSync(filePath)) {
          const raw = fs.readFileSync(filePath, "utf8");
          const parsed = parseCachedHours(raw);
          if (parsed?.hours && parsed.hours.length > 0) return parsed.hours;
        }
      } catch {
        // Continue to next candidate
      }
    }
  }
  return null;
}

function parseCachedHours(raw: string): { hours: MarineHour[]; fetchedAt: number } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as { fetchedAt?: unknown; hours?: unknown; body?: unknown };
  const fetchedAt =
    typeof record.fetchedAt === "number" && Number.isFinite(record.fetchedAt) ? record.fetchedAt : 0;
  const stored = storedHours(record.hours);
  if (stored) return { hours: stored, fetchedAt };
  const fromBody = "body" in record ? marineHoursFromApi(record.body) : null;
  if (fromBody && fromBody.length > 0) return { hours: fromBody, fetchedAt };
  const direct = marineHoursFromApi(parsed);
  if (direct && direct.length > 0) return { hours: direct, fetchedAt };
  return null;
}

function storedHours(value: unknown): MarineHour[] | null {
  if (!Array.isArray(value)) return null;
  const hours: MarineHour[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const hour = item as Partial<MarineHour>;
    if (typeof hour.time !== "string") return null;
    hours.push({
      time: hour.time,
      seaLevelM: numberOrNull(hour.seaLevelM),
      currentVelocityMs: numberOrNull(hour.currentVelocityMs),
      currentDirectionDeg: numberOrNull(hour.currentDirectionDeg),
    });
  }
  return hours.length > 0 ? hours : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export function writeAtomicJson(targetPath: string, data: unknown): void {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(targetPath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`);
    try {
      fs.renameSync(tmpPath, targetPath);
    } catch {
      fs.copyFileSync(tmpPath, targetPath);
      fs.rmSync(tmpPath, { force: true });
    }
  } catch (error) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // Ignore cleanup error
    }
    throw error;
  }
}


