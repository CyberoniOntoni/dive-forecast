import type { Report, Strength } from "./types";

const BAND: Record<Strength, number> = { slack: 0, mild: 1, strong: 2, too_strong: 3 };

export type Score = {
  n: number;
  /** Reports where neither side said slack, so direction can be judged. */
  directionN: number;
  directionRight: number;
  strengthExact: number;
  strengthWithinOne: number;
  /** Forecast stronger than reported. */
  tooStrong: number;
  /** Forecast weaker than reported. */
  tooWeak: number;
};

export type ModelSummary = {
  modelVersion: string;
  nudge: string;
  reports: number;
  shown: Score;
  modelOnly: Score;
  /** Share of reports whose most common reported strength is a naive guess: what "always say X" would score exact. */
  baselineExact: number;
};

const emptyScore = (): Score => ({
  n: 0, directionN: 0, directionRight: 0, strengthExact: 0, strengthWithinOne: 0, tooStrong: 0, tooWeak: 0,
});

function add(score: Score, report: Report, predicted: { direction: string; strength: Strength }) {
  score.n += 1;
  // A slack call on either side has no direction to compare. The replay benchmark counts those as matches; this does not.
  if (report.strength !== "slack" && predicted.strength !== "slack") {
    score.directionN += 1;
    if (predicted.direction === report.direction) score.directionRight += 1;
  }
  const gap = BAND[predicted.strength] - BAND[report.strength];
  if (gap === 0) score.strengthExact += 1;
  if (Math.abs(gap) <= 1) score.strengthWithinOne += 1;
  if (gap > 0) score.tooStrong += 1;
  if (gap < 0) score.tooWeak += 1;
}

/**
 * Score saved predictions against the diver reports they were saved with, grouped by model version and nudge setting.
 * Reports without a saved prediction (older ones, and the benchmark fixtures) are left out.
 */
export function summarizeReports(reports: readonly Report[]): ModelSummary[] {
  const groups = new Map<string, { list: Report[]; summary: ModelSummary }>();
  for (const report of reports) {
    const predicted = report.predicted;
    if (!predicted) continue;
    const key = `${predicted.modelVersion}|${predicted.nudge}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        list: [],
        summary: {
          modelVersion: predicted.modelVersion, nudge: predicted.nudge, reports: 0,
          shown: emptyScore(), modelOnly: emptyScore(), baselineExact: 0,
        },
      };
      groups.set(key, group);
    }
    group.list.push(report);
    group.summary.reports += 1;
    add(group.summary.shown, report, predicted.shown);
    if (predicted.modelOnly) add(group.summary.modelOnly, report, predicted.modelOnly);
  }
  return [...groups.values()].map(({ list, summary }) => {
    const counts = new Map<Strength, number>();
    for (const report of list) counts.set(report.strength, (counts.get(report.strength) ?? 0) + 1);
    summary.baselineExact = list.length === 0 ? 0 : Math.max(...counts.values()) / list.length;
    return summary;
  });
}
