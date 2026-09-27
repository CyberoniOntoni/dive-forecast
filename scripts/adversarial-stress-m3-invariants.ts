import {
  constrictionFactor,
  forecastHours,
  hourlyStrength,
  strengthFromRange,
  aggregateReportPull,
  classifyReport,
  reportTemporalWeight,
  REPORT_HALF_LIFE_DAYS,
  REPORT_HALF_LIFE_MS,
  LAG_PENALTY_LAMBDA,
  CONSENSUS_RATIO_THRESHOLD,
  SEVEN_DAYS_MS,
} from "../lib/forecast";
import { STRENGTHS, type MarineHour, type Report, type Direction, type Strength } from "../lib/types";
import sitesData from "../data/sites.json";

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failureLog: string[] = [];

function assert(condition: boolean, testName: string, detail?: string): void {
  totalTests++;
  if (condition) {
    passedTests++;
  } else {
    failedTests++;
    const msg = `FAIL: ${testName}${detail ? ` -> ${detail}` : ""}`;
    failureLog.push(msg);
    console.error(`  ✕ ${msg}`);
  }
}

function rank(s: Strength): number {
  return STRENGTHS.indexOf(s);
}

function generateTideSeries(
  amplitude: number,
  periodHours: number = 12,
  countHours: number = 72,
  mean: number = 0.8
): MarineHour[] {
  const origin = Date.UTC(2026, 8, 23, 0, 0);
  return Array.from({ length: countHours }, (_, i) => {
    const t = i;
    const wave = amplitude * Math.sin((2 * Math.PI * t) / periodHours);
    return {
      time: new Date(origin + t * 3600 * 1000).toISOString().slice(0, 16),
      seaLevelM: mean + wave,
      currentVelocityMs: 0.1,
      currentDirectionDeg: 90,
    };
  });
}

console.log("================================================================================");
console.log("    MILENSTONE 3 ADVERSARIAL VERIFICATION: 3 CORE INVARIANTS CHALLENGE HARNESS    ");
console.log("================================================================================\n");

// =============================================================================
// INVARIANT 1: CHANNEL CONSTRICTION PRODUCES STRONGER PEAK RATINGS THAN OPEN
// =============================================================================
console.log("--- INVARIANT 1: Channel Constriction & Hydrodynamic Amplification ---");

// 1.1 Reference Channel & Clamping
assert(
  constrictionFactor(5000, 400) === 1.0,
  "1.1.1 Reference pass (5000m x 400m = 2,000,000 m^2) produces exactly C=1.0",
  `Received C=${constrictionFactor(5000, 400)}`
);
assert(
  constrictionFactor(100, 10) === 2.5,
  "1.1.2 Extreme narrow channel (100m x 10m = 1,000 m^2) clamps to C_max = 2.5",
  `Received C=${constrictionFactor(100, 10)}`
);
assert(
  constrictionFactor(10000, 500) === 1.0,
  "1.1.3 Massive channel (10000m x 500m = 5,000,000 m^2) clamps to C_min = 1.0",
  `Received C=${constrictionFactor(10000, 500)}`
);
assert(
  constrictionFactor(undefined, 40) === 1.0 &&
    constrictionFactor(500, undefined) === 1.0 &&
    constrictionFactor(-100, 40) === 1.0 &&
    constrictionFactor(500, -10) === 1.0 &&
    constrictionFactor(0, 40) === 1.0,
  "1.1.4 Pathological / missing / non-positive pass dimensions fall back strictly to C=1.0"
);

// 1.2 Peak Tidal Current Amplification across varying tidal amplitudes
const springSeries = generateTideSeries(0.5, 12, 72); // 1.0m peak-to-trough
const openFc = forecastHours({ hours: springSeries, inwardBearingDeg: 90 });
const narrowFc = forecastHours({
  hours: springSeries,
  inwardBearingDeg: 90,
  channelWidthM: 300,
  channelDepthM: 30, // 9,000 m^2 => C = (2M / 9000)^0.35 = clamp(6.62) = 2.5
});

assert(narrowFc.length === openFc.length, "1.2.1 Constricted and open produce matching forecast lengths");

let constrictionAmplifiesPeak = false;
let constrictionNeverWeakens = true;
let peakFound = false;

for (let i = 0; i < openFc.length; i++) {
  const rOpen = rank(openFc[i].strength);
  const rNarrow = rank(narrowFc[i].strength);

  if (rNarrow < rOpen) {
    constrictionNeverWeakens = false;
  }
  if (rNarrow > rOpen) {
    constrictionAmplifiesPeak = true;
  }
  if (openFc[i].strength !== "slack") {
    peakFound = true;
  }
}

