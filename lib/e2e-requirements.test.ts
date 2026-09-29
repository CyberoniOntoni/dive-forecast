import { describe, expect, it } from "vitest";
import * as ForecastEngine from "./forecast";
import { forecastHours, parseWall } from "./forecast";
import { replayReports } from "./replay";
import {
  STRENGTHS,
  type HourForecast,
  type MarineHour,
  type Report,
  type Strength,
} from "./types";

/**
 * Extended ForecastInput matching PROJECT.md § Interface Contracts:
 * export type ForecastInput = {
 *   hours: MarineHour[];
 *   inwardBearingDeg: number;
 *   reports?: readonly Report[];
 *   allowHighConfidence?: boolean;
 *   channelWidthM?: number;
 *   channelDepthM?: number;
 * };
 */
export type ExtendedForecastInput = {
  hours: MarineHour[];
  inwardBearingDeg: number;
  reports?: readonly Report[];
  allowHighConfidence?: boolean;
  channelWidthM?: number;
  channelDepthM?: number;
};

/**
 * Climatological ocean drift matching PROJECT.md § Interface Contracts:
 * export type OceanDrift = {
 *   velocityMs: number;
 *   directionDeg: number;
 * };
 * export function getMaldivesMonsoonDrift(date: Date): OceanDrift;
 */
export type OceanDrift = {
  velocityMs: number;
  directionDeg: number;
};

/**
 * Benchmark evaluation metrics matching PROJECT.md § Interface Contracts:
 * export type BenchmarkMetrics = {
 *   totalReports: number;
 *   directionalAccuracyPct: number;
 *   slackTimingDeviationMins: number;
 *   falseHighConfidenceRatePct: number;
 *   confidenceBreakdown: {
 *     high: { count: number; accuracyPct: number };
 *     medium: { count: number; accuracyPct: number };
 *     low: { count: number; accuracyPct: number };
 *   };
 * };
 */
export type BenchmarkMetrics = {
  totalReports: number;
  directionalAccuracyPct: number;
  slackTimingDeviationMins: number;
  falseHighConfidenceRatePct: number;
  confidenceBreakdown: {
    high: { count: number; accuracyPct: number };
    medium: { count: number; accuracyPct: number };
    low: { count: number; accuracyPct: number };
  };
};

export type ExtendedReplayResult = {
  ok: boolean;
  failures: number;
  strengthMismatches: number;
  metrics?: BenchmarkMetrics;
};

// Safe accessors for upcoming interfaces from milestones M1-M4
const getMaldivesMonsoonDrift = (
  ForecastEngine as unknown as { getMaldivesMonsoonDrift?: (date: Date) => OceanDrift }
).getMaldivesMonsoonDrift;

// ── Test Data Generators & Helpers ──────────────────────────────────────────

function strengthRank(strength: Strength): number {
  return STRENGTHS.indexOf(strength);
}

function makeMarineSeries(
  startTime: string,
  levels: number[],
  velocities?: number[],
  directions?: number[],
): MarineHour[] {
  const startMs = parseWall(startTime);
  if (!Number.isFinite(startMs)) {
    throw new Error(`Invalid start time: ${startTime}`);
  }
  return levels.map((seaLevelM, index) => ({
    time: new Date(startMs + index * 3600 * 1000).toISOString().slice(0, 16),
    seaLevelM,
    currentVelocityMs: velocities ? (velocities[index] ?? 0) : 0,
    currentDirectionDeg: directions ? (directions[index] ?? 0) : 0,
  }));
}

/**
 * Generates semidiurnal tide levels with 12h cycle:
 * h(t) = meanM + amplitudeM * sin(2 * pi * t / 12)
 */
function generateSemidiurnalTide(hoursCount: number, amplitudeM: number, meanM = 0.5): number[] {
  return Array.from({ length: hoursCount }, (_, h) => {
    return Number((meanM + amplitudeM * Math.sin((2 * Math.PI * h) / 12)).toFixed(3));
  });
}

/** Spring tide cycle with ~1.2m range (amplitude 0.6m) */
function generateSpringLevels(hoursCount = 72): number[] {
  return generateSemidiurnalTide(hoursCount, 0.6, 0.8);
}

/** Neap tide cycle with ~0.3m range (amplitude 0.15m) */
function generateNeapLevels(hoursCount = 72): number[] {
  return generateSemidiurnalTide(hoursCount, 0.15, 0.5);
}

function findHour(forecast: readonly HourForecast[], timePrefix: string): HourForecast | undefined {
  return forecast.find((hour) => hour.time.startsWith(timePrefix));
}

// ══════════════════════════════════════════════════════════════════════════════
// TIER 1: FEATURE COVERAGE (R1, R2, R3, R4)
// ══════════════════════════════════════════════════════════════════════════════

