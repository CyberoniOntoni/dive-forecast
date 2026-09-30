import { describe, expect, it } from "vitest";
import {
  forecastHours,
  getMaldivesMonsoonDrift,
  monsoonInwardFlux,
  resolveHourDrift,
} from "../lib/forecast";
import {
  STRENGTHS,
  type Direction,
  type MarineHour,
  type OceanDrift,
  type Strength,
} from "../lib/types";

const STRENGTH_LEVELS: Record<Strength, number> = {
  slack: 0,
  mild: 1,
  strong: 2,
  too_strong: 3,
};

/**
 * Generate a 72-hour semi-diurnal tidal series with predictable sine-wave sea level.
 * Period = 12 hours.
 */
function createSyntheticMarineSeries(options: {
  startDateIso: string;
  amplitude?: number;
  meanLevel?: number;
  currentVelocityMs?: number | null;
  currentDirectionDeg?: number | null;
}): MarineHour[] {
  const {
    startDateIso,
    amplitude = 0.35,
    meanLevel = 0.5,
    currentVelocityMs = 0,
    currentDirectionDeg = 90,
  } = options;

  const startMs = new Date(startDateIso).getTime();
  return Array.from({ length: 72 }, (_, i) => {
    const timeMs = startMs + i * 3600 * 1000;
    // Format to Maldives wall-clock string YYYY-MM-DDTHH:mm
    const d = new Date(timeMs);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    const hours = String(d.getUTCHours()).padStart(2, "0");
    const mins = String(d.getUTCMinutes()).padStart(2, "0");
    const time = `${year}-${month}-${day}T${hours}:${mins}`;

    const seaLevelM = meanLevel + amplitude * Math.sin((2 * Math.PI * i) / 12);
    return {
      time,
      seaLevelM,
      currentVelocityMs: currentVelocityMs == null ? null : currentVelocityMs,
      currentDirectionDeg: currentDirectionDeg == null ? null : currentDirectionDeg,
    };
  });
}

