import fs from "fs";
import path from "path";
import cp from "child_process";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  parseCliArgs,
  runBenchmarkSuite,
  writeAtomicJson,
  REPLAY_OUT_PATH,
  BENCHMARK_OUT_PATH,
} from "../scripts/replay";
import { replayReports } from "../lib/replay";
import type { Report, MarineHour } from "../lib/types";

const VITE_NODE_BIN = path.resolve(process.cwd(), "node_modules", "vite-node", "vite-node.mjs");

function runCliSubprocess(scriptPath: string, args: string[]) {
  return cp.spawnSync(process.execPath, [VITE_NODE_BIN, scriptPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 15000,
  });
}

function restoreCanonicalArtifacts(): void {
  const canonical = runBenchmarkSuite(parseCliArgs(["--benchmark"]));
  writeAtomicJson(REPLAY_OUT_PATH, {
    ok: canonical.ok,
    failures: canonical.failures,
    strengthMismatches: canonical.strengthMismatches,
    metrics: canonical.metrics,
    evaluatedAt: canonical.evaluatedAt,
  });
  writeAtomicJson(BENCHMARK_OUT_PATH, canonical);
}

describe("Milestone 4 Adversarial Challenge: Benchmark CLI & Data Artifacts", () => {
  beforeAll(() => {
    restoreCanonicalArtifacts();
  });

  afterAll(() => {
    restoreCanonicalArtifacts();
  });
  describe("1. CLI Execution & Invocation Modes", () => {
    it("executes benchmark suite in benchmark mode with positive reports", () => {
      const options = parseCliArgs(["--benchmark"]);
      const result = runBenchmarkSuite(options);

      expect(result.ok).toBe(true);
      expect(result.failures).toBe(0);
      expect(result.metrics.totalReports).toBe(46);
      expect(result.metrics.directionalAccuracyPct).toBeGreaterThan(80);
      expect(result.metrics.slackTimingDeviationMins).toBeGreaterThanOrEqual(0);
      expect(result.datasetName).toContain("benchmark-reports.json");
    });

    it("executes in store mode falling back cleanly to benchmark fixture when store empty", () => {
      const options = parseCliArgs(["--store"]);
      const result = runBenchmarkSuite(options);

      expect(result.ok).toBe(true);
      expect(result.datasetName).toContain("store empty fallback");
      expect(result.siteResults.length).toBeGreaterThan(0);
    });
  });

  describe("2. CLI Flag Variations & Boundary Edge Cases", () => {
    it("filters precisely to single site when --site rasdhoo-madivaru is provided", () => {
      const options = parseCliArgs(["--benchmark", "--site", "rasdhoo-madivaru"]);
      const result = runBenchmarkSuite(options);

      expect(result.siteResults).toHaveLength(1);
      expect(result.siteResults[0].siteId).toBe("rasdhoo-madivaru");
      expect(result.metrics.totalReports).toBe(10);
      expect(result.metrics.directionalAccuracyPct).toBe(90.0);
    });

    it("handles empty dataset array without crashing, throwing, or producing NaN", () => {
      const tmpEmptyPath = path.join(process.cwd(), "data", ".test-m4-empty.json");
      fs.writeFileSync(tmpEmptyPath, "[]\n");
      try {
        const options = parseCliArgs(["--dataset", tmpEmptyPath]);
        const result = runBenchmarkSuite(options);

        expect(result.siteResults).toHaveLength(0);
        expect(result.metrics.totalReports).toBe(0);
        expect(result.metrics.directionalAccuracyPct).toBe(0);
        expect(result.metrics.slackTimingDeviationMins).toBe(0);
        expect(result.metrics.falseHighConfidenceRatePct).toBe(0);
        expect(Number.isNaN(result.metrics.directionalAccuracyPct)).toBe(false);
      } finally {
        if (fs.existsSync(tmpEmptyPath)) fs.unlinkSync(tmpEmptyPath);
      }
    });

    it("handles malformed JSON dataset gracefully by falling back to empty reports", () => {
      const tmpCorruptPath = path.join(process.cwd(), "data", ".test-m4-corrupt.json");
      fs.writeFileSync(tmpCorruptPath, "{ malformed json content\n");
      try {
        const options = parseCliArgs(["--dataset", tmpCorruptPath]);
        const result = runBenchmarkSuite(options);

        expect(result.siteResults).toHaveLength(0);
        expect(result.metrics.totalReports).toBe(0);
      } finally {
        if (fs.existsSync(tmpCorruptPath)) fs.unlinkSync(tmpCorruptPath);
      }
    });
  });

  describe("3. Artifact Integrity & Interface Contracts", () => {
    it("verifies data/replay.json schema invariants and absence of NaN", () => {
      expect(fs.existsSync(REPLAY_OUT_PATH)).toBe(true);
      const raw = fs.readFileSync(REPLAY_OUT_PATH, "utf8");
      const parsed = JSON.parse(raw);

      expect(typeof parsed.ok).toBe("boolean");
      expect(typeof parsed.failures).toBe("number");
      expect(typeof parsed.strengthMismatches).toBe("number");
      expect(parsed.metrics).toBeDefined();
      expect(typeof parsed.metrics.totalReports).toBe("number");
      expect(typeof parsed.metrics.directionalAccuracyPct).toBe("number");

      // Conservation invariant: breakdown counts must sum exactly to totalReports
      const breakdown = parsed.metrics.confidenceBreakdown;
      expect(breakdown.high.count + breakdown.medium.count + breakdown.low.count).toBe(
        parsed.metrics.totalReports,
      );
    });

    it("verifies data/benchmark-results.json contains comprehensive site breakdown", () => {
      expect(fs.existsSync(BENCHMARK_OUT_PATH)).toBe(true);
      const raw = fs.readFileSync(BENCHMARK_OUT_PATH, "utf8");
      const parsed = JSON.parse(raw);

      expect(parsed.siteResults).toBeInstanceOf(Array);
      expect(parsed.siteResults.length).toBeGreaterThan(0);
      for (const site of parsed.siteResults) {
        expect(typeof site.siteId).toBe("string");
        expect(typeof site.evaluatedReports).toBe("number");
        expect(typeof site.directionalAccuracyPct).toBe("number");
        expect(typeof site.ok).toBe("boolean");
        expect(Number.isFinite(site.directionalAccuracyPct)).toBe(true);
      }
    });
  });

  describe("4. Exit Code & Failure Detection Verification", () => {
    it("detects high-confidence contradiction and marks benchmark as FAIL (ok: false)", () => {
      // Replicate a high-confidence failure using the validated reference pattern
      const start = Date.UTC(2026, 8, 22, 0, 0);
      const series: MarineHour[] = Array.from({ length: 72 }, (_, index) => ({
        time: new Date(start + index * 60 * 60 * 1000).toISOString().slice(0, 16),
        seaLevelM: 0.25 + 0.22 * Math.sin((2 * Math.PI * index) / 12),
        currentVelocityMs: 0,
        currentDirectionDeg: 0,
      }));

      const earlier: Report[] = [0, 1, 2, 3].map((id) => ({
        id: `earlier-${id}`,
        siteId: "s",
        time: `2026-08-02T0${id}:00`,
        direction: "incoming" as const,
        strength: "strong" as const,
        slopeM: 0.08,
      }));

      const failingReport: Report = {
        id: "withheld-fail",
        siteId: "s",
        time: "2026-09-23T13:00",
        direction: "outgoing",
        strength: "strong",
      };

      const result = replayReports({
        hours: series,
        inwardBearingDeg: 0,
        reports: [...earlier, failingReport],
      });

      expect(result.failures).toBe(1);
      expect(result.ok).toBe(false);
      expect(result.metrics.falseHighConfidenceRatePct).toBe(100);
    });

    it("rejects non-existent site in runBenchmarkSuite with ok: false, failures: 1, and siteNotFound flag", () => {
      const options = parseCliArgs(["--benchmark", "--site", "non-existent-site-id"]);
      const result = runBenchmarkSuite(options);

      expect(result.siteResults).toHaveLength(0);
      expect(result.metrics.totalReports).toBe(0);
      expect(result.ok).toBe(false);
      expect(result.failures).toBe(1);
      expect(result.siteNotFound).toBe(true);
    });

    it("verifies scripts/replay.ts exits with code 1 and logs error on non-existent site without corrupting artifacts", () => {
      const replayMtimeBefore = fs.statSync(REPLAY_OUT_PATH).mtimeMs;
      const benchMtimeBefore = fs.statSync(BENCHMARK_OUT_PATH).mtimeMs;

      const res = runCliSubprocess("scripts/replay-cli.ts", ["--benchmark", "--site", "non-existent-site-id"]);

      expect(res.status).toBe(1);
      expect(res.stderr).toContain('Error: Site "non-existent-site-id" was not found in catalog or dataset.');

      const replayMtimeAfter = fs.statSync(REPLAY_OUT_PATH).mtimeMs;
      const benchMtimeAfter = fs.statSync(BENCHMARK_OUT_PATH).mtimeMs;
      expect(replayMtimeAfter).toBe(replayMtimeBefore);
      expect(benchMtimeAfter).toBe(benchMtimeBefore);
    });

    it("verifies scripts/benchmark.ts exits with code 1 and logs error on non-existent site without corrupting artifacts", () => {
      const replayMtimeBefore = fs.statSync(REPLAY_OUT_PATH).mtimeMs;
      const benchMtimeBefore = fs.statSync(BENCHMARK_OUT_PATH).mtimeMs;

      const res = runCliSubprocess("scripts/benchmark.ts", ["--site", "non-existent-site-id"]);

      expect(res.status).toBe(1);
      expect(res.stderr).toContain('Error: Site "non-existent-site-id" was not found in catalog or dataset.');

      const replayMtimeAfter = fs.statSync(REPLAY_OUT_PATH).mtimeMs;
      const benchMtimeAfter = fs.statSync(BENCHMARK_OUT_PATH).mtimeMs;
      expect(replayMtimeAfter).toBe(replayMtimeBefore);
      expect(benchMtimeAfter).toBe(benchMtimeBefore);
    });

    it("verifies scripts/replay.ts exits with code 1 on catalog site missing reports", () => {
      const res = runCliSubprocess("scripts/replay-cli.ts", ["--benchmark", "--site", "banana-reef"]);

      expect(res.status).toBe(1);
      expect(res.stderr).toContain('Error: Site "banana-reef" was not found in catalog or dataset.');
    });

    it("verifies scripts/replay.ts exits with code 0 on valid site (rasdhoo-madivaru)", () => {
      const res = runCliSubprocess("scripts/replay-cli.ts", ["--benchmark", "--site", "rasdhoo-madivaru"]);

      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Rasdhoo Madivaru");
      expect(res.stdout).toContain("PASS");
    });

    it("verifies scripts/benchmark.ts exits with code 0 on valid site (rasdhoo-madivaru)", () => {
      const res = runCliSubprocess("scripts/benchmark.ts", ["--site", "rasdhoo-madivaru"]);

      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Rasdhoo Madivaru");
      expect(res.stdout).toContain("PASS");
    });
  });
});