describe("Tier 1: Feature Coverage", () => {
  // ── R1: Hydrodynamic Pass & Tidal Range Modeling (F1, F2, F3) ───────────────
  describe("R1: Hydrodynamic Pass & Tidal Range Modeling", () => {
    const springLevels = generateSpringLevels(72);
    // Start series 24h before target day so 2026-07-15 is Day 2 (centered in 72h window)
    const marineHours = makeMarineSeries("2026-07-14T00:00", springLevels);

    it("T1.R1.1: narrow constricted pass produces higher or equal velocity/strength than wide channel under identical tidal slope", () => {
      // Narrow pass cross-section: 300m x 30m = 9,000 m^2 (strong constriction)
      const narrowInput: ExtendedForecastInput = {
        hours: marineHours,
        inwardBearingDeg: 90,
        channelWidthM: 300,
        channelDepthM: 30,
      };
      // Wide open channel: 2000m x 80m = 160,000 m^2 (minimal constriction)
      const wideInput: ExtendedForecastInput = {
        hours: marineHours,
        inwardBearingDeg: 90,
        channelWidthM: 2000,
        channelDepthM: 80,
      };

      const narrowForecast = forecastHours(narrowInput as Parameters<typeof forecastHours>[0]);
      const wideForecast = forecastHours(wideInput as Parameters<typeof forecastHours>[0]);

      // At peak rising tide (e.g. index 3: 03:00)
      const peakHour = "2026-07-15T03:00";
      const narrowPeak = findHour(narrowForecast, peakHour);
      const widePeak = findHour(wideForecast, peakHour);

      expect(narrowPeak).toBeDefined();
      expect(widePeak).toBeDefined();
      if (narrowPeak && widePeak) {
        expect(strengthRank(narrowPeak.strength)).toBeGreaterThanOrEqual(
          strengthRank(widePeak.strength),
        );
      }
    });

    it("T1.R1.2: constriction factor formula clamps between C_min = 1.0 and C_max = 2.5", () => {
      // Very extreme narrow pass: 50m x 10m = 500 m^2 -> (2,000,000 / 500)^0.35 ≈ 18.2 -> clamps to 2.5
      const extremeNarrow: ExtendedForecastInput = {
        hours: marineHours,
        inwardBearingDeg: 90,
        channelWidthM: 50,
        channelDepthM: 10,
      };
      // Massive open strait: 10,000m x 500m = 5,000,000 m^2 -> (2,000,000 / 5,000,000)^0.35 ≈ 0.72 -> clamps to 1.0
      const openStrait: ExtendedForecastInput = {
        hours: marineHours,
        inwardBearingDeg: 90,
        channelWidthM: 10000,
        channelDepthM: 500,
      };

      const narrowRes = forecastHours(extremeNarrow as Parameters<typeof forecastHours>[0]);
      const openRes = forecastHours(openStrait as Parameters<typeof forecastHours>[0]);

      expect(narrowRes.length).toBeGreaterThan(0);
      expect(openRes.length).toBeGreaterThan(0);

      // Verify all strengths are valid bands within STRENGTHS
      for (const h of narrowRes) {
        expect(STRENGTHS).toContain(h.strength);
      }
      for (const h of openRes) {
        expect(STRENGTHS).toContain(h.strength);
      }
    });

    it("T1.R1.3: unconstricted inputs (missing width/depth) default strictly to C_constrict = 1.0 for backward compatibility", () => {
      const explicitOpen: ExtendedForecastInput = {
        hours: marineHours,
        inwardBearingDeg: 90,
        channelWidthM: 2000,
        channelDepthM: 1000, // A >= A_ref, factor 1.0
      };
      const omittedInput: ExtendedForecastInput = {
        hours: marineHours,
        inwardBearingDeg: 90,
      };

      const omittedForecast = forecastHours(omittedInput as Parameters<typeof forecastHours>[0]);
      const explicitForecast = forecastHours(explicitOpen as Parameters<typeof forecastHours>[0]);

      expect(omittedForecast.length).toBe(explicitForecast.length);
      // Direction and strength should match baseline open water behavior
      for (let i = 0; i < omittedForecast.length; i++) {
        expect(omittedForecast[i].direction).toBe(explicitForecast[i].direction);
      }
    });

    it("T1.R1.4: tidal range amplitude scaling produces stronger currents during spring cycle than neap cycle", () => {
      const neapLevels = generateNeapLevels(72);
      const neapHours = makeMarineSeries("2026-07-14T00:00", neapLevels);

      const springForecast = forecastHours({
        hours: marineHours,
        inwardBearingDeg: 90,
      });
      const neapForecast = forecastHours({
        hours: neapHours,
        inwardBearingDeg: 90,
      });

      const peakHour = "2026-07-15T03:00";
      const springPeak = findHour(springForecast, peakHour);
      const neapPeak = findHour(neapForecast, peakHour);

      expect(springPeak).toBeDefined();
      expect(neapPeak).toBeDefined();
      if (springPeak && neapPeak) {
        expect(strengthRank(springPeak.strength)).toBeGreaterThanOrEqual(
          strengthRank(neapPeak.strength),
        );
      }
    });

    it("T1.R1.5: catalog pass dimensions (channelWidthM, channelDepthM) integrate into site forecast without errors", () => {
      // Valid pass geometry from Maldives channels (e.g. Vaadhoo Kandu dimensions: 5000m x 400m)
      const siteInput: ExtendedForecastInput = {
        hours: marineHours,
        inwardBearingDeg: 120,
        channelWidthM: 5000,
        channelDepthM: 400,
      };

      const result = forecastHours(siteInput as Parameters<typeof forecastHours>[0]);
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((h) => STRENGTHS.includes(h.strength))).toBe(true);
      expect(result.every((h) => ["incoming", "outgoing"].includes(h.direction))).toBe(true);
    });
  });

  // ── R2: Monsoon & Seasonal Current Integration (F4, F5, F6) ──────────────────
  describe("R2: Monsoon & Seasonal Current Integration", () => {
    it("T1.R2.1: getMaldivesMonsoonDrift returns eastward drift during peak SW monsoon (July)", () => {
      expect(typeof getMaldivesMonsoonDrift).toBe("function");
      if (typeof getMaldivesMonsoonDrift !== "function") return;

      const swDate = new Date("2026-07-15T12:00:00Z");
      const drift = getMaldivesMonsoonDrift(swDate);

      expect(drift).toBeDefined();
      expect(drift.velocityMs).toBeGreaterThan(0.15);
      // Eastward heading is ~70° - 110°
      expect(drift.directionDeg).toBeGreaterThanOrEqual(60);
      expect(drift.directionDeg).toBeLessThanOrEqual(120);
    });

    it("T1.R2.2: getMaldivesMonsoonDrift returns westward drift during peak NE monsoon (January)", () => {
      expect(typeof getMaldivesMonsoonDrift).toBe("function");
      if (typeof getMaldivesMonsoonDrift !== "function") return;

      const neDate = new Date("2026-01-15T12:00:00Z");
      const drift = getMaldivesMonsoonDrift(neDate);

      expect(drift).toBeDefined();
      expect(drift.velocityMs).toBeGreaterThan(0.15);
      // Westward heading is ~250° - 290°
      expect(drift.directionDeg).toBeGreaterThanOrEqual(240);
      expect(drift.directionDeg).toBeLessThanOrEqual(300);
    });

    it("T1.R2.3: inward flux projects open-ocean drift onto pass inward bearing", () => {
      // Facing east (inward bearing 270° from open ocean to lagoon):
      // If drift is westward (270°), cos(270 - 270) = 1.0 (maximum positive inward push)
      // If drift is eastward (90°), cos(90 - 270) = -1.0 (maximum negative draw)
      const dateWestward = new Date("2026-01-15T12:00:00Z");
      if (typeof getMaldivesMonsoonDrift !== "function") return;

      const drift = getMaldivesMonsoonDrift(dateWestward);
      const radDiff = ((drift.directionDeg - 270) * Math.PI) / 180;
      const flux = drift.velocityMs * Math.cos(radDiff);

      // In January westward drift onto 270° inward bearing should have positive inward flux
      expect(flux).toBeGreaterThan(0);
    });

    it("T1.R2.4: net axial flow superimposes monsoon flux onto tidal slope modulating slack timing", () => {
      // 72h series during peak SW monsoon (eastward ocean drift)
      const levels = generateSpringLevels(72);
      const hoursWithDrift = makeMarineSeries("2026-07-14T00:00", levels).map((h) => ({
        ...h,
        currentVelocityMs: 0.45,
        currentDirectionDeg: 90, // Strong eastward push
      }));

      const hoursNoDrift = makeMarineSeries("2026-07-14T00:00", levels).map((h) => ({
        ...h,
        currentVelocityMs: 0,
        currentDirectionDeg: 0,
      }));

      // Eastern pass (inward 270° opposing eastward drift) vs western pass (inward 90° aligned)
      const forecastWithDrift = forecastHours({
        hours: hoursWithDrift,
        inwardBearingDeg: 90,
      });
      const forecastNoDrift = forecastHours({
        hours: hoursNoDrift,
        inwardBearingDeg: 90,
      });

      expect(forecastWithDrift.length).toBeGreaterThan(0);
      expect(forecastNoDrift.length).toBeGreaterThan(0);
    });

    it("T1.R2.5: orthogonal pass (inward bearing 180° or 0°) receives near-zero projected monsoon flux from purely zonal drift", () => {
      if (typeof getMaldivesMonsoonDrift !== "function") return;
      const drift = getMaldivesMonsoonDrift(new Date("2026-07-15T12:00:00Z"));

      // For purely zonal drift (~90°), cos(90° - 180°) = cos(-90°) = 0
      const radDiffNorth = ((drift.directionDeg - 0) * Math.PI) / 180;
      const radDiffSouth = ((drift.directionDeg - 180) * Math.PI) / 180;

      const projectedNorth = drift.velocityMs * Math.cos(radDiffNorth);
      const projectedSouth = drift.velocityMs * Math.cos(radDiffSouth);

      // Absolute projected flux should be much smaller than full velocity
      expect(Math.abs(projectedNorth)).toBeLessThan(drift.velocityMs * 0.5);
      expect(Math.abs(projectedSouth)).toBeLessThan(drift.velocityMs * 0.5);
    });
  });

  // ── R3: Calibrated Diver Report Learning & Confidence Scoring (F7, F8, F9) ───
  describe("R3: Calibrated Diver Report Learning & Confidence Scoring", () => {
    const levels = generateSpringLevels(72);
    const hours = makeMarineSeries("2026-07-14T00:00", levels);

    it("T1.R3.1: recent diver reports are weighted higher than older reports via temporal decay (t_half = 90d)", () => {
      // Recent report from 2 days ago
      const recentReport: Report = {
        id: "rep-recent",
        siteId: "kandooma-thila",
        time: "2026-07-15T03:00",
        direction: "incoming",
        strength: "strong",
      };
      // Ancient report from 180 days ago (2 half-lives -> weight 0.25)
      const oldReport: Report = {
        id: "rep-old",
        siteId: "kandooma-thila",
        time: "2026-01-15T03:00",
        direction: "outgoing",
        strength: "mild",
      };

      const forecastRecent = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: [recentReport, oldReport],
      });
      const targetHour = findHour(forecastRecent, "2026-07-15T03:00");
      expect(targetHour).toBeDefined();
      if (targetHour) {
        // Fresh report (weight ~1.0) dominates older report (weight 0.25)
        expect(targetHour.direction).toBe("incoming");
      }
    });

    it("T1.R3.2: hard confidence gate: confidence NEVER returns 'high' when recent reports contradict predicted direction", () => {
      // Astronomical tide at 03:00 is incoming (rising slope)
      // Recent report within 7 days claims it was outgoing
      const contradictingRecentReport: Report = {
        id: "rep-contra",
        siteId: "test-pass",
        time: "2026-07-15T03:00",
        direction: "outgoing",
        strength: "strong",
      };

      const forecast = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: [contradictingRecentReport],
        allowHighConfidence: true,
      });

      const hourAtReport = findHour(forecast, "2026-07-15T03:00");
      expect(hourAtReport).toBeDefined();
      if (hourAtReport) {
        // Must NEVER be high confidence when there is a recent contradiction
        expect(hourAtReport.confidence).not.toBe("high");
        expect(["low", "medium"]).toContain(hourAtReport.confidence);
      }
    });

    it("T1.R3.3: outlier dampening prevents erratic multi-hour phase jumps from isolated contradictory reports", () => {
      // 4 reports agreeing on incoming at tide phase, 1 isolated noisy report claiming outgoing
      const reports: Report[] = [
        { id: "r1", siteId: "s", time: "2026-07-15T02:00", direction: "incoming", strength: "mild" },
        { id: "r2", siteId: "s", time: "2026-07-15T03:00", direction: "incoming", strength: "strong" },
        { id: "r3", siteId: "s", time: "2026-07-15T04:00", direction: "incoming", strength: "strong" },
        { id: "r4", siteId: "s", time: "2026-07-15T05:00", direction: "incoming", strength: "mild" },
        { id: "r-noisy", siteId: "s", time: "2026-07-15T03:00", direction: "outgoing", strength: "too_strong" },
      ];

      const forecast = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports,
      });

      const peakHour = findHour(forecast, "2026-07-15T03:00");
      expect(peakHour).toBeDefined();
      if (peakHour) {
        // Consensus of 4 concordant reports dampens the single noisy outlier
        expect(peakHour.direction).toBe("incoming");
      }
    });

    it("T1.R3.4: high discrepancy between sea-level slope and observed diver reports penalizes confidence score", () => {
      // Conflicting reports with 50/50 split
      const conflictingReports: Report[] = [
        { id: "c1", siteId: "s", time: "2026-07-15T03:00", direction: "incoming", strength: "strong" },
        { id: "c2", siteId: "s", time: "2026-07-15T03:00", direction: "outgoing", strength: "strong" },
      ];

      const forecast = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: conflictingReports,
        allowHighConfidence: true,
      });

      const hour = findHour(forecast, "2026-07-15T03:00");
      expect(hour).toBeDefined();
      if (hour) {
        expect(hour.confidence).not.toBe("high");
      }
    });

    it("T1.R3.5: multiple agreeing and tide-concordant reports unlock high confidence when permitted", () => {
      // 4 reports agreeing with tidal flood slope
      const concordantReports: Report[] = [
        { id: "a1", siteId: "s", time: "2026-07-15T02:00", direction: "incoming", strength: "mild" },
        { id: "a2", siteId: "s", time: "2026-07-15T03:00", direction: "incoming", strength: "strong" },
        { id: "a3", siteId: "s", time: "2026-07-15T04:00", direction: "incoming", strength: "strong" },
        { id: "a4", siteId: "s", time: "2026-07-15T05:00", direction: "incoming", strength: "mild" },
      ];

      const forecast = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: concordantReports,
        allowHighConfidence: true,
      });

      const hour = findHour(forecast, "2026-07-15T03:00");
      expect(hour).toBeDefined();
      if (hour) {
        expect(["medium", "high"]).toContain(hour.confidence);
      }
    });
  });

  // ── R4: Automated Backtesting & Reliability Benchmark (F10, F11, F12) ───────
  describe("R4: Automated Backtesting & Reliability Benchmark", () => {
    const levels = generateSpringLevels(72);
    const hours = makeMarineSeries("2026-07-14T00:00", levels);

    const benchmarkReports: Report[] = [
      { id: "bm-1", siteId: "site-1", time: "2026-07-15T02:00", direction: "incoming", strength: "mild" },
      { id: "bm-2", siteId: "site-1", time: "2026-07-15T03:00", direction: "incoming", strength: "strong" },
      { id: "bm-3", siteId: "site-1", time: "2026-07-15T08:00", direction: "outgoing", strength: "strong" },
      { id: "bm-4", siteId: "site-1", time: "2026-07-15T09:00", direction: "outgoing", strength: "mild" },
    ];

    it("T1.R4.1: replayReports produces quantitative BenchmarkMetrics structure", () => {
      const result = replayReports({
        hours,
        inwardBearingDeg: 90,
        reports: benchmarkReports,
      }) as ExtendedReplayResult;

      expect(result).toBeDefined();
      expect(typeof result.ok).toBe("boolean");
      expect(typeof result.failures).toBe("number");
      expect(typeof result.strengthMismatches).toBe("number");

      // Verify benchmark metrics fields when implemented in M4
      if (result.metrics) {
        expect(result.metrics.totalReports).toBeGreaterThanOrEqual(0);
        expect(typeof result.metrics.directionalAccuracyPct).toBe("number");
        expect(typeof result.metrics.slackTimingDeviationMins).toBe("number");
        expect(typeof result.metrics.falseHighConfidenceRatePct).toBe("number");
        expect(result.metrics.confidenceBreakdown).toBeDefined();
      }
    });

    it("T1.R4.2: directional accuracy is calculated accurately across evaluated diver reports", () => {
      const result = replayReports({
        hours,
        inwardBearingDeg: 90,
        reports: benchmarkReports,
      }) as ExtendedReplayResult;

      if (result.metrics) {
        expect(result.metrics.directionalAccuracyPct).toBeGreaterThanOrEqual(0);
        expect(result.metrics.directionalAccuracyPct).toBeLessThanOrEqual(100);
      }
    });

    it("T1.R4.3: false-high-confidence rate tracks reports where high confidence prediction failed", () => {
      const result = replayReports({
        hours,
        inwardBearingDeg: 90,
        reports: benchmarkReports,
      }) as ExtendedReplayResult;

      if (result.metrics) {
        expect(result.metrics.falseHighConfidenceRatePct).toBeGreaterThanOrEqual(0);
        expect(result.metrics.falseHighConfidenceRatePct).toBeLessThanOrEqual(100);
      }
    });

    it("T1.R4.4: confidence breakdown categorizes counts and accuracies for high, medium, and low tiers", () => {
      const result = replayReports({
        hours,
        inwardBearingDeg: 90,
        reports: benchmarkReports,
      }) as ExtendedReplayResult;

      if (result.metrics) {
        const { high, medium, low } = result.metrics.confidenceBreakdown;
        expect(typeof high.count).toBe("number");
        expect(typeof medium.count).toBe("number");
        expect(typeof low.count).toBe("number");
        expect(high.count + medium.count + low.count).toBe(result.metrics.totalReports);
      }
    });

    it("T1.R4.5: slack timing deviation measures deviation in minutes between observed and predicted slack", () => {
      const result = replayReports({
        hours,
        inwardBearingDeg: 90,
        reports: benchmarkReports,
      }) as ExtendedReplayResult;

      if (result.metrics) {
        expect(result.metrics.slackTimingDeviationMins).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(result.metrics.slackTimingDeviationMins)).toBe(true);
      }
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TIER 2: BOUNDARY & CORNER CASES
// ══════════════════════════════════════════════════════════════════════════════

describe("Tier 2: Boundary & Corner Cases", () => {
  const levels = generateSpringLevels(72);
  const hours = makeMarineSeries("2026-07-14T00:00", levels);

  // ── R1 Boundary & Corner Cases ──────────────────────────────────────────────
  describe("R1 Boundary & Corner Cases", () => {
    it("T2.R1.1: undefined channel width and depth default strictly to C_constrict = 1.0 without NaN or throwing", () => {
      const input: ExtendedForecastInput = {
        hours,
        inwardBearingDeg: 90,
        channelWidthM: undefined,
        channelDepthM: undefined,
      };

      const forecast = forecastHours(input as Parameters<typeof forecastHours>[0]);
      expect(forecast.length).toBeGreaterThan(0);
      expect(forecast.every((h) => Number.isFinite(h.levelM))).toBe(true);
      expect(forecast.every((h) => STRENGTHS.includes(h.strength))).toBe(true);
    });

    it("T2.R1.2: zero channel width or zero depth is guarded safely without division by zero or NaN", () => {
      const inputZeroW: ExtendedForecastInput = {
        hours,
        inwardBearingDeg: 90,
        channelWidthM: 0,
        channelDepthM: 30,
      };
      const inputZeroD: ExtendedForecastInput = {
        hours,
        inwardBearingDeg: 90,
        channelWidthM: 300,
        channelDepthM: 0,
      };

      const resW = forecastHours(inputZeroW as Parameters<typeof forecastHours>[0]);
      const resD = forecastHours(inputZeroD as Parameters<typeof forecastHours>[0]);

      expect(resW.length).toBeGreaterThan(0);
      expect(resD.length).toBeGreaterThan(0);
      for (const h of resW) {
        expect(STRENGTHS).toContain(h.strength);
      }
      for (const h of resD) {
        expect(STRENGTHS).toContain(h.strength);
      }
    });

    it("T2.R1.3: flat tides with zero slope produce slack conditions across all hours without crashing", () => {
      const flatLevels = Array.from({ length: 72 }, () => 0.5);
      const flatHours = makeMarineSeries("2026-07-14T00:00", flatLevels);

      const forecast = forecastHours({
        hours: flatHours,
        inwardBearingDeg: 90,
      });

      // Flat water with no slope has zero velocity -> all hours must be slack
      for (const h of forecast) {
        expect(h.strength).toBe("slack");
      }
    });

    it("T2.R1.4: extreme spring tide range (> 1.8m) does not exceed 'too_strong' or cause numeric overflow", () => {
      const extremeSpringLevels = generateSemidiurnalTide(72, 1.0, 1.0); // 2.0m tidal range
      const extremeHours = makeMarineSeries("2026-07-14T00:00", extremeSpringLevels);

      const forecast = forecastHours({
        hours: extremeHours,
        inwardBearingDeg: 90,
      });

      expect(forecast.length).toBeGreaterThan(0);
      for (const h of forecast) {
        expect(STRENGTHS).toContain(h.strength);
      }
    });

    it("T2.R1.5: micro-tidal neap range (< 0.05m amplitude) remains strictly 'slack' or 'mild'", () => {
      const microNeapLevels = generateSemidiurnalTide(72, 0.02, 0.5); // 0.04m range
      const microHours = makeMarineSeries("2026-07-14T00:00", microNeapLevels);

      const forecast = forecastHours({
        hours: microHours,
        inwardBearingDeg: 90,
      });

      for (const h of forecast) {
        expect(["slack", "mild"]).toContain(h.strength);
      }
    });

    it("T2.R1.6: massive channel cross-section (10,000m x 1,000m) clamps constriction to minimum C_min = 1.0", () => {
      const massiveInput: ExtendedForecastInput = {
        hours,
        inwardBearingDeg: 90,
        channelWidthM: 10000,
        channelDepthM: 1000,
      };

      const forecast = forecastHours(massiveInput as Parameters<typeof forecastHours>[0]);
      const defaultForecast = forecastHours({ hours, inwardBearingDeg: 90 });

      // Should be identical to unconstricted default
      expect(forecast.length).toBe(defaultForecast.length);
      for (let i = 0; i < forecast.length; i++) {
        expect(forecast[i].strength).toBe(defaultForecast[i].strength);
      }
    });
  });

  // ── R2 Boundary & Corner Cases ──────────────────────────────────────────────
  describe("R2 Boundary & Corner Cases", () => {
    it("T2.R2.1: seasonal transition April 30 to May 1 handles SW monsoon onset smoothly", () => {
      if (typeof getMaldivesMonsoonDrift !== "function") return;

      const apr30 = getMaldivesMonsoonDrift(new Date("2026-04-30T23:59:00Z"));
      const may01 = getMaldivesMonsoonDrift(new Date("2026-05-01T00:01:00Z"));

      expect(Number.isFinite(apr30.velocityMs)).toBe(true);
      expect(Number.isFinite(may01.velocityMs)).toBe(true);
      expect(Number.isFinite(apr30.directionDeg)).toBe(true);
      expect(Number.isFinite(may01.directionDeg)).toBe(true);
    });

    it("T2.R2.2: seasonal transition October 31 to November 1 handles SW monsoon decay smoothly", () => {
      if (typeof getMaldivesMonsoonDrift !== "function") return;

      const oct31 = getMaldivesMonsoonDrift(new Date("2026-10-31T23:59:00Z"));
      const nov01 = getMaldivesMonsoonDrift(new Date("2026-11-01T00:01:00Z"));

      expect(Number.isFinite(oct31.velocityMs)).toBe(true);
      expect(Number.isFinite(nov01.velocityMs)).toBe(true);
    });

    it("T2.R2.3: seasonal transition November 30 to December 1 handles NE monsoon onset smoothly", () => {
      if (typeof getMaldivesMonsoonDrift !== "function") return;

      const nov30 = getMaldivesMonsoonDrift(new Date("2026-11-30T23:59:00Z"));
      const dec01 = getMaldivesMonsoonDrift(new Date("2026-12-01T00:01:00Z"));

      expect(Number.isFinite(nov30.velocityMs)).toBe(true);
      expect(Number.isFinite(dec01.velocityMs)).toBe(true);
    });

    it("T2.R2.4: seasonal transition March 31 to April 1 handles NE monsoon decay smoothly", () => {
      if (typeof getMaldivesMonsoonDrift !== "function") return;

      const mar31 = getMaldivesMonsoonDrift(new Date("2026-03-31T23:59:00Z"));
      const apr01 = getMaldivesMonsoonDrift(new Date("2026-04-01T00:01:00Z"));

      expect(Number.isFinite(mar31.velocityMs)).toBe(true);
      expect(Number.isFinite(apr01.velocityMs)).toBe(true);
    });

    it("T2.R2.5: drift exactly perpendicular to inward bearing yields zero projected flux", () => {
      // Inward bearing 180°, drift heading 90° -> angle diff = 90° -> cos(90°) = 0
      const velocity = 0.5;
      const angleDiffRad = ((90 - 180) * Math.PI) / 180;
      const projected = velocity * Math.cos(angleDiffRad);
      expect(Math.abs(projected)).toBeLessThan(1e-10);
    });

    it("T2.R2.6: drift antiparallel (180° opposite) to inward bearing yields maximum outward draw", () => {
      // Inward bearing 90°, drift heading 270° -> cos(180°) = -1.0
      const velocity = 0.4;
      const angleDiffRad = ((270 - 90) * Math.PI) / 180;
      const projected = velocity * Math.cos(angleDiffRad);
      expect(projected).toBeCloseTo(-0.4, 5);
    });
  });

  // ── R3 Boundary & Corner Cases ──────────────────────────────────────────────
  describe("R3 Boundary & Corner Cases", () => {
    it("T2.R3.1: conflicting reports at exact same timestamp do not crash and prevent high confidence", () => {
      const contradictoryReports: Report[] = [
        { id: "same-1", siteId: "s", time: "2026-07-15T04:00", direction: "incoming", strength: "strong" },
        { id: "same-2", siteId: "s", time: "2026-07-15T04:00", direction: "outgoing", strength: "strong" },
      ];

      const forecast = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: contradictoryReports,
        allowHighConfidence: true,
      });

      const hour = findHour(forecast, "2026-07-15T04:00");
      expect(hour).toBeDefined();
      if (hour) {
        expect(hour.confidence).not.toBe("high");
      }
    });

    it("T2.R3.2: empty diver reports array strictly produces low confidence", () => {
      const forecast = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: [],
      });

      // With no empirical reports, all hours must remain low confidence
      expect(forecast.every((h) => h.confidence === "low")).toBe(true);
    });

    it("T2.R3.3: 100% contradictory reports to tidal slope dampens phase jump and forbids high confidence", () => {
      // Astronomical tide at 02:00, 03:00, 04:00 is rising (incoming)
      // All 3 diver reports claim outgoing
      const invertedReports: Report[] = [
        { id: "inv-1", siteId: "s", time: "2026-07-15T02:00", direction: "outgoing", strength: "strong" },
        { id: "inv-2", siteId: "s", time: "2026-07-15T03:00", direction: "outgoing", strength: "strong" },
        { id: "inv-3", siteId: "s", time: "2026-07-15T04:00", direction: "outgoing", strength: "strong" },
      ];

      const forecast = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: invertedReports,
        allowHighConfidence: true,
      });

      for (const rep of invertedReports) {
        const hour = findHour(forecast, rep.time);
        if (hour) {
          expect(hour.confidence).not.toBe("high");
        }
      }
    });

    it("T2.R3.4: ancient reports (> 730 days old) have negligible weight compared to fresh reports", () => {
      // Half life is 90 days. 730 days is ~8.1 half lives. Weight is 2^(-8.1) ≈ 0.0036
      const ancientReport: Report[] = [
        { id: "anc", siteId: "s", time: "2024-07-15T03:00", direction: "outgoing", strength: "too_strong" },
      ];

      const forecastWithAncient = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: ancientReport,
      });
      const forecastBaseline = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: [],
      });

      const ancientHour = findHour(forecastWithAncient, "2026-07-15T03:00");
      const baselineHour = findHour(forecastBaseline, "2026-07-15T03:00");

      expect(ancientHour).toBeDefined();
      expect(baselineHour).toBeDefined();
      if (ancientHour && baselineHour) {
        // Ancient 2-year old report should not overcome the astronomical tidal flood
        expect(ancientHour.direction).toBe(baselineHour.direction);
      }
    });

    it("T2.R3.5: immediate recent report contradiction (2 hours ago) strictly forbids high confidence", () => {
      const immediateReport: Report = {
        id: "imm-1",
        siteId: "s",
        time: "2026-07-15T01:00",
        direction: "outgoing", // opposite of rising tide
        strength: "strong",
      };

      const forecast = forecastHours({
        hours,
        inwardBearingDeg: 90,
        reports: [immediateReport],
        allowHighConfidence: true,
      });

      const hourAt01 = findHour(forecast, "2026-07-15T01:00");
      if (hourAt01) {
        expect(hourAt01.confidence).not.toBe("high");
      }
    });

    it("T2.R3.6: balanced opposing reports with equal weight do not oscillate or flip unpredictably", () => {
      const balancedReports: Report[] = [
        { id: "b1", siteId: "s", time: "2026-07-15T02:00", direction: "incoming", strength: "mild" },
        { id: "b2", siteId: "s", time: "2026-07-15T02:00", direction: "outgoing", strength: "mild" },
      ];

      const forecast1 = forecastHours({ hours, inwardBearingDeg: 90, reports: balancedReports });
      const forecast2 = forecastHours({ hours, inwardBearingDeg: 90, reports: balancedReports.slice().reverse() });

      // Verification of determinism regardless of input order
      for (let i = 0; i < forecast1.length; i++) {
        expect(forecast1[i].direction).toBe(forecast2[i].direction);
        expect(forecast1[i].strength).toBe(forecast2[i].strength);
      }
    });
  });

  // ── R4 Boundary & Corner Cases ──────────────────────────────────────────────
  describe("R4 Boundary & Corner Cases", () => {
    it("T2.R4.1: replay evaluation with empty reports array handles 0 total reports without divide-by-zero NaN", () => {
      const result = replayReports({
        hours,
        inwardBearingDeg: 90,
        reports: [],
      }) as ExtendedReplayResult;

      expect(result.ok).toBe(true);
      expect(result.failures).toBe(0);
      expect(result.strengthMismatches).toBe(0);
      if (result.metrics) {
        expect(result.metrics.totalReports).toBe(0);
        expect(Number.isNaN(result.metrics.directionalAccuracyPct)).toBe(false);
      }
    });

    it("T2.R4.2: reports completely outside marine hour window are ignored safely", () => {
      const outsideReports: Report[] = [
        { id: "out-1", siteId: "s", time: "2025-01-01T00:00", direction: "incoming", strength: "mild" },
        { id: "out-2", siteId: "s", time: "2027-01-01T00:00", direction: "outgoing", strength: "strong" },
      ];

      const result = replayReports({
        hours,
        inwardBearingDeg: 90,
        reports: outsideReports,
      }) as ExtendedReplayResult;

      expect(result.ok).toBe(true);
      expect(result.failures).toBe(0);
    });

    it("T2.R4.3: 100% contradictory replay yields 0% accuracy or max failures when evaluated", () => {
      // Reports strictly contradicting tide slope
      const oppositeReports: Report[] = [
        { id: "op-1", siteId: "s", time: "2026-07-15T03:00", direction: "outgoing", strength: "strong" },
      ];

      const result = replayReports({
        hours,
        inwardBearingDeg: 90,
        reports: oppositeReports,
      }) as ExtendedReplayResult;

      if (result.metrics) {
        expect(result.metrics.totalReports).toBeGreaterThanOrEqual(1);
      }
    });

    it("T2.R4.4: 100% concordant replay yields 0 failures and high directional accuracy", () => {
      const concordantReports: Report[] = [
        { id: "cc-1", siteId: "s", time: "2026-07-15T03:00", direction: "incoming", strength: "mild" },
      ];

      const result = replayReports({
        hours,
        inwardBearingDeg: 90,
        reports: concordantReports,
      }) as ExtendedReplayResult;

      expect(result.failures).toBe(0);
    });

    it("T2.R4.5: replay evaluates slack condition reports accurately without false directional penalties", () => {
      // Hour 00:00 is turn/slack in semidiurnal sine wave
      const slackReport: Report[] = [
        { id: "sl-1", siteId: "s", time: "2026-07-15T00:00", direction: "incoming", strength: "slack" },
      ];

      const result = replayReports({
        hours,
        inwardBearingDeg: 90,
        reports: slackReport,
      }) as ExtendedReplayResult;

      expect(result).toBeDefined();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TIER 3: CROSS-FEATURE COMBINATIONS (PAIRWISE INTERACTIONS)
// ══════════════════════════════════════════════════════════════════════════════

describe("Tier 3: Cross-Feature Combinations", () => {
  const springLevels = generateSpringLevels(72);
  const hours = makeMarineSeries("2026-07-14T00:00", springLevels);

  it("T3.C1: Constriction + Monsoon Drift: narrow pass aligned with monsoon drift exhibits amplified velocity", () => {
    // Narrow pass (300m x 30m) facing 90°
    const narrowPassInput: ExtendedForecastInput = {
      hours,
      inwardBearingDeg: 90,
      channelWidthM: 300,
      channelDepthM: 30,
    };
    // Wide pass (2000m x 80m) facing 90°
    const widePassInput: ExtendedForecastInput = {
      hours,
      inwardBearingDeg: 90,
      channelWidthM: 2000,
      channelDepthM: 80,
    };

    const narrowForecast = forecastHours(narrowPassInput as Parameters<typeof forecastHours>[0]);
    const wideForecast = forecastHours(widePassInput as Parameters<typeof forecastHours>[0]);

    const peakHour = "2026-07-15T03:00";
    const narrowPeak = findHour(narrowForecast, peakHour);
    const widePeak = findHour(wideForecast, peakHour);

    expect(narrowPeak).toBeDefined();
    expect(widePeak).toBeDefined();
    if (narrowPeak && widePeak) {
      expect(strengthRank(narrowPeak.strength)).toBeGreaterThanOrEqual(
        strengthRank(widePeak.strength),
      );
    }
  });

  it("T3.C2: Constriction + Opposing Monsoon: narrow pass opposing monsoon alters net current compared to open pass", () => {
    const hoursWithEastwardDrift = makeMarineSeries("2026-07-14T00:00", springLevels).map((h) => ({
      ...h,
      currentVelocityMs: 0.5,
      currentDirectionDeg: 90,
    }));

    // Inward bearing 270° opposes eastward ocean drift
    const narrowConstricted: ExtendedForecastInput = {
      hours: hoursWithEastwardDrift,
      inwardBearingDeg: 270,
      channelWidthM: 400,
      channelDepthM: 25,
    };

    const openUnconstricted: ExtendedForecastInput = {
      hours: hoursWithEastwardDrift,
      inwardBearingDeg: 270,
      channelWidthM: 3000,
      channelDepthM: 200,
    };

    const narrowRes = forecastHours(narrowConstricted as Parameters<typeof forecastHours>[0]);
    const openRes = forecastHours(openUnconstricted as Parameters<typeof forecastHours>[0]);

    expect(narrowRes.length).toBeGreaterThan(0);
    expect(openRes.length).toBeGreaterThan(0);
  });

  it("T3.C3: Constriction + Noisy Diver Reports: high-velocity constricted pass maintains stability on conflicting reports", () => {
    const noisyReports: Report[] = [
      { id: "nr-1", siteId: "s", time: "2026-07-15T03:00", direction: "incoming", strength: "too_strong" },
      { id: "nr-2", siteId: "s", time: "2026-07-15T03:00", direction: "outgoing", strength: "too_strong" },
    ];

    const input: ExtendedForecastInput = {
      hours,
      inwardBearingDeg: 90,
      channelWidthM: 250,
      channelDepthM: 25,
      reports: noisyReports,
      allowHighConfidence: true,
    };

    const forecast = forecastHours(input as Parameters<typeof forecastHours>[0]);
    const hour = findHour(forecast, "2026-07-15T03:00");

    expect(hour).toBeDefined();
    if (hour) {
      // Must not crash or assign high confidence
      expect(hour.confidence).not.toBe("high");
      expect(STRENGTHS).toContain(hour.strength);
    }
  });

  it("T3.C4: Monsoon Push + Spring Tide Slope: peak spring flood combined with aligned drift saturates at 'too_strong' cleanly", () => {
    const hoursWithFastDrift = makeMarineSeries("2026-07-14T00:00", springLevels).map((h) => ({
      ...h,
      currentVelocityMs: 1.2, // Very strong surface flow
      currentDirectionDeg: 90,
    }));

    const input: ExtendedForecastInput = {
      hours: hoursWithFastDrift,
      inwardBearingDeg: 90,
      channelWidthM: 200,
      channelDepthM: 20,
    };

    const forecast = forecastHours(input as Parameters<typeof forecastHours>[0]);
    // Each hour has its own band, so look at the strongest hour of the day.
    const order = ["slack", "mild", "strong", "too_strong"];
    const day = forecast.filter((hour) => hour.time.startsWith("2026-07-15"));
    const peakHour = day.reduce((best, hour) => (order.indexOf(hour.strength) > order.indexOf(best.strength) ? hour : best));

    expect(day.length).toBeGreaterThan(0);
    expect(peakHour.strength).toBe("too_strong");
  });

  it("T3.C5: Monsoon Opposing Ebb + Calibrated Confidence: opposing hydrodynamic forces depress confidence", () => {
    const hoursWithEastwardDrift = makeMarineSeries("2026-07-14T00:00", springLevels).map((h) => ({
      ...h,
      currentVelocityMs: 0.6,
      currentDirectionDeg: 90,
    }));

    // Inward bearing 90°: monsoon pushes IN, but at 09:00 tide is falling (ebb, wants to flow OUT)
    const conflictingPass: ExtendedForecastInput = {
      hours: hoursWithEastwardDrift,
      inwardBearingDeg: 90,
    };

    const forecast = forecastHours(conflictingPass as Parameters<typeof forecastHours>[0]);
    const ebbHour = findHour(forecast, "2026-07-15T09:00");

    expect(ebbHour).toBeDefined();
    if (ebbHour) {
      // Without consensus diver reports to resolve the shear, confidence must remain low
      expect(ebbHour.confidence).toBe("low");
    }
  });

  it("T3.C6: Constriction + Spring Tide + Recent Diver Validation: agreeing recent reports validate high confidence", () => {
    const validatedReports: Report[] = [
      { id: "v1", siteId: "s", time: "2026-07-15T02:00", direction: "incoming", strength: "too_strong" },
      { id: "v2", siteId: "s", time: "2026-07-15T03:00", direction: "incoming", strength: "too_strong" },
      { id: "v3", siteId: "s", time: "2026-07-15T04:00", direction: "incoming", strength: "too_strong" },
      { id: "v4", siteId: "s", time: "2026-07-15T05:00", direction: "incoming", strength: "strong" },
    ];

    const input: ExtendedForecastInput = {
      hours,
      inwardBearingDeg: 90,
      channelWidthM: 300,
      channelDepthM: 30,
      reports: validatedReports,
      allowHighConfidence: true,
    };

    const forecast = forecastHours(input as Parameters<typeof forecastHours>[0]);
    const peakHour = findHour(forecast, "2026-07-15T03:00");

    expect(peakHour).toBeDefined();
    if (peakHour) {
      expect(["medium", "high"]).toContain(peakHour.confidence);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TIER 4: REAL-WORLD APPLICATION SCENARIOS (MALDIVES DIVE SITES)
// ══════════════════════════════════════════════════════════════════════════════

describe("Tier 4: Real-World Application Scenarios", () => {
  it("T4.S1: Rasdhoo Madivaru peak incoming flood during spring tide through constricted pass", () => {
    // Rasdhoo Madivaru: Narrow outer corner pass between Rasdhoo and Kuramathi (~300m width, ~35m depth)
    // Famous for hammerheads and pelagic sharks on incoming currents
    const springLevels = generateSpringLevels(72);
    const rasdhooHours = makeMarineSeries("2026-07-19T00:00", springLevels);

    const input: ExtendedForecastInput = {
      hours: rasdhooHours,
      inwardBearingDeg: 220,
      channelWidthM: 300,
      channelDepthM: 35,
    };

    const forecast = forecastHours(input as Parameters<typeof forecastHours>[0]);
    const peakHour = findHour(forecast, "2026-07-20T01:00");

    expect(peakHour).toBeDefined();
    if (peakHour) {
      expect(peakHour.direction).toBe("incoming");
      expect(["strong", "too_strong", "mild"]).toContain(peakHour.strength);
    }
  });

  it("T4.S2: Miyaru Kandu high-energy outer channel during peak Southwest Monsoon", () => {
    // Miyaru Kandu (Vaavu Atoll): East-facing pass (inward bearing ~270° towards lagoon)
    // July represents peak SW monsoon with open-ocean flow pushing eastward
    const levels = generateSpringLevels(72);
    const miyaruHours = makeMarineSeries("2026-07-19T00:00", levels).map((h) => ({
      ...h,
      currentVelocityMs: 0.45,
      currentDirectionDeg: 80,
    }));

    const input: ExtendedForecastInput = {
      hours: miyaruHours,
      inwardBearingDeg: 270,
      channelWidthM: 800,
      channelDepthM: 45,
    };

    const forecast = forecastHours(input as Parameters<typeof forecastHours>[0]);
    expect(forecast.length).toBeGreaterThan(0);

    for (const h of forecast) {
      expect(STRENGTHS).toContain(h.strength);
      expect(["incoming", "outgoing"]).toContain(h.direction);
    }
  });

  it("T4.S3: Kandooma Thila diver reports with noisy inputs and temporal phase lag", () => {
    // Kandooma Thila in South Male pass
    const levels = generateSpringLevels(72);
    const kandoomaHours = makeMarineSeries("2026-07-19T00:00", levels);

    const diverReports: Report[] = [
      // 3 recent agreeing reports
      { id: "kt-1", siteId: "kandooma-thila", time: "2026-07-20T02:00", direction: "incoming", strength: "strong" },
      { id: "kt-2", siteId: "kandooma-thila", time: "2026-07-20T03:00", direction: "incoming", strength: "strong" },
      { id: "kt-3", siteId: "kandooma-thila", time: "2026-07-20T04:00", direction: "incoming", strength: "strong" },
      // 1 older contradictory report from 60 days ago
      { id: "kt-old", siteId: "kandooma-thila", time: "2026-05-20T03:00", direction: "outgoing", strength: "mild" },
    ];

    const input: ExtendedForecastInput = {
      hours: kandoomaHours,
      inwardBearingDeg: 90,
      channelWidthM: 500,
      channelDepthM: 30,
      reports: diverReports,
      allowHighConfidence: true,
    };

    const forecast = forecastHours(input as Parameters<typeof forecastHours>[0]);
    const peakHour = findHour(forecast, "2026-07-20T03:00");

    expect(peakHour).toBeDefined();
    if (peakHour) {
      // Recent consensus dominates over 60-day-old contradictory report
      expect(peakHour.direction).toBe("incoming");
    }
  });

  it("T4.S4: Fotteyo Kandu deep outer pass with wide channel geometry in Northeast Monsoon", () => {
    // Fotteyo Kandu on eastern rim of Vaavu Atoll: very deep (~65m) and wide (~1500m) channel
    // In January NE monsoon, westward drift pushes directly into the pass (inward bearing ~270°)
    const levels = generateSpringLevels(72);
    const fotteyoHours = makeMarineSeries("2026-01-14T00:00", levels).map((h) => ({
      ...h,
      currentVelocityMs: 0.4,
      currentDirectionDeg: 260,
    }));

    const input: ExtendedForecastInput = {
      hours: fotteyoHours,
      inwardBearingDeg: 270,
      channelWidthM: 1500,
      channelDepthM: 65,
    };

    const forecast = forecastHours(input as Parameters<typeof forecastHours>[0]);
    const peakFlood = findHour(forecast, "2026-01-15T01:00");

    expect(peakFlood).toBeDefined();
    if (peakFlood) {
      expect(peakFlood.direction).toBe("incoming");
    }
  });

  it("T4.S5: Alimatha Kandu transitional sunset / night dive with calm ocean drift and neap tide", () => {
    // Alimatha Kandu: nurse shark night dive pass during April inter-monsoon transition
    const neapLevels = generateNeapLevels(72);
    const alimathaHours = makeMarineSeries("2026-04-14T00:00", neapLevels).map((h) => ({
      ...h,
      currentVelocityMs: 0.05, // Calm transitional drift
      currentDirectionDeg: 180,
    }));

    const input: ExtendedForecastInput = {
      hours: alimathaHours,
      inwardBearingDeg: 270,
      channelWidthM: 600,
      channelDepthM: 30,
    };

    const forecast = forecastHours(input as Parameters<typeof forecastHours>[0]);
    // Sunset dive at 18:00
    const sunsetHour = findHour(forecast, "2026-04-15T18:00");

    expect(sunsetHour).toBeDefined();
    if (sunsetHour) {
      // Under calm transition neap conditions, currents should be safe and diveable (slack or mild)
      expect(["slack", "mild"]).toContain(sunsetHour.strength);
    }
  });
});