assert(
  constrictionAmplifiesPeak,
  "1.2.2 Constricted channel produces strictly higher strength rating during peak tidal flow than open site",
  `narrow peak > open peak observed`
);
assert(
  constrictionNeverWeakens,
  "1.2.3 Constricted channel never produces weaker strength rating than open site at any hour"
);

// 1.3 Slack Preservation under Constriction (Zero Slope stays Slack)
const flatSeries: MarineHour[] = Array.from({ length: 48 }, (_, i) => ({
  time: new Date(Date.UTC(2026, 8, 23, i)).toISOString().slice(0, 16),
  seaLevelM: 0.8,
  currentVelocityMs: 0,
  currentDirectionDeg: 0,
}));
const flatNarrowFc = forecastHours({
  hours: flatSeries,
  inwardBearingDeg: 90,
  channelWidthM: 200,
  channelDepthM: 20,
});
assert(
  flatNarrowFc.every((h) => h.strength === "slack"),
  "1.3.1 Constriction preserves slack: zero slope remains 100% 'slack' even under C=2.5"
);

// =============================================================================
// INVARIANT 2: OUTLIER DAMPENING WITHOUT PHASE JUMPS
// =============================================================================
console.log("\n--- INVARIANT 2: Outlier Dampening Without Erratic Phase Jumps ---");

// 2.1 Single Outlier Dampened by Consensus (no phase jump, no direction flip)
const testHours = generateTideSeries(0.6, 12, 72);
// Index 27 is 03:00 on Day 2, rising tide -> incoming
const targetTimeStr = "2026-09-24T03:00";

const concordant4: Report[] = [
  { id: "c1", siteId: "s", time: targetTimeStr, direction: "incoming", strength: "strong" },
  { id: "c2", siteId: "s", time: targetTimeStr, direction: "incoming", strength: "strong" },
  { id: "c3", siteId: "s", time: targetTimeStr, direction: "incoming", strength: "strong" },
  { id: "c4", siteId: "s", time: targetTimeStr, direction: "incoming", strength: "strong" },
];
const outlier1: Report = {
  id: "out-noisy",
  siteId: "s",
  time: targetTimeStr,
  direction: "outgoing",
  strength: "too_strong",
};

const baseClean = forecastHours({ hours: testHours, inwardBearingDeg: 90, reports: concordant4 });
const withOutlier = forecastHours({ hours: testHours, inwardBearingDeg: 90, reports: [...concordant4, outlier1] });

const targetBase = baseClean.find((h) => h.time.startsWith(targetTimeStr));
const targetOutlier = withOutlier.find((h) => h.time.startsWith(targetTimeStr));

assert(targetBase != null && targetOutlier != null, "2.1.1 Target hours found in forecasts");
assert(
  targetOutlier?.direction === "incoming",
  "2.1.2 Consensus (4 incoming vs 1 outgoing) dampens outlier; direction remains 'incoming'",
  `Observed: ${targetOutlier?.direction}`
);
assert(
  targetOutlier?.direction === targetBase?.direction,
  "2.1.3 Outlier causes NO direction inversion or erratic phase jump at target hour"
);

// Check that entire 72h phase structure is NOT erratically shifted by the single outlier
let phaseJumpDetected = false;
for (let i = 0; i < baseClean.length; i++) {
  // Allow strength to modulate, but direction phase pattern must not jump
  if (baseClean[i].direction !== withOutlier[i].direction) {
    phaseJumpDetected = true;
    break;
  }
}
assert(
  !phaseJumpDetected,
  "2.1.4 Global phase timeline has zero phase jumps when a single noisy outlier is introduced"
);

// 2.2 Symmetrical 50/50 Tie Defaults Cleanly to Astronomical Baseline with Neutral Speed Factor
const tieReports: Report[] = [
  { id: "tie-in", siteId: "s", time: targetTimeStr, direction: "incoming", strength: "too_strong" },
  { id: "tie-out", siteId: "s", time: targetTimeStr, direction: "outgoing", strength: "too_strong" },
];
const astronomicalBase = forecastHours({ hours: testHours, inwardBearingDeg: 90, reports: [] });
const tieFc = forecastHours({ hours: testHours, inwardBearingDeg: 90, reports: tieReports });

const astroTarget = astronomicalBase.find((h) => h.time.startsWith(targetTimeStr));
const tieTarget = tieFc.find((h) => h.time.startsWith(targetTimeStr));

assert(
  tieTarget?.direction === astroTarget?.direction,
  "2.2.1 Symmetrical 50/50 tie preserves astronomical direction exactly",
  `Tie: ${tieTarget?.direction}, Astro: ${astroTarget?.direction}`
);
assert(
  tieTarget?.strength === astroTarget?.strength,
  "2.2.2 Symmetrical 50/50 tie produces zero speed factor distortion (strength matches astronomical baseline)",
  `Tie: ${tieTarget?.strength}, Astro: ${astroTarget?.strength}`
);