describe("Adversarial Verification of Milestone 2: Hydrodynamics & Invariant Preservation", () => {
  // ────────────────────────────────────────────────────────────────────────────
  // 1. Extreme Monsoon Scenarios & Vector Dynamics
  // ────────────────────────────────────────────────────────────────────────────
  describe("1. Extreme Monsoon Scenarios (Antiparallel, Orthogonal, Null vs 0)", () => {
    it("1.1 Antiparallel 2.0 m/s push/draw saturates flux without NaN or numeric overflow", () => {
      // 2.0 m/s is ~4 knots (hurricane / extreme ocean jet)
      const inwardBearing = 90; // pass oriented East (open ocean is East, lagoon is West)

      // Direct Head-on Push (aligned with inward bearing): 90°
      const driftAligned: OceanDrift = { velocityMs: 2.0, directionDeg: 90 };
      const fluxAligned = monsoonInwardFlux(driftAligned, inwardBearing);
      expect(fluxAligned).toBeCloseTo(2.0, 6);

      // Direct Antiparallel Draw (opposing inward bearing): 270°
      const driftOpposing: OceanDrift = { velocityMs: 2.0, directionDeg: 270 };
      const fluxOpposing = monsoonInwardFlux(driftOpposing, inwardBearing);
      expect(fluxOpposing).toBeCloseTo(-2.0, 6);

      // Super-extreme input: 50.0 m/s
      const driftSuper: OceanDrift = { velocityMs: 50.0, directionDeg: 270 };
      const fluxSuper = monsoonInwardFlux(driftSuper, inwardBearing);
      expect(fluxSuper).toBeCloseTo(-50.0, 6);
      expect(Number.isFinite(fluxSuper)).toBe(true);
    });

    it("1.2 Antiparallel 2.0 m/s draw overpowers the flood: the channel runs out all day", () => {
      // Flood tide with inward bearing 90°, and an extreme 2.0 m/s ocean current drawing outward (270°).
      // Through-flow is 2.0 m/s × THROUGHFLOW_SLOPE_PER_MS = 1.4 m/h against a tide slope of at most about 0.2 m/h.
      const hours = createSyntheticMarineSeries({
        startDateIso: "2026-07-15T00:00:00Z",
        amplitude: 0.4,
        currentVelocityMs: 2.0,
        currentDirectionDeg: 270, // Antiparallel draw
      });

      const forecast = forecastHours({
        hours,
        inwardBearingDeg: 90,
      });

      expect(forecast.length).toBeGreaterThan(0);
      expect(forecast.every((hour) => hour.direction === "outgoing")).toBe(true);
      expect(forecast.every((hour) => hour.strength !== "slack")).toBe(true);
    });

    it("1.3 An aligned 2.0 m/s push overpowers the ebb: the channel runs in all day", () => {
      // Ebb and flood tide with inward bearing 90°, and an extreme 2.0 m/s ocean current pushing inward (90°).
      const hours = createSyntheticMarineSeries({
        startDateIso: "2026-07-15T00:00:00Z",
        amplitude: 0.4,
        currentVelocityMs: 2.0,
        currentDirectionDeg: 90, // Strong inward push
      });

      const forecast = forecastHours({
        hours,
        inwardBearingDeg: 90,
      });

      expect(forecast.length).toBeGreaterThan(0);
      expect(forecast.every((hour) => hour.direction === "incoming")).toBe(true);
    });

    it("1.4 Purely orthogonal drift (0° and 180° onto 90° bearing) yields zero projected flux and identical forecast to zero velocity", () => {
      const inwardBearing = 90;
      const driftNorth: OceanDrift = { velocityMs: 2.0, directionDeg: 0 };
      const driftSouth: OceanDrift = { velocityMs: 2.0, directionDeg: 180 };

      expect(Math.abs(monsoonInwardFlux(driftNorth, inwardBearing))).toBeLessThan(1e-12);
      expect(Math.abs(monsoonInwardFlux(driftSouth, inwardBearing))).toBeLessThan(1e-12);

      // Verify full forecast under orthogonal drift equals forecast under calm drift
      const hoursOrthogonal = createSyntheticMarineSeries({
        startDateIso: "2026-07-15T00:00:00Z",
        amplitude: 0.35,
        currentVelocityMs: 2.0,
        currentDirectionDeg: 0,
      });
      const hoursCalm = createSyntheticMarineSeries({
        startDateIso: "2026-07-15T00:00:00Z",
        amplitude: 0.35,
        currentVelocityMs: 0,
        currentDirectionDeg: 0,
      });

      const forecastOrthogonal = forecastHours({
        hours: hoursOrthogonal,
        inwardBearingDeg: inwardBearing,
      });
      const forecastCalm = forecastHours({
        hours: hoursCalm,
        inwardBearingDeg: inwardBearing,
      });

      expect(forecastOrthogonal.length).toBe(forecastCalm.length);
      for (let i = 0; i < forecastOrthogonal.length; i++) {
        expect(forecastOrthogonal[i].direction).toBe(forecastCalm[i].direction);
        expect(forecastOrthogonal[i].strength).toBe(forecastCalm[i].strength);
      }
    });

    it("1.5 Disambiguation: currentVelocityMs === 0 strictly enforces calm, whereas null/undefined falls back to seasonal climatology", () => {
      // In July 2026 (SW monsoon), climatology drift is ~0.43 m/s @ 90°.
      // In a 90° inward pass, this creates a strong positive inward flux (+0.43 m/s).
      const hoursZero = createSyntheticMarineSeries({
        startDateIso: "2026-07-15T00:00:00Z",
        amplitude: 0.28,
        currentVelocityMs: 0, // Explicit calm
        currentDirectionDeg: 90,
      });
      const hoursNull = createSyntheticMarineSeries({
        startDateIso: "2026-07-15T00:00:00Z",
        amplitude: 0.28,
        currentVelocityMs: null, // Missing marine data -> should fall back to climatology
        currentDirectionDeg: null,
      });

      const forecastZero = forecastHours({
        hours: hoursZero,
        inwardBearingDeg: 90,
      });
      const forecastNull = forecastHours({
        hours: hoursNull,
        inwardBearingDeg: 90,
      });

      expect(forecastZero.length).toBe(forecastNull.length);

      // Verify that resolveHourDrift returned seasonal drift for null
      const resolvedNull = resolveHourDrift(hoursNull[0]);
      expect(resolvedNull.velocityMs).toBeGreaterThan(0.35);
      expect(resolvedNull.directionDeg).toBeCloseTo(90, 0);

      // Verify that resolveHourDrift returned 0 for zero
      const resolvedZero = resolveHourDrift(hoursZero[0]);
      expect(resolvedZero.velocityMs).toBe(0);

      // At peak incoming run, the seasonal drift from null should boost strength by 1 band
      // while zero velocity maintains the unmodulated tidal strength
      let hasStrengthDifference = false;
      for (let i = 0; i < forecastZero.length; i++) {
        if (forecastNull[i].direction === "incoming") {
          const rankZero = STRENGTH_LEVELS[forecastZero[i].strength];
          const rankNull = STRENGTH_LEVELS[forecastNull[i].strength];
          if (rankNull > rankZero) {
            hasStrengthDifference = true;
          }
        }
      }
      expect(hasStrengthDifference).toBe(true);
    });

    it("1.6 Guard robustness: partial null, NaN, and Infinity in MarineHour current velocity fall back safely", () => {
      const baseHour: MarineHour = {
        time: "2026-07-15T12:00",
        seaLevelM: 0.5,
        currentVelocityMs: NaN,
        currentDirectionDeg: 90,
      };
      // NaN should trigger fallback to seasonal
      const driftNaN = resolveHourDrift(baseHour);
      expect(Number.isFinite(driftNaN.velocityMs)).toBe(true);
      expect(driftNaN.velocityMs).toBeGreaterThan(0.3);

      // Infinity should trigger fallback to seasonal
      const driftInf = resolveHourDrift({ ...baseHour, currentVelocityMs: Infinity });
      expect(Number.isFinite(driftInf.velocityMs)).toBe(true);

      // Null velocity with finite direction should trigger fallback
      const driftNullVel = resolveHourDrift({ ...baseHour, currentVelocityMs: null, currentDirectionDeg: 180 });
      expect(driftNullVel.directionDeg).toBe(90); // July SW monsoon

      // Finite velocity with null direction should trigger fallback
      const driftNullDir = resolveHourDrift({ ...baseHour, currentVelocityMs: 0.5, currentDirectionDeg: null });
      expect(driftNullDir.directionDeg).toBe(90);

      // Explicit 0 velocity with null direction: resolveHourDrift falls back to climatology,
      // BUT monsoonNudge explicitly checks `hour.currentVelocityMs === 0` first!
      // In forecastHours with velocity 0 and null direction:
      const hoursZeroNullDir = createSyntheticMarineSeries({
        startDateIso: "2026-07-15T00:00:00Z",
        amplitude: 0.28,
        currentVelocityMs: 0,
        currentDirectionDeg: null,
      });
      const forecastZeroNull = forecastHours({
        hours: hoursZeroNullDir,
        inwardBearingDeg: 90,
      });
      // Should equal explicit calm forecast
      const hoursExplicitCalm = createSyntheticMarineSeries({
        startDateIso: "2026-07-15T00:00:00Z",
        amplitude: 0.28,
        currentVelocityMs: 0,
        currentDirectionDeg: 90,
      });
      const forecastExplicitCalm = forecastHours({
        hours: hoursExplicitCalm,
        inwardBearingDeg: 90,
      });
      for (let i = 0; i < forecastZeroNull.length; i++) {
        expect(forecastZeroNull[i].strength).toBe(forecastExplicitCalm[i].strength);
      }
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 2. Critical Invariant Verification
  // ────────────────────────────────────────────────────────────────────────────
  describe("2. Invariant Preservation (Slope Dictates Direction, Calm Preserved, Superposition)", () => {
    it("2.1 Invariant 1: net flow decides direction at every bearing — an extreme opposing drift runs every channel out, no drift leaves the tide in charge", () => {
      // Test all 12 cardinal and intercardinal compass bearings: 0°, 30°, 60°, ..., 330°
      const testBearings = Array.from({ length: 12 }, (_, i) => i * 30);

      for (const bearing of testBearings) {
        // Construct an extreme 2.0 m/s drift directly opposing this bearing
        const opposingAngle = (bearing + 180) % 360;
        const hours = createSyntheticMarineSeries({
          startDateIso: "2026-07-15T00:00:00Z",
          amplitude: 0.35,
          currentVelocityMs: 2.0,
          currentDirectionDeg: opposingAngle,
        });

        const forecast = forecastHours({
          hours,
          inwardBearingDeg: bearing,
        });

        expect(forecast.length).toBeGreaterThan(0);

        // Verify direction matches pure tidal direction (calculated with velocityMs = 0)
        const pureTidalHours = createSyntheticMarineSeries({
          startDateIso: "2026-07-15T00:00:00Z",
          amplitude: 0.35,
          currentVelocityMs: 0,
          currentDirectionDeg: 0,
        });
        const pureForecast = forecastHours({
          hours: pureTidalHours,
          inwardBearingDeg: bearing,
        });

        // The drift heads straight out of the channel at 2.0 m/s: it runs out every hour, whatever the bearing.
        expect(forecast.every((hour) => hour.direction === "outgoing")).toBe(true);
        // With no drift the tide alone decides, identically at every bearing.
        const firstBearing = forecastHours({ hours: pureTidalHours, inwardBearingDeg: 0 });
        expect(pureForecast.map((hour) => hour.direction)).toEqual(firstBearing.map((hour) => hour.direction));
      }
    });

    it("2.2 Invariant 2: currentVelocityMs === 0 strictly preserves pure tidal / slack conditions without drift bias", () => {
      // 1. Bearing Invariance: When ocean current is 0, pass inward bearing cannot bias forecast
      const testBearings = [0, 45, 90, 135, 180, 225, 270, 315];
      const hoursCalm = createSyntheticMarineSeries({
        startDateIso: "2026-07-15T00:00:00Z",
        amplitude: 0.3,
        currentVelocityMs: 0,
        currentDirectionDeg: 90,
      });

      const baselineForecast = forecastHours({
        hours: hoursCalm,
        inwardBearingDeg: 0,
      });

      for (const bearing of testBearings) {
        const forecast = forecastHours({
          hours: hoursCalm,
          inwardBearingDeg: bearing,
        });

        expect(forecast.length).toBe(baselineForecast.length);
        for (let i = 0; i < forecast.length; i++) {
          expect(forecast[i].direction).toBe(baselineForecast[i].direction);
          expect(forecast[i].strength).toBe(baselineForecast[i].strength);
        }
      }

      // 2. Slack Plateau Preservation: During slack tidal turns (slope < 0.02m), strength remains strictly slack
      // Construct series with flat plateaus at peaks and troughs
      const slackSeries: MarineHour[] = Array.from({ length: 72 }, (_, i) => {
        const timeMs = new Date("2026-07-15T00:00:00Z").getTime() + i * 3600 * 1000;
        const d = new Date(timeMs);
        const time = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}T${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
        const phase = i % 12;
        let seaLevelM: number;
        if (phase === 3 || phase === 4) {
          seaLevelM = 0.75; // flat crest
        } else if (phase === 9 || phase === 10) {
          seaLevelM = 0.25; // flat trough
        } else if (phase < 3) {
          seaLevelM = 0.25 + 0.5 * (phase / 3);
        } else if (phase > 4 && phase < 9) {
          seaLevelM = 0.75 - 0.5 * ((phase - 4) / 5);
        } else {
          seaLevelM = 0.25 + 0.5 * ((phase - 10) / 2);
        }
        return {
          time,
          seaLevelM,
          currentVelocityMs: 0,
          currentDirectionDeg: 90,
        };
      });

      const slackForecast = forecastHours({
        hours: slackSeries,
        inwardBearingDeg: 90,
      });

      for (const h of slackForecast) {
        const phase = (parseInt(h.time.slice(11, 13), 10) + 0) % 12;
        if (phase === 3 || phase === 9) {
          expect(h.strength).toBe("slack");
        }
      }
    });

    it("2.3 Invariant 3: Constriction modulation (M1) and Monsoon drift (M2) superimpose without crashing or overflowing strength bands", () => {
      // Full combinatorial matrix:
      // 4 Pass cross-sections (Width x Depth)
      const geometries = [
        { name: "Unconstricted Open Water", w: undefined, d: undefined },
        { name: "Wide Pass (C ~ 1.25)", w: 1500, d: 40 },
        { name: "Narrow Pass (C ~ 2.0)", w: 300, d: 25 },
        { name: "Gorge Pass (C = 2.5 clamped)", w: 100, d: 15 },
      ];

      // 3 Tidal Amplitudes
      const tidalAmplitudes = [
        { name: "Spring Tide (1.4m range)", amp: 0.7 },
        { name: "Mean Tide (0.7m range)", amp: 0.35 },
        { name: "Micro-neap Tide (0.1m range)", amp: 0.05 },
      ];

      // 4 Monsoon Vectors
      const monsoonVectors = [
        { name: "Aligned Gale (2.0 m/s push)", v: 2.0, dir: 90 },
        { name: "Opposing Gale (2.0 m/s draw)", v: 2.0, dir: 270 },
        { name: "Orthogonal (2.0 m/s cross)", v: 2.0, dir: 0 },
        { name: "Calm Ocean (0 m/s)", v: 0, dir: 90 },
      ];

      for (const geo of geometries) {
        for (const tide of tidalAmplitudes) {
          for (const monsoon of monsoonVectors) {
            const hours = createSyntheticMarineSeries({
              startDateIso: "2026-07-15T00:00:00Z",
              amplitude: tide.amp,
              currentVelocityMs: monsoon.v,
              currentDirectionDeg: monsoon.dir,
            });

            const forecast = forecastHours({
              hours,
              inwardBearingDeg: 90,
              channelWidthM: geo.w,
              channelDepthM: geo.d,
            });

            expect(forecast.length, `Failed on ${geo.name} + ${tide.name} + ${monsoon.name}`).toBeGreaterThan(0);

            for (const hour of forecast) {
              // 1. Must be a valid strength band
              expect(STRENGTHS).toContain(hour.strength);
              // 2. Must be a valid direction
              expect(["incoming", "outgoing"]).toContain(hour.direction);
              // 3. Numeric level must be finite
              expect(Number.isFinite(hour.levelM)).toBe(true);
            }
          }
        }
      }
    });

    it("2.4 Monotonicity check: narrowing and an aligned monsoon push never weaken the flood; an opposing draw turns it out", () => {
      const baseHoursCalm = createSyntheticMarineSeries({
        startDateIso: "2026-07-15T00:00:00Z",
        amplitude: 0.3,
        currentVelocityMs: 0,
        currentDirectionDeg: 90,
      });

      const baseHoursAligned = createSyntheticMarineSeries({
        startDateIso: "2026-07-15T00:00:00Z",
        amplitude: 0.3,
        currentVelocityMs: 1.5,
        currentDirectionDeg: 90, // Strong push
      });

      const baseHoursOpposing = createSyntheticMarineSeries({
        startDateIso: "2026-07-15T00:00:00Z",
        amplitude: 0.3,
        currentVelocityMs: 1.5,
        currentDirectionDeg: 270, // Strong draw
      });

      // 1. Test Monsoon Monotonicity on Open Pass: Aligned >= Calm >= Opposing
      const forecastCalm = forecastHours({ hours: baseHoursCalm, inwardBearingDeg: 90 });
      const forecastAligned = forecastHours({ hours: baseHoursAligned, inwardBearingDeg: 90 });
      const forecastOpposing = forecastHours({ hours: baseHoursOpposing, inwardBearingDeg: 90 });

      const at = (list: typeof forecastCalm, time: string) => list.find((hour) => hour.time === time)!;
      const calmIncoming = forecastCalm.filter((hour) => hour.direction === "incoming");
      expect(calmIncoming.length).toBeGreaterThan(0);
      for (const hour of calmIncoming) {
        const aligned = at(forecastAligned, hour.time);
        const opposing = at(forecastOpposing, hour.time);
        // An aligned 1.5 m/s push keeps the flood running in, at least as strong.
        expect(aligned.direction).toBe("incoming");
        expect(STRENGTH_LEVELS[aligned.strength]).toBeGreaterThanOrEqual(STRENGTH_LEVELS[hour.strength]);
        // A 1.5 m/s draw is stronger than this tide: it turns the flood out.
        expect(opposing.direction).toBe("outgoing");
      }

      // 2. Test Constriction Monotonicity: Narrow Pass >= Open Pass
      const forecastNarrow = forecastHours({
        hours: baseHoursCalm,
        inwardBearingDeg: 90,
        channelWidthM: 300,
        channelDepthM: 25,
      });

      for (let i = 0; i < forecastCalm.length; i++) {
        const rankOpen = STRENGTH_LEVELS[forecastCalm[i].strength];
        const rankNarrow = STRENGTH_LEVELS[forecastNarrow[i].strength];
        expect(rankNarrow).toBeGreaterThanOrEqual(rankOpen);
      }
    });

    it("2.5 Saturation Clamp Safety: Extreme Spring Tide + Max Constriction + Max Aligned Push does not exceed 'too_strong'", () => {
      const extremeHours = createSyntheticMarineSeries({
        startDateIso: "2026-07-15T00:00:00Z",
        amplitude: 1.2, // 2.4m tidal range
        currentVelocityMs: 3.0, // 6 knots
        currentDirectionDeg: 90,
      });

      const forecast = forecastHours({
        hours: extremeHours,
        inwardBearingDeg: 90,
        channelWidthM: 50,
        channelDepthM: 10, // Max constriction 2.5
      });

      for (const h of forecast) {
        expect(STRENGTHS).toContain(h.strength);
        expect(STRENGTH_LEVELS[h.strength]).toBeLessThanOrEqual(STRENGTH_LEVELS["too_strong"]);
      }
    });

    it("2.6 Non-Negative Safety: Flat Micro-Neap Tide + Max Opposing Draw does not underflow below 'slack'", () => {
      const flatHours = createSyntheticMarineSeries({
        startDateIso: "2026-07-15T00:00:00Z",
        amplitude: 0.01, // 0.02m tidal range (virtually flat)
        currentVelocityMs: 3.0,
        currentDirectionDeg: 270,
      });

      const forecast = forecastHours({
        hours: flatHours,
        inwardBearingDeg: 90,
      });

      for (const h of forecast) {
        expect(STRENGTHS).toContain(h.strength);
        expect(STRENGTH_LEVELS[h.strength]).toBeGreaterThanOrEqual(STRENGTH_LEVELS["slack"]);
      }
    });

    it("2.7 Exact-zero slope turn resolution: nextSignedDirection is invariant to extreme monsoon drift", () => {
      // Create a series where hour 12 has exact slope = 0
      const hours = createSyntheticMarineSeries({
        startDateIso: "2026-07-15T00:00:00Z",
        amplitude: 0.35,
        currentVelocityMs: 0,
        currentDirectionDeg: 90,
      });

      // Force hours 12 and 13 to have identical sea levels -> slope is exact 0
      hours[12].seaLevelM = 0.5;
      hours[13].seaLevelM = 0.5;

      // Predict with zero drift
      const forecastCalm = forecastHours({
        hours,
        inwardBearingDeg: 90,
      });

      // Predict with extreme 2.0 m/s monsoon push
      const hoursPush = hours.map((h) => ({
        ...h,
        currentVelocityMs: 2.0,
        currentDirectionDeg: 90,
      }));
      const forecastPush = forecastHours({
        hours: hoursPush,
        inwardBearingDeg: 90,
      });

      // Direction at the zero-slope turn must match between calm and push
      expect(forecastPush[12].direction).toBe(forecastCalm[12].direction);
    });

    it("2.8 Three-way Superposition: Constriction + Extreme Monsoon + Diver Report Pull preserves valid strength bands", () => {
      const hours = createSyntheticMarineSeries({
        startDateIso: "2026-07-15T00:00:00Z",
        amplitude: 0.5,
        currentVelocityMs: 2.0,
        currentDirectionDeg: 90,
      });

      // Report pulling towards 'too_strong'
      const reportPullStrong = [
        {
          id: "rep-1",
          siteId: "kandooma-thila",
          time: hours[20].time,
          direction: "incoming" as Direction,
          strength: "too_strong" as Strength,
        },
      ];

      const forecastMax = forecastHours({
        hours,
        inwardBearingDeg: 90,
        channelWidthM: 100,
        channelDepthM: 20, // High constriction
        reports: reportPullStrong,
      });

      for (const h of forecastMax) {
        expect(STRENGTHS).toContain(h.strength);
      }

      // Report pulling towards 'slack' on opposing gale
      const hoursDraw = hours.map((h) => ({
        ...h,
        currentVelocityMs: 2.0,
        currentDirectionDeg: 270,
      }));
      const reportPullSlack = [
        {
          id: "rep-2",
          siteId: "kandooma-thila",
          time: hoursDraw[20].time,
          direction: "incoming" as Direction,
          strength: "slack" as Strength,
        },
      ];

      const forecastMin = forecastHours({
        hours: hoursDraw,
        inwardBearingDeg: 90,
        channelWidthM: 2000,
        channelDepthM: 50,
        reports: reportPullSlack,
      });

      for (const h of forecastMin) {
        expect(STRENGTHS).toContain(h.strength);
      }
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 3. Seasonal Climatology & Invariant Stress Test
  // ────────────────────────────────────────────────────────────────────────────
  describe("3. Seasonal Climatology Model ($C^1$ Continuity & Stress)", () => {
    it("3.1 Year-round hourly evaluation (8,784 hours) verifies C^1 continuity, no NaNs, and strict velocity bounds", () => {
      const leapYear2024 = 2024;
      const startMs = Date.UTC(leapYear2024, 0, 1, 0, 0, 0);
      const totalHours = 366 * 24;

      let prevVel = -1;
      let prevDir = -1;
      let maxDeltaVel = 0;

      for (let h = 0; h < totalHours; h++) {
        const timeMs = startMs + h * 3600 * 1000;
        const drift = getMaldivesMonsoonDrift(new Date(timeMs));

        // Finite numbers
        expect(Number.isFinite(drift.velocityMs)).toBe(true);
        expect(Number.isFinite(drift.directionDeg)).toBe(true);

        // Physical velocity bounds: [0.05 m/s, 0.45 m/s]
        expect(drift.velocityMs).toBeGreaterThanOrEqual(0.05 - 1e-6);
        expect(drift.velocityMs).toBeLessThanOrEqual(0.45 + 1e-6);

        // Direction in [0, 360)
        expect(drift.directionDeg).toBeGreaterThanOrEqual(0);
        expect(drift.directionDeg).toBeLessThanOrEqual(360);

        if (prevVel >= 0 && prevDir >= 0) {
          const deltaVel = Math.abs(drift.velocityMs - prevVel);
          if (deltaVel > maxDeltaVel) maxDeltaVel = deltaVel;
          // Smoothness check: hourly velocity step must be tiny (< 0.002 m/s)
          expect(deltaVel).toBeLessThan(0.002);

          const rawDeltaDir = Math.abs(drift.directionDeg - prevDir);
          const angularDelta = Math.min(rawDeltaDir, 360 - rawDeltaDir);
          // Smoothness check: hourly heading step during transition must be smooth (< 1.0 deg/hour)
          expect(angularDelta).toBeLessThan(1.0);
        }

        prevVel = drift.velocityMs;
        prevDir = drift.directionDeg;
      }

      // Confirm maximum hourly velocity change across whole year is smooth (< 0.002 m/s per hour)
      // Analytical maximum during April transition is (0.35 - 0.05) * pi / 720 h ≈ 0.00131 m/s/h
      expect(maxDeltaVel).toBeLessThan(0.002);
    });

    it("3.2 Timezone invariance: local vs UTC strings produce identical seasonal drift", () => {
      const utcDate = new Date("2026-07-15T12:00:00Z");
      const offsetDate = new Date("2026-07-15T17:00:00+05:00"); // Maldives local time (+5)
      expect(utcDate.getTime()).toBe(offsetDate.getTime());

      const driftUtc = getMaldivesMonsoonDrift(utcDate);
      const driftOffset = getMaldivesMonsoonDrift(offsetDate);

      expect(driftUtc.velocityMs).toBe(driftOffset.velocityMs);
      expect(driftUtc.directionDeg).toBe(driftOffset.directionDeg);
    });

    it("3.3 Bearing normalization invariance: pass bearings +- 360° and +- 720° yield identical flux", () => {
      const drift: OceanDrift = { velocityMs: 0.4, directionDeg: 90 };
      const flux0 = monsoonInwardFlux(drift, 90);
      const flux360 = monsoonInwardFlux(drift, 90 + 360);
      const fluxNeg = monsoonInwardFlux(drift, 90 - 360);
      const flux720 = monsoonInwardFlux(drift, 90 + 720);

      expect(flux360).toBeCloseTo(flux0, 10);
      expect(fluxNeg).toBeCloseTo(flux0, 10);
      expect(flux720).toBeCloseTo(flux0, 10);
    });
  });
});

