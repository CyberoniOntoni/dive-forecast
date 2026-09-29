import fs from "fs";
import path from "path";
import { summarizeReports, type Score } from "../lib/verify";
import type { Report } from "../lib/types";

/**
 * Scores the predictions saved with each diver report against what the diver saw.
 *   npm run verify                 reads data/store.json
 *   npm run verify -- some.json    reads another store file
 */
const MIN_RELIABLE = 30;

function main(): void {
  const file = path.resolve(process.argv[2] ?? path.join("data", "store.json"));
  const store = JSON.parse(fs.readFileSync(file, "utf8")) as { reports?: Report[] };
  const reports = Array.isArray(store.reports) ? store.reports : [];
  const withPrediction = reports.filter((report) => report.predicted).length;
  console.log(`${file}\n${reports.length} reports, ${withPrediction} with a saved prediction.`);
  if (withPrediction === 0) {
    console.log("Nothing to score yet. Predictions are saved with each new report.");
    return;
  }
  for (const summary of summarizeReports(reports)) {
    console.log(`\nmodel ${summary.modelVersion}  nudge ${summary.nudge}  (${summary.reports} reports)`);
    if (summary.reports < MIN_RELIABLE) {
      console.log(`  Only ${summary.reports} reports: treat every number below as anecdote (a reliable read needs about ${MIN_RELIABLE}+, from many days and sites).`);
    }
    console.log(`  guessing the most common reported strength every time would score ${pct(summary.baselineExact)} exact`);
    print("as shown on the page", summary.shown);
    print("model alone         ", summary.modelOnly);
  }
}

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function print(label: string, score: Score): void {
  if (score.n === 0) return console.log(`  ${label}  no data`);
  const direction = score.directionN === 0 ? "n/a" : `${pct(score.directionRight / score.directionN)} of ${score.directionN}`;
  console.log(
    `  ${label}  direction ${direction}; strength exact ${pct(score.strengthExact / score.n)}, within one band ${pct(score.strengthWithinOne / score.n)}, ` +
      `too strong ${pct(score.tooStrong / score.n)}, too weak ${pct(score.tooWeak / score.n)}  (n=${score.n})`,
  );
}

main();
