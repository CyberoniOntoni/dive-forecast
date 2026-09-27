import fs from "fs";
import path from "path";
import crypto from "crypto";
import cp from "child_process";

const VITE_NODE = path.resolve(process.cwd(), "node_modules", "vite-node", "vite-node.mjs");
const REPLAY_JSON = path.resolve(process.cwd(), "data", "replay.json");
const BENCH_JSON = path.resolve(process.cwd(), "data", "benchmark-results.json");

function sha256(filePath: string): string {
  if (!fs.existsSync(filePath)) return "";
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function mtime(filePath: string): number {
  if (!fs.existsSync(filePath)) return 0;
  return fs.statSync(filePath).mtimeMs;
}

console.log("================================================================================");
console.log("       MILENSTONE 4 ITERATION 2 ADVERSARIAL CLI & ARTIFACT STRESS SUITE        ");
console.log("================================================================================");

// 1. Prime canonical artifacts
console.log("\n[Setup] Priming canonical benchmark artifacts via scripts/benchmark.ts...");
const primeRes = cp.spawnSync(process.execPath, [VITE_NODE, "scripts/benchmark.ts"], {
  cwd: process.cwd(),
  encoding: "utf8",
  timeout: 15000,
});
if (primeRes.status !== 0) {
  console.error("FAILED to prime canonical artifacts:", primeRes.stderr);
  process.exit(1);
}

const baselineReplayHash = sha256(REPLAY_JSON);
const baselineBenchHash = sha256(BENCH_JSON);
const baselineReplayMtime = mtime(REPLAY_JSON);
const baselineBenchMtime = mtime(BENCH_JSON);

console.log(`Baseline data/replay.json            SHA256: ${baselineReplayHash} (mtime: ${baselineReplayMtime})`);
console.log(`Baseline data/benchmark-results.json SHA256: ${baselineBenchHash} (mtime: ${baselineBenchMtime})`);

const emptyDatasetPath = path.resolve(process.cwd(), "data", ".tmp-empty-dataset.json");
fs.writeFileSync(emptyDatasetPath, "[]\n");

interface TestCase {
  id: number;
  name: string;
  script: string;
  args: string[];
  expectedCode: number;
  expectedStderr?: string;
  expectedStdoutStrings?: string[];
  checkQuiet?: boolean;
  checkJsonFailure?: boolean;
  checkJsonSuccess?: boolean;
  isInvalidInput: boolean;
}

const testCases: TestCase[] = [
  {
    id: 1,
    name: "scripts/replay.ts with non-existent site ID",
    script: "scripts/replay.ts",
    args: ["--benchmark", "--site", "non-existent-site-xyz"],
    expectedCode: 1,
    expectedStderr: 'Error: Site "non-existent-site-xyz" was not found in catalog or dataset.',
    isInvalidInput: true,
  },
  {
    id: 2,
    name: "scripts/benchmark.ts with non-existent site ID",
    script: "scripts/benchmark.ts",
    args: ["--site", "non-existent-site-xyz"],
    expectedCode: 1,
    expectedStderr: 'Error: Site "non-existent-site-xyz" was not found in catalog or dataset.',
    isInvalidInput: true,
  },
  {
    id: 3,
    name: "scripts/replay.ts with catalog site missing reports (banana-reef)",
    script: "scripts/replay.ts",
    args: ["--benchmark", "--site", "banana-reef"],
    expectedCode: 1,
    expectedStderr: 'Error: Site "banana-reef" was not found in catalog or dataset.',
    isInvalidInput: true,
  },
  {
    id: 4,
    name: "scripts/benchmark.ts with catalog site missing reports (banana-reef)",
    script: "scripts/benchmark.ts",
    args: ["--site", "banana-reef"],
    expectedCode: 1,
    expectedStderr: 'Error: Site "banana-reef" was not found in catalog or dataset.',
    isInvalidInput: true,
  },
  {
    id: 5,
    name: "scripts/replay.ts in --store mode with banana-reef",
    script: "scripts/replay.ts",
    args: ["--store", "--site", "banana-reef"],
    expectedCode: 1,
    expectedStderr: 'Error: Site "banana-reef" was not found in catalog or dataset.',
    isInvalidInput: true,
  },
  {
    id: 6,
    name: "scripts/replay.ts with non-existent site and --quiet flag",
    script: "scripts/replay.ts",
    args: ["--benchmark", "--site", "non-existent-site-xyz", "--quiet"],
    expectedCode: 1,
    expectedStderr: 'Error: Site "non-existent-site-xyz" was not found in catalog or dataset.',
    checkQuiet: true,
    isInvalidInput: true,
  },
  {
    id: 7,
    name: "scripts/replay.ts with non-existent site and --json flag",
    script: "scripts/replay.ts",
    args: ["--benchmark", "--site", "non-existent-site-xyz", "--json"],
    expectedCode: 1,
    expectedStderr: 'Error: Site "non-existent-site-xyz" was not found in catalog or dataset.',
    checkJsonFailure: true,
    isInvalidInput: true,
  },
  {
    id: 8,
    name: "scripts/benchmark.ts with banana-reef and --quiet flag",
    script: "scripts/benchmark.ts",
    args: ["--site", "banana-reef", "--quiet"],
    expectedCode: 1,
    expectedStderr: 'Error: Site "banana-reef" was not found in catalog or dataset.',
    checkQuiet: true,
    isInvalidInput: true,
  },
  {
    id: 9,
    name: "scripts/benchmark.ts with banana-reef and --json flag",
    script: "scripts/benchmark.ts",
    args: ["--site", "banana-reef", "--json"],
    expectedCode: 1,
    expectedStderr: 'Error: Site "banana-reef" was not found in catalog or dataset.',
    checkJsonFailure: true,
    isInvalidInput: true,
  },
  {
    id: 10,
    name: "scripts/replay.ts with explicit benchmark dataset and invalid site",
    script: "scripts/replay.ts",
    args: ["--dataset", "data/benchmark-reports.json", "--site", "non-existent-site-xyz"],
    expectedCode: 1,
    expectedStderr: 'Error: Site "non-existent-site-xyz" was not found in catalog or dataset.',
    isInvalidInput: true,
  },
  {
    id: 11,
    name: "scripts/replay.ts with empty custom dataset and catalog site rasdhoo-madivaru",
    script: "scripts/replay.ts",
    args: ["--dataset", emptyDatasetPath, "--site", "rasdhoo-madivaru"],
    expectedCode: 1,
    expectedStderr: 'Error: Site "rasdhoo-madivaru" was not found in catalog or dataset.',
    isInvalidInput: true,
  },
  {
    id: 12,
    name: "scripts/replay.ts on valid site rasdhoo-madivaru",
    script: "scripts/replay.ts",
    args: ["--benchmark", "--site", "rasdhoo-madivaru"],
    expectedCode: 0,
    expectedStdoutStrings: ["DIVE-CURRENT FORECAST BENCHMARK REPORT", "Rasdhoo Madivaru", "PASS"],
    isInvalidInput: false,
  },
  {
    id: 13,
    name: "scripts/benchmark.ts on valid site rasdhoo-madivaru",
    script: "scripts/benchmark.ts",
    args: ["--site", "rasdhoo-madivaru"],
    expectedCode: 0,
    expectedStdoutStrings: ["DIVE-CURRENT FORECAST BENCHMARK REPORT", "Rasdhoo Madivaru", "PASS"],
    isInvalidInput: false,
  },
  {
    id: 14,
    name: "scripts/replay.ts on valid site rasdhoo-madivaru with --quiet",
    script: "scripts/replay.ts",
    args: ["--benchmark", "--site", "rasdhoo-madivaru", "--quiet"],
    expectedCode: 0,
    checkQuiet: true,
    isInvalidInput: false,
  },
  {
    id: 15,
    name: "scripts/replay.ts on valid site rasdhoo-madivaru with --json",
    script: "scripts/replay.ts",
    args: ["--benchmark", "--site", "rasdhoo-madivaru", "--json"],
    expectedCode: 0,
    checkJsonSuccess: true,
    isInvalidInput: false,
  },
];

let totalFailed = 0;
const testDetails: string[] = [];

for (const tc of testCases) {
  const preReplayHash = sha256(REPLAY_JSON);
  const preBenchHash = sha256(BENCH_JSON);
  const preReplayMtime = mtime(REPLAY_JSON);
  const preBenchMtime = mtime(BENCH_JSON);

  const tStart = Date.now();
  const res = cp.spawnSync(process.execPath, [VITE_NODE, tc.script, ...tc.args], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 15000,
  });
  const durationMs = Date.now() - tStart;

  const postReplayHash = sha256(REPLAY_JSON);
  const postBenchHash = sha256(BENCH_JSON);
  const postReplayMtime = mtime(REPLAY_JSON);
  const postBenchMtime = mtime(BENCH_JSON);

  const codeMatch = res.status === tc.expectedCode;
  const stderrMatch = !tc.expectedStderr || res.stderr.includes(tc.expectedStderr);

  let stdoutMatch = true;
  if (tc.expectedStdoutStrings) {
    for (const needle of tc.expectedStdoutStrings) {
      if (!res.stdout.includes(needle)) {
        stdoutMatch = false;
        break;
      }
    }
  }

  let quietMatch = true;
  if (tc.checkQuiet && res.stdout.trim() !== "") {
    quietMatch = false;
  }

  let jsonMatch = true;
  if (tc.checkJsonFailure) {
    try {
      const parsed = JSON.parse(res.stdout);
      if (parsed.ok !== false || parsed.siteNotFound !== true || parsed.failures !== 1) {
        jsonMatch = false;
      }
    } catch {
      jsonMatch = false;
    }
  }

  if (tc.checkJsonSuccess) {
    try {
      const parsed = JSON.parse(res.stdout);
      if (parsed.ok !== true || !Array.isArray(parsed.siteResults) || parsed.siteResults.length !== 1) {
        jsonMatch = false;
      }
    } catch {
      jsonMatch = false;
    }
  }

  let artifactPreserved = true;
  if (tc.isInvalidInput) {
    artifactPreserved =
      preReplayHash === postReplayHash &&
      preBenchHash === postBenchHash &&
      preReplayMtime === postReplayMtime &&
      preBenchMtime === postBenchMtime;
  }

  const passed = codeMatch && stderrMatch && stdoutMatch && quietMatch && jsonMatch && artifactPreserved;
  if (!passed) totalFailed++;

  const statusLabel = passed ? "PASS" : "FAIL";
  const summaryLine = `[${statusLabel}] #${tc.id.toString().padStart(2, "0")} ${tc.name} (${durationMs}ms)`;
  console.log(`\n${summaryLine}`);
  console.log(`  Command: vite-node ${tc.script} ${tc.args.join(" ")}`);
  console.log(`  Exit code: ${res.status} (expected ${tc.expectedCode}) -> ${codeMatch ? "OK" : "FAILED"}`);
  if (tc.expectedStderr) {
    console.log(`  Stderr check: ${stderrMatch ? "OK" : "FAILED"} -> "${res.stderr.trim()}"`);
  }
  if (tc.expectedStdoutStrings) {
    console.log(`  Stdout substrings check: ${stdoutMatch ? "OK" : "FAILED"}`);
  }
  if (tc.checkQuiet) {
    console.log(`  Quiet mode check: ${quietMatch ? "OK (empty stdout)" : `FAILED (got: "${res.stdout.trim()}")`}`);
  }
  if (tc.checkJsonFailure || tc.checkJsonSuccess) {
    console.log(`  JSON payload check: ${jsonMatch ? "OK" : "FAILED"}`);
  }
  if (tc.isInvalidInput) {
    const rHashDiff = preReplayHash !== postReplayHash;
    const bHashDiff = preBenchHash !== postBenchHash;
    const rMtimeDiff = preReplayMtime !== postReplayMtime;
    const bMtimeDiff = preBenchMtime !== postBenchMtime;
    if (rHashDiff || bHashDiff || rMtimeDiff || bMtimeDiff) {
      console.log(
        `  Artifact preservation check: FAILED (diffs -> replayHash: ${rHashDiff}, benchHash: ${bHashDiff}, replayMtime: ${rMtimeDiff}, benchMtime: ${bMtimeDiff})`
      );
      console.log(`    preReplayHash:  ${preReplayHash}`);
      console.log(`    postReplayHash: ${postReplayHash}`);
      console.log(`    preReplayMtime:  ${preReplayMtime}`);
      console.log(`    postReplayMtime: ${postReplayMtime}`);
      console.log(`    preBenchMtime:   ${preBenchMtime}`);
      console.log(`    postBenchMtime:  ${postBenchMtime}`);
    } else {
      console.log(`  Artifact preservation check: OK (0 byte/mtime mutation)`);
    }
  }

  testDetails.push(
    `| ${tc.id} | ${tc.name} | vite-node ${tc.script} ${tc.args.join(" ")} | ${tc.expectedCode} | ${res.status} | ${passed ? "PASS" : "FAIL"} |`,
  );
}

// Clean up temporary empty dataset file
if (fs.existsSync(emptyDatasetPath)) {
  fs.unlinkSync(emptyDatasetPath);
}

// Restore canonical benchmark artifacts
console.log("\n[Teardown] Re-running canonical benchmark to ensure pristine artifacts...");
const restoreRes = cp.spawnSync(process.execPath, [VITE_NODE, "scripts/benchmark.ts"], {
  cwd: process.cwd(),
  encoding: "utf8",
  timeout: 15000,
});
if (restoreRes.status !== 0) {
  console.error("FAILED to restore canonical artifacts:", restoreRes.stderr);
  process.exit(1);
}

console.log("\n================================================================================");
console.log(`TOTAL ADVERSARIAL TESTS: ${testCases.length}`);
console.log(`PASSED: ${testCases.length - totalFailed}`);
console.log(`FAILED: ${totalFailed}`);
console.log("================================================================================");

if (totalFailed > 0) {
  console.error("\nRESULT: ADVERSARIAL STRESS CHALLENGE FAILED");
  process.exit(1);
} else {
  console.log("\nRESULT: ALL ADVERSARIAL STRESS TESTS PASSED");
  process.exit(0);
}