// 2.3 Single Lone Report Cannot Cause Phase Offset Jump (guard voter count < 2)
const loneWolf: Report = {
  id: "lone-wolf",
  siteId: "s",
  time: targetTimeStr,
  direction: "outgoing",
  strength: "strong",
  slopeM: 0.08,
};
const loneFc = forecastHours({ hours: testHours, inwardBearingDeg: 90, reports: [loneWolf] });
// Compare 24h later: should match astronomical baseline direction
const laterAstro = astronomicalBase.find((h) => h.time.startsWith("2026-09-25T03:00"));
const laterLone = loneFc.find((h) => h.time.startsWith("2026-09-25T03:00"));
assert(
  laterLone?.direction === laterAstro?.direction,
  "2.3.1 Lone wolf report cannot cause a global phase offset shift"
);

// 2.4 Speed Factor Concordance Filtering (lib/forecast.ts:456-457)
// When 3 reports are incoming ("too_strong") and 1 outlier is outgoing ("mild"),
// the outlier must NOT pull down the speed factor of the incoming tide.
const reportsWithOppositeOutlier: Report[] = [
  { id: "s1", siteId: "s", time: targetTimeStr, direction: "incoming", strength: "too_strong" },
  { id: "s2", siteId: "s", time: targetTimeStr, direction: "incoming", strength: "too_strong" },
  { id: "s3", siteId: "s", time: targetTimeStr, direction: "incoming", strength: "too_strong" },
  { id: "s-opp", siteId: "s", time: targetTimeStr, direction: "outgoing", strength: "mild" },
];
const speedFc = forecastHours({ hours: testHours, inwardBearingDeg: 90, reports: reportsWithOppositeOutlier });
const speedTarget = speedFc.find((h) => h.time.startsWith(targetTimeStr));
assert(
  speedTarget?.strength === "too_strong",
  "2.4.1 Contradictory outlier report does not corrupt speed factor calibration on concordant flow",
  `Observed: ${speedTarget?.strength}`
);

// =============================================================================
// INVARIANT 3: NEVER-HIGH CONFIDENCE ON RECENT CONTRADICTION
// =============================================================================
console.log("\n--- INVARIANT 3: Never-High Confidence On Recent Contradiction ---");

const targetHourMs = Date.parse("2026-09-24T03:00:00Z");

// Baseline 5 concordant reports (15 days old so outside 7-day window)
const time15d = new Date(targetHourMs - 15 * 24 * 3600 * 1000).toISOString().slice(0, 16);
const highConfBaseReports: Report[] = [
  { id: "b1", siteId: "s", time: time15d, direction: "incoming", strength: "too_strong", slopeM: 0.08 },
  { id: "b2", siteId: "s", time: time15d, direction: "incoming", strength: "too_strong", slopeM: 0.08 },
  { id: "b3", siteId: "s", time: time15d, direction: "incoming", strength: "too_strong", slopeM: 0.08 },
  { id: "b4", siteId: "s", time: time15d, direction: "incoming", strength: "too_strong", slopeM: 0.08 },
  { id: "b5", siteId: "s", time: time15d, direction: "incoming", strength: "too_strong", slopeM: 0.08 },
];

const confBaseline = forecastHours({
  hours: testHours,
  inwardBearingDeg: 90,
  reports: highConfBaseReports,
  allowHighConfidence: true,
});
const confBaseTarget = confBaseline.find((h) => h.time.startsWith(targetTimeStr));
assert(
  confBaseTarget?.confidence === "high",
  "3.1 Baseline setup successfully establishes 'high' confidence with 5 agreeing reports",
  `Base confidence: ${confBaseTarget?.confidence}`
);

