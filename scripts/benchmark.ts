import {
  parseCliArgs,
  printFormattedReport,
  runBenchmarkSuite,
  writeAtomicJson,
  REPLAY_OUT_PATH,
  BENCHMARK_OUT_PATH,
} from "./replay";

async function run(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  // Default to benchmark mode
  options.mode = "benchmark";

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

  // Atomically write data/replay.json and data/benchmark-results.json
  writeAtomicJson(REPLAY_OUT_PATH, {
    ok: result.ok,
    failures: result.failures,
    strengthMismatches: result.strengthMismatches,
    metrics: result.metrics,
    evaluatedAt: result.evaluatedAt,
  });

  writeAtomicJson(BENCHMARK_OUT_PATH, result);

  process.exit(result.ok ? 0 : 1);
}

run().catch((err) => {
  console.error("Benchmark CLI script encountered an error:", err);
  process.exit(1);
});