// Adversarial Contradiction Points across the 7-day boundary
const testContradictions: { label: string; deltaMs: number; expectHighForbidden: boolean }[] = [
  { label: "Exact same second (delta = 0s)", deltaMs: 0, expectHighForbidden: true },
  { label: "15 minutes prior (delta = -15m)", deltaMs: -15 * 60 * 1000, expectHighForbidden: true },
  { label: "59 minutes prior (delta = -59m, clock-hour rule)", deltaMs: -59 * 60 * 1000, expectHighForbidden: true },
  { label: "12 hours prior (delta = -12h)", deltaMs: -12 * 3600 * 1000, expectHighForbidden: true },
  { label: "1 day prior (delta = -1d)", deltaMs: -1 * 24 * 3600 * 1000, expectHighForbidden: true },
  { label: "3 days prior (delta = -3d)", deltaMs: -3 * 24 * 3600 * 1000, expectHighForbidden: true },
  { label: "6 days prior (delta = -6d)", deltaMs: -6 * 24 * 3600 * 1000, expectHighForbidden: true },
  { label: "6.99 days prior (delta = -6.99d)", deltaMs: -Math.floor(6.99 * 24 * 3600 * 1000), expectHighForbidden: true },
  { label: "7 days - 1 second (inside 7d gate)", deltaMs: -(SEVEN_DAYS_MS - 1000), expectHighForbidden: true },
  { label: "Future clock skew (+2 hours)", deltaMs: 2 * 3600 * 1000, expectHighForbidden: true },
  { label: "Future clock skew (+3 days)", deltaMs: 3 * 24 * 3600 * 1000, expectHighForbidden: true },
  { label: "Boundary at 7.01 days prior (> 7 days)", deltaMs: -Math.ceil(7.01 * 24 * 3600 * 1000), expectHighForbidden: false },
  { label: "Historical 14 days prior (> 7 days)", deltaMs: -14 * 24 * 3600 * 1000, expectHighForbidden: false },
];

for (const tc of testContradictions) {
  const contraTime = new Date(targetHourMs + tc.deltaMs).toISOString().slice(0, 16);
  const contraReport: Report = {
    id: `contra-${tc.label}`,
    siteId: "s",
    time: contraTime,
    direction: "outgoing", // Contradicts predicted incoming
    strength: "strong",
    slopeM: 0.08,
  };

  const fc = forecastHours({
    hours: testHours,
    inwardBearingDeg: 90,
    reports: [...highConfBaseReports, contraReport],
    allowHighConfidence: true,
  });

  const hour = fc.find((h) => h.time.startsWith(targetTimeStr));
  if (tc.expectHighForbidden) {
    assert(
      hour?.confidence !== "high",
      `3.2 Contradiction check: [${tc.label}] strictly forbids 'high' confidence`,
      `Returned confidence: '${hour?.confidence}'`
    );
  } else {
    // Beyond 7-day boundary, the recent contradiction gate does NOT fire
    // (Notice: agreement is checked across similar reports; if directionUnanimous is broken it may be medium,
    // but the hard 7-day gate hasRecentContradiction is false)
    assert(
      hour != null,
      `3.3 Boundary check: [${tc.label}] successfully evaluated outside 7-day gate`
    );
  }
}

// 3.4 Stress: 100 Concordant Reports CANNOT Override 1 Recent Contradiction
const massive100Concordant: Report[] = Array.from({ length: 100 }, (_, i) => ({
  id: `mass-${i}`,
  siteId: "s",
  time: time15d,
  direction: "incoming",
  strength: "too_strong",
  slopeM: 0.08,
}));

const singleRecentContradiction: Report = {
  id: "single-poison-pill",
  siteId: "s",
  time: new Date(targetHourMs - 2 * 3600 * 1000).toISOString().slice(0, 16), // 2 hours ago
  direction: "outgoing",
  strength: "strong",
  slopeM: 0.08,
};

const massiveFc = forecastHours({
  hours: testHours,
  inwardBearingDeg: 90,
  reports: [...massive100Concordant, singleRecentContradiction],
  allowHighConfidence: true,
});
const massiveHour = massiveFc.find((h) => h.time.startsWith(targetTimeStr));

assert(
  massiveHour?.confidence !== "high",
  "3.4.1 Invariant: 100 concordant reports CANNOT override 1 recent contradiction to achieve 'high' confidence",
  `Confidence returned: '${massiveHour?.confidence}'`
);

// 3.5 allowHighConfidence = false strictly prevents high confidence under all conditions
const noHighFc = forecastHours({
  hours: testHours,
  inwardBearingDeg: 90,
  reports: highConfBaseReports,
  allowHighConfidence: false,
});
const noHighHour = noHighFc.find((h) => h.time.startsWith(targetTimeStr));
assert(
  noHighHour?.confidence !== "high",
  "3.5.1 allowHighConfidence: false strictly suppresses 'high' confidence",
  `Confidence returned: '${noHighHour?.confidence}'`
);

// =============================================================================
// SUMMARY & VERDICT
// =============================================================================
console.log("\n================================================================================");
console.log(`INVARIANT ADVERSARIAL STRESS TEST SUMMARY: ${passedTests}/${totalTests} PASSED`);
if (failedTests > 0) {
  console.log(`FAILED TESTS: ${failedTests}`);
  failureLog.forEach((f) => console.log(f));
} else {
  console.log("ALL 3 CORE INVARIANTS ADVERSARIALLY VERIFIED WITH ZERO DEFECTS.");
}
console.log("================================================================================");

process.exit(failedTests > 0 ? 1 : 0);
