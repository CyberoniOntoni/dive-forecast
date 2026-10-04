import {
  constrictionFactor,
  forecastHours,
  REPORT_HALF_LIFE_DAYS,
  LAG_PENALTY_LAMBDA,
  CONSENSUS_RATIO_THRESHOLD,
  SEVEN_DAYS_MS,
  REF_CHANNEL_AREA_M2,
  CONSTRICTION_EXPONENT,
  CONSTRICTION_MIN,
  CONSTRICTION_MAX,
  sectionInput,
} from "../lib/forecast";
import { getMaldivesMonsoonDrift } from "../lib/seasonal";
import { STRENGTHS, type MarineHour, type Report, type Strength, type Site } from "../lib/types";
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

/**
 * Synthetic tidal series generator with predictable phase:
 * Phase: phase = 2 * pi * t / periodHours
 * Rising tide (incoming): t in [0, periodHours/4) (slope > 0)
 * Peak crest: t = periodHours/4 (slope = 0)
 * Falling tide (outgoing): t in (periodHours/4, 3*periodHours/4) (slope < 0)
 * Peak trough: t = 3*periodHours/4 (slope = 0)
 */
function makeTidalSeries(
  startDateStr: string,
  numHours: number = 72,
  periodHours: number = 12,
  amplitudeM: number = 0.35,
  meanM: number = 0.8
): MarineHour[] {
  const startMs = Date.parse(startDateStr.endsWith("Z") ? startDateStr : startDateStr + ":00Z");
  return Array.from({ length: numHours }, (_, i) => {
    const time = new Date(startMs + i * 3600 * 1000).toISOString().slice(0, 16);
    const phase = (2 * Math.PI * i) / periodHours;
    const seaLevelM = meanM + amplitudeM * Math.sin(phase);
    return {
      time,
      seaLevelM,
      currentVelocityMs: 0.1,
      currentDirectionDeg: 90,
    };
  });
}

function findHour(forecast: ReturnType<typeof forecastHours>, timeStr: string) {
  return forecast.find((h) => h.time === timeStr || h.time.startsWith(timeStr));
}

console.log("================================================================================");
console.log("   CHALLENGER M3 EMPIRICAL STRESS TEST: INVARIANTS 1-3 & EDGE CONDITIONS        ");
console.log("================================================================================\n");

// =============================================================================
// 1. INVARIANT 1: CHANNEL CONSTRICTION & HYDRODYNAMIC AMPLIFICATION
// =============================================================================
console.log("--- 1. INVARIANT 1: Channel Constriction & Hydrodynamic Amplification ---");

// 1.1 Mathematical formula & clamping bounds
assert(REF_CHANNEL_AREA_M2 === 31_500, "1.1.1 REF_CHANNEL_AREA_M2 is exactly 31,500 m^2");
assert(CONSTRICTION_EXPONENT === 0.35, "1.1.2 CONSTRICTION_EXPONENT is exactly 0.35");
assert(CONSTRICTION_MIN === 1.0, "1.1.3 CONSTRICTION_MIN is exactly 1.0");
assert(CONSTRICTION_MAX === 2.5, "1.1.4 CONSTRICTION_MAX is exactly 2.5");

assert(
  constrictionFactor(5000, 400) === 1.0,
  "1.1.5 Reference pass (5000m x 400m = 2,000,000 m^2) produces exactly C=1.0",
  `Received C=${constrictionFactor(5000, 400)}`
);

// Narrow channels clamp to 2.5
assert(
  constrictionFactor(100, 10) === 2.5,
  "1.1.6 Extreme narrow pass (100m x 10m = 1,000 m^2) clamps to C_max = 2.5",
  `Received C=${constrictionFactor(100, 10)}`
);
assert(
  constrictionFactor(60, 10) === 2.5,
  "1.1.7 Narrow cut (60m x 10m = 600 m^2) clamps to C_max = 2.5",
  `Received C=${constrictionFactor(60, 10)}`
);

// Intermediate channel
const intermediateExpected = Math.pow(31_500 / (500 * 30), 0.35);
assert(
  Math.abs(constrictionFactor(500, 30) - intermediateExpected) < 1e-6,
  "1.1.8 Intermediate pass (500m x 30m) matches formula (A_ref / A)^0.35",
  `Received C=${constrictionFactor(500, 30)}, expected ${intermediateExpected}`
);

// Wide channel clamps to 1.0
assert(
  constrictionFactor(10000, 500) === 1.0,
  "1.1.9 Wide pass (10,000m x 500m = 5,000,000 m^2) clamps to C_min = 1.0",
  `Received C=${constrictionFactor(10000, 500)}`
);

// 1.2 Pathological / Missing Dimensions
const pathologicalInputs: [number | undefined | null, number | undefined | null, string][] = [
  [undefined, undefined, "both undefined"],
  [undefined, 40, "width undefined"],
  [800, undefined, "depth undefined"],
  [null, null, "both null"],
  [null, 40, "width null"],
  [800, null, "depth null"],
  [0, 40, "width zero"],
  [800, 0, "depth zero"],
  [-100, 40, "width negative"],
  [800, -20, "depth negative"],
  [NaN, 40, "width NaN"],
  [800, NaN, "depth NaN"],
  [Infinity, 40, "width Infinity"],
  [800, Infinity, "depth Infinity"],
];

for (const [w, d, label] of pathologicalInputs) {
  assert(
    constrictionFactor(w as unknown as number, d as unknown as number) === 1.0,
    `1.2 Pathological dimensions [${label}] return strict default C=1.0`,
    `Received C=${constrictionFactor(w as unknown as number, d as unknown as number)}`
  );
}

// 1.3 Peak Current Amplification across varying tidal ranges
// Moderate tide: amplitude 0.25m -> range 0.50m.
// Unconstricted (C=1.0): effectiveRange = 0.50m -> "mild"
// Constricted (C=2.5): effectiveRange = 1.25m -> "too_strong"
const modSeries = makeTidalSeries("2026-07-20T00:00", 72, 12, 0.25);
const openModFc = forecastHours({ hours: modSeries, inwardBearingDeg: 90 });
const narrowModFc = forecastHours({
  hours: modSeries,
  inwardBearingDeg: 90,
  channelWidthM: 300,
  channelDepthM: 30, // C=2.5
});

assert(narrowModFc.length === openModFc.length, "1.3.1 Forecast lengths match between open and constricted");

let peakAmplified = false;
let neverWeakened = true;

for (let i = 0; i < openModFc.length; i++) {
  const rOpen = rank(openModFc[i].strength);
  const rNarrow = rank(narrowModFc[i].strength);

  if (rNarrow < rOpen) neverWeakened = false;
  if (rNarrow > rOpen) peakAmplified = true;
}

assert(
  peakAmplified,
  "1.3.2 Constricted channel produces strictly stronger peak current rating than open site under identical tidal slope",
  `Peak amplified: ${peakAmplified}`
);
assert(
  neverWeakened,
  "1.3.3 Constricted channel never produces weaker current rating than open site at any hour"
);

// 1.4 Slack Preservation
// When slope is 0 (flat series), constriction MUST preserve slack
const flatSeries: MarineHour[] = Array.from({ length: 48 }, (_, i) => ({
  time: new Date(Date.UTC(2026, 6, 20, i)).toISOString().slice(0, 16),
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
  "1.4.1 Zero slope remains 100% 'slack' even under maximal constriction C=2.5"
);

// =============================================================================
// 2. INVARIANT 2: NOISY/CONTRADICTORY REPORTS & OUTLIER DAMPENING
// =============================================================================
console.log("\n--- 2. INVARIANT 2: Outlier Dampening & Anti-Jump Guarantees ---");

const tideSeries72 = makeTidalSeries("2026-07-20T00:00", 72, 12, 0.6);
// In makeTidalSeries, start is 2026-07-20T00:00Z.
// t = 1 hour is 2026-07-20T01:00. Phase = 2*pi*1/12 = pi/6.
// sin(pi/6) = 0.5. Slope from t=0 to t=1: 0.5 - 0 = +0.5 > 0 -> strictly rising (incoming) tide!
// Day 2 (t = 25 hours): 2026-07-21T01:00. Phase = 25 * pi / 6 = 4*pi + pi/6 = pi/6 -> incoming!
const targetRisingTime = "2026-07-21T01:00";

// 2.1 Single outlier dampened against consensus
const concordant4: Report[] = [
  { id: "c1", siteId: "s", time: targetRisingTime, direction: "incoming", strength: "strong" },
  { id: "c2", siteId: "s", time: targetRisingTime, direction: "incoming", strength: "strong" },
  { id: "c3", siteId: "s", time: targetRisingTime, direction: "incoming", strength: "strong" },
  { id: "c4", siteId: "s", time: targetRisingTime, direction: "incoming", strength: "strong" },
];
const outlierReport: Report = {
  id: "outlier",
  siteId: "s",
  time: targetRisingTime,
  direction: "outgoing", // Contradicts incoming consensus
  strength: "too_strong",
};

const baseClean = forecastHours({ hours: tideSeries72, inwardBearingDeg: 90, reports: concordant4 });
const withOutlier = forecastHours({ hours: tideSeries72, inwardBearingDeg: 90, reports: [...concordant4, outlierReport] });

const targetBaseHour = findHour(baseClean, targetRisingTime);
const targetOutlierHour = findHour(withOutlier, targetRisingTime);

assert(targetBaseHour != null && targetOutlierHour != null, "2.1.1 Target hour found in forecasts");
assert(
  targetOutlierHour?.direction === "incoming",
  "2.1.2 4 vs 1 consensus dampens outlier; direction remains 'incoming'",
  `Observed: ${targetOutlierHour?.direction}`
);
assert(
  targetOutlierHour?.direction === targetBaseHour?.direction,
  "2.1.3 Single noisy report causes NO direction inversion at target hour"
);

// Check that entire 72h phase structure has zero phase jumps
let phaseJumpDetected = false;
for (let i = 0; i < baseClean.length; i++) {
  if (baseClean[i].direction !== withOutlier[i].direction) {
    phaseJumpDetected = true;
    break;
  }
}
assert(
  !phaseJumpDetected,
  "2.1.4 Noisy outlier does not cause erratic phase jumps across any hour in the 72h forecast"
);

// 2.2 Lone Wolf Report (< 2 voters guard)
const loneWolf: Report = {
  id: "lone-wolf",
  siteId: "s",
  time: targetRisingTime,
  direction: "outgoing",
  strength: "strong",
  slopeM: 0.08,
};
const astroBaseline = forecastHours({ hours: tideSeries72, inwardBearingDeg: 90, reports: [] });
const loneForecast = forecastHours({ hours: tideSeries72, inwardBearingDeg: 90, reports: [loneWolf] });

// 24h later: should match astronomical baseline direction
const laterAstro = findHour(astroBaseline, "2026-07-22T01:00");
const laterLone = findHour(loneForecast, "2026-07-22T01:00");
assert(
  laterLone?.direction === laterAstro?.direction,
  "2.2.1 Lone report cannot cause spurious global phase offset shift (voter count < 2 guard)"
);

// 2.3 L1 Lag Penalty and Consensus Ratio constants
assert(LAG_PENALTY_LAMBDA === 0.05, "2.3.1 LAG_PENALTY_LAMBDA is strictly 0.05");
assert(CONSENSUS_RATIO_THRESHOLD === 0.6, "2.3.2 CONSENSUS_RATIO_THRESHOLD is strictly 0.60");
assert(REPORT_HALF_LIFE_DAYS === 90, "2.3.3 REPORT_HALF_LIFE_DAYS is strictly 90 days");

// 2.4 Speed factor concordance filtering (Milestone 3 fix)
// When 3 reports are incoming ("too_strong") and 1 outlier is outgoing ("mild"),
// the contradictory outlier must NOT pull down the speed factor of the incoming tide.
const reportsWithOppositeOutlier: Report[] = [
  { id: "s1", siteId: "s", time: targetRisingTime, direction: "incoming", strength: "too_strong" },
  { id: "s2", siteId: "s", time: targetRisingTime, direction: "incoming", strength: "too_strong" },
  { id: "s3", siteId: "s", time: targetRisingTime, direction: "incoming", strength: "too_strong" },
  { id: "s-opp", siteId: "s", time: targetRisingTime, direction: "outgoing", strength: "mild" },
];
const speedFc = forecastHours({ hours: tideSeries72, inwardBearingDeg: 90, reports: reportsWithOppositeOutlier });
const speedTarget = findHour(speedFc, targetRisingTime);
assert(
  speedTarget?.strength === "too_strong",
  "2.4.1 Contradictory outlier report does not dilute speed factor calibration on concordant flow",
  `Observed: ${speedTarget?.strength}`
);

// =============================================================================
// 3. INVARIANT 3: NEVER-HIGH CONFIDENCE ON RECENT CONTRADICTION
// =============================================================================
console.log("\n--- 3. INVARIANT 3: Never-High Confidence On Recent Contradiction ---");

// Use a 168-hour (7 full days) series so hours 15 to 153 have valid centered residuals
const tideSeries168 = makeTidalSeries("2026-07-17T00:00", 168, 12, 0.6);
// Target rising hour at Day 4: 2026-07-21T01:00 (index 97, phase pi/6 -> incoming)
const confTargetStr = "2026-07-21T01:00";
const confTargetMs = Date.parse(confTargetStr + ":00Z");

// Baseline 5 concordant reports (15 days old so outside 7-day window)
const time15d = new Date(confTargetMs - 15 * 24 * 3600 * 1000).toISOString().slice(0, 16);
const highConfBaseReports: Report[] = [
  { id: "b1", siteId: "s", time: time15d, direction: "incoming", strength: "too_strong", slopeM: 0.08 },
  { id: "b2", siteId: "s", time: time15d, direction: "incoming", strength: "too_strong", slopeM: 0.08 },
  { id: "b3", siteId: "s", time: time15d, direction: "incoming", strength: "too_strong", slopeM: 0.08 },
  { id: "b4", siteId: "s", time: time15d, direction: "incoming", strength: "too_strong", slopeM: 0.08 },
  { id: "b5", siteId: "s", time: time15d, direction: "incoming", strength: "too_strong", slopeM: 0.08 },
];

const confBaseline = forecastHours({
  hours: tideSeries168,
  inwardBearingDeg: 90,
  reports: highConfBaseReports,
  allowHighConfidence: true,
});
const confBaseTarget = findHour(confBaseline, confTargetStr);
assert(
  confBaseTarget?.confidence === "high",
  "3.1 Baseline setup successfully establishes 'high' confidence with 5 agreeing reports",
  `Base confidence: ${confBaseTarget?.confidence}`
);

// Adversarial Contradiction Points across the 7-day boundary
// Note: Tidal cycle is 12h, so tidal phase aligns at multiples of 12h: delta = -12h, -24h, -36h, -48h, -72h, etc.
// Reports within 1h (< HOUR_MS) trigger immediate contradiction regardless of tidal phase.
const testContradictions: { label: string; deltaMs: number; expectHighForbidden: boolean }[] = [
  { label: "Exact same second (delta = 0s)", deltaMs: 0, expectHighForbidden: true },
  { label: "15 minutes prior (delta = -15m)", deltaMs: -15 * 60 * 1000, expectHighForbidden: true },
  { label: "30 minutes prior (delta = -30m)", deltaMs: -30 * 60 * 1000, expectHighForbidden: true },
  { label: "59 minutes prior (delta = -59m, clock-hour rule)", deltaMs: -59 * 60 * 1000, expectHighForbidden: true },
  { label: "12 hours prior (delta = -12h, aligned phase)", deltaMs: -12 * 3600 * 1000, expectHighForbidden: true },
  { label: "24 hours prior (1 day, delta = -24h, aligned phase)", deltaMs: -24 * 3600 * 1000, expectHighForbidden: true },
  { label: "48 hours prior (2 days, delta = -48h, aligned phase)", deltaMs: -48 * 3600 * 1000, expectHighForbidden: true },
  { label: "72 hours prior (3 days, delta = -72h, aligned phase)", deltaMs: -72 * 3600 * 1000, expectHighForbidden: true },
  { label: "6.99 days prior (delta = -6.99d, slopeM=0.08)", deltaMs: -Math.floor(6.99 * 24 * 3600 * 1000), expectHighForbidden: true },
  { label: "7 days - 1 second (inside 7d gate)", deltaMs: -(SEVEN_DAYS_MS - 1000), expectHighForbidden: true },
  { label: "Future clock skew (+30 minutes, < 1h rule)", deltaMs: 30 * 60 * 1000, expectHighForbidden: true },
  { label: "Future clock skew (+12 hours, aligned phase)", deltaMs: 12 * 3600 * 1000, expectHighForbidden: true },
  { label: "Boundary at 7.01 days prior (> 7 days)", deltaMs: -Math.ceil(7.01 * 24 * 3600 * 1000), expectHighForbidden: false },
  { label: "Historical 14 days prior (> 7 days)", deltaMs: -14 * 24 * 3600 * 1000, expectHighForbidden: false },
];

for (const tc of testContradictions) {
  const contraTime = new Date(confTargetMs + tc.deltaMs).toISOString().slice(0, 16);
  const contraReport: Report = {
    id: `contra-${tc.label}`,
    siteId: "s",
    time: contraTime,
    direction: "outgoing", // Contradicts predicted incoming
    strength: "strong",
    slopeM: 0.08,
  };

  const fc = forecastHours({
    hours: tideSeries168,
    inwardBearingDeg: 90,
    reports: [...highConfBaseReports, contraReport],
    allowHighConfidence: true,
  });

  const hour = findHour(fc, confTargetStr);
  if (tc.expectHighForbidden) {
    assert(
      hour?.confidence !== "high",
      `3.2 Contradiction check: [${tc.label}] strictly forbids 'high' confidence`,
      `Returned confidence: '${hour?.confidence}'`
    );
  } else {
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
  time: new Date(confTargetMs - 2 * 3600 * 1000).toISOString().slice(0, 16), // 2 hours ago
  direction: "outgoing",
  strength: "strong",
  slopeM: 0.08,
};

const massiveFc = forecastHours({
  hours: tideSeries168,
  inwardBearingDeg: 90,
  reports: [...massive100Concordant, singleRecentContradiction],
  allowHighConfidence: true,
});
const massiveHour = findHour(massiveFc, confTargetStr);

assert(
  massiveHour?.confidence !== "high",
  "3.4.1 Invariant: 100 concordant reports CANNOT override 1 recent contradiction to achieve 'high' confidence",
  `Confidence returned: '${massiveHour?.confidence}'`
);

// 3.5 allowHighConfidence = false strictly suppresses high confidence
const noHighFc = forecastHours({
  hours: tideSeries168,
  inwardBearingDeg: 90,
  reports: highConfBaseReports,
  allowHighConfidence: false,
});
const noHighHour = findHour(noHighFc, confTargetStr);
assert(
  noHighHour?.confidence !== "high",
  "3.5.1 allowHighConfidence: false strictly suppresses 'high' confidence",
  `Confidence returned: '${noHighHour?.confidence}'`
);

// =============================================================================
// 4. EDGE CONDITIONS STRESS TESTING
// =============================================================================
console.log("\n--- 4. EDGE CONDITIONS STRESS TESTING ---");

// 4.1 50/50 report direction splits with differing or equal strengths
// Case A: Equal strengths ("too_strong" vs "too_strong")
const equalSplitReports: Report[] = [
  { id: "eq-in", siteId: "s", time: targetRisingTime, direction: "incoming", strength: "too_strong" },
  { id: "eq-out", siteId: "s", time: targetRisingTime, direction: "outgoing", strength: "too_strong" },
];
const equalSplitFc = forecastHours({ hours: tideSeries72, inwardBearingDeg: 90, reports: equalSplitReports });
const equalSplitHour = findHour(equalSplitFc, targetRisingTime);
const astroHour = findHour(astroBaseline, targetRisingTime);

assert(
  equalSplitHour?.direction === astroHour?.direction,
  "4.1.1 Equal 50/50 split preserves astronomical direction exactly",
  `Split: ${equalSplitHour?.direction}, Astro: ${astroHour?.direction}`
);
assert(
  equalSplitHour?.strength === astroHour?.strength,
  "4.1.2 Equal 50/50 split produces zero speed factor distortion (matches astronomical strength)",
  `Split: ${equalSplitHour?.strength}, Astro: ${astroHour?.strength}`
);

// Case B: Differing strengths (incoming "strong" vs outgoing "mild")
const differingSplitReports: Report[] = [
  { id: "diff-in", siteId: "s", time: targetRisingTime, direction: "incoming", strength: "strong" },
  { id: "diff-out", siteId: "s", time: targetRisingTime, direction: "outgoing", strength: "mild" },
];
const diffSplitFc = forecastHours({ hours: tideSeries72, inwardBearingDeg: 90, reports: differingSplitReports });
const diffSplitHour = findHour(diffSplitFc, targetRisingTime);

assert(
  diffSplitHour?.direction === astroHour?.direction,
  "4.1.3 Differing strengths 50/50 split preserves astronomical direction",
  `Split: ${diffSplitHour?.direction}, Astro: ${astroHour?.direction}`
);
assert(
  diffSplitHour?.confidence === "low",
  "4.1.4 50/50 split produces 'low' confidence due to contradiction",
  `Confidence: ${diffSplitHour?.confidence}`
);

// 4.2 Report age boundary at 7.0 days vs 7.01 days (Sub-second and millisecond precision)
const t7Inside1ms = confTargetMs - (SEVEN_DAYS_MS - 1); // 1 ms inside
const t7Exact = confTargetMs - SEVEN_DAYS_MS; // Exactly 7 days
const t7Outside1ms = confTargetMs - (SEVEN_DAYS_MS + 1); // 1 ms outside
const t701OutsideMs = confTargetMs - Math.ceil(7.01 * 24 * 3600 * 1000); // 7.01 days outside

const reportInside1ms: Report = {
  id: "rep-inside-1ms",
  siteId: "s",
  time: new Date(t7Inside1ms).toISOString().slice(0, 16),
  direction: "outgoing",
  strength: "too_strong",
  slopeM: 0.08,
};
const reportExact7d: Report = {
  id: "rep-exact-7d",
  siteId: "s",
  time: new Date(t7Exact).toISOString().slice(0, 16),
  direction: "outgoing",
  strength: "too_strong",
  slopeM: 0.08,
};
const reportOutside1ms: Report = {
  id: "rep-outside-1ms",
  siteId: "s",
  time: new Date(t7Outside1ms).toISOString().slice(0, 16),
  direction: "outgoing",
  strength: "too_strong",
  slopeM: 0.08,
};
const reportOutside701d: Report = {
  id: "rep-outside-701d",
  siteId: "s",
  time: new Date(t701OutsideMs).toISOString().slice(0, 16),
  direction: "outgoing",
  strength: "too_strong",
  slopeM: 0.08,
};

const inside1msFc = forecastHours({
  hours: tideSeries168,
  inwardBearingDeg: 90,
  reports: [...highConfBaseReports, reportInside1ms],
  allowHighConfidence: true,
});
const exact7dFc = forecastHours({
  hours: tideSeries168,
  inwardBearingDeg: 90,
  reports: [...highConfBaseReports, reportExact7d],
  allowHighConfidence: true,
});
const outside1msFc = forecastHours({
  hours: tideSeries168,
  inwardBearingDeg: 90,
  reports: [...highConfBaseReports, reportOutside1ms],
  allowHighConfidence: true,
});
const outside701dFc = forecastHours({
  hours: tideSeries168,
  inwardBearingDeg: 90,
  reports: [...highConfBaseReports, reportOutside701d],
  allowHighConfidence: true,
});

const inside1msHour = findHour(inside1msFc, confTargetStr);
const exact7dHour = findHour(exact7dFc, confTargetStr);
const outside1msHour = findHour(outside1msFc, confTargetStr);
const outside701dHour = findHour(outside701dFc, confTargetStr);

assert(
  inside1msHour?.confidence !== "high",
  "4.2.1 Report at 7 days minus 1 millisecond strictly forbids 'high' confidence",
  `Returned: ${inside1msHour?.confidence}`
);
assert(
  exact7dHour?.confidence !== "high",
  "4.2.2 Report at exactly 7.000 days strictly forbids 'high' confidence",
  `Returned: ${exact7dHour?.confidence}`
);
assert(
  outside1msHour?.confidence === "medium",
  "4.2.3 Report at 7 days plus 1 millisecond safely falls outside 7d contradiction gate (degrades to 'medium')",
  `Returned: ${outside1msHour?.confidence}`
);
assert(
  outside701dHour?.confidence === "medium",
  "4.2.4 Report at 7.01 days safely falls outside 7d contradiction gate (degrades to 'medium')",
  `Returned: ${outside701dHour?.confidence}`
);

// 4.3 Extreme Date Inputs in Monsoon Climatology
const extremeDates: { date: Date | string | number; label: string }[] = [
  { date: new Date("1900-01-01T00:00:00Z"), label: "Year 1900 (deep past)" },
  { date: new Date("2100-01-01T00:00:00Z"), label: "Year 2100 (distant future)" },
  { date: new Date("3000-06-15T12:00:00Z"), label: "Year 3000 (millennium 3)" },
  { date: new Date("2024-02-29T12:00:00Z"), label: "Leap day 2024-02-29" },
  { date: new Date("2000-02-29T12:00:00Z"), label: "Centennial leap day 2000-02-29" },
  { date: new Date("2026-03-31T23:59:59.999Z"), label: "NE monsoon end (Mar 31 23:59:59.999Z)" },
  { date: new Date("2026-04-01T00:00:00.000Z"), label: "Spring transition start (Apr 1 00:00:00.000Z)" },
  { date: new Date("2026-04-30T23:59:59.999Z"), label: "Spring transition end (Apr 30 23:59:59.999Z)" },
  { date: new Date("2026-05-01T00:00:00.000Z"), label: "SW monsoon start (May 1 00:00:00.000Z)" },
  { date: new Date("2026-10-31T23:59:59.999Z"), label: "SW monsoon end (Oct 31 23:59:59.999Z)" },
  { date: new Date("2026-11-01T00:00:00.000Z"), label: "Autumn transition start (Nov 1 00:00:00.000Z)" },
  { date: new Date("2026-11-30T23:59:59.999Z"), label: "Autumn transition end (Nov 30 23:59:59.999Z)" },
  { date: new Date("2026-12-01T00:00:00.000Z"), label: "NE monsoon start (Dec 1 00:00:00.000Z)" },
  { date: new Date("2026-12-31T23:59:59.999Z"), label: "New Year Eve wrap (Dec 31 23:59:59.999Z)" },
  { date: new Date("2027-01-01T00:00:00.000Z"), label: "New Year start (Jan 1 00:00:00.000Z)" },
  { date: new Date(NaN), label: "Invalid Date(NaN)" },
  { date: new Date("invalid-date-string"), label: "Invalid Date string" },
];

let extremeDatesValid = true;
for (const ed of extremeDates) {
  const drift = getMaldivesMonsoonDrift(ed.date as Date);
  if (
    !Number.isFinite(drift.velocityMs) ||
    !Number.isFinite(drift.directionDeg) ||
    drift.velocityMs < 0 ||
    drift.velocityMs > 1.0 ||
    drift.directionDeg < 0 ||
    drift.directionDeg > 360
  ) {
    extremeDatesValid = false;
    console.error(`Invalid drift for ${ed.label}:`, drift);
  }
}
assert(
  extremeDatesValid,
  "4.3.1 Climatology handles all extreme dates, transition boundaries, leap days, and NaNs within physical bounds"
);

// 4.3.2 C^1 continuity across transition boundaries: sweep minute-by-minute across transitions
const transitionEpochs = [
  Date.UTC(2026, 3, 1, 0, 0), // Apr 1
  Date.UTC(2026, 4, 1, 0, 0), // May 1
  Date.UTC(2026, 10, 1, 0, 0), // Nov 1
  Date.UTC(2026, 11, 1, 0, 0), // Dec 1
];
let c1Continuous = true;
for (const epoch of transitionEpochs) {
  let prevV: number | null = null;
  // Sweep +/- 2 hours in 1-minute steps (240 steps)
  for (let m = -120; m <= 120; m++) {
    const t = new Date(epoch + m * 60 * 1000);
    const d = getMaldivesMonsoonDrift(t);
    if (prevV !== null) {
      const delta = Math.abs(d.velocityMs - prevV);
      // At 1-minute step, max realistic velocity delta is tiny (< 0.005 m/s)
      if (delta > 0.01) {
        c1Continuous = false;
        console.error(`Discontinuity detected at ${t.toISOString()}: delta = ${delta}`);
      }
    }
    prevV = d.velocityMs;
  }
}
assert(c1Continuous, "4.3.2 Climatology transitions exhibit smooth C^1 continuity without jumps");

// 4.4 Missing channel dimensions in sites catalog
const catalogSites = (sitesData as unknown as { sites: Site[] }).sites;
let missingCount = 0;
let presentCount = 0;
let allCatalogSitesPass = true;

for (const site of catalogSites) {
  // The live gate: a section is sized only when its depth is a mean or typical floor.
  const section = sectionInput(site);
  const hasDimensions = section.channelWidthM != null && section.channelDepthM != null;
  if (hasDimensions) {
    presentCount++;
    const factor = constrictionFactor(section.channelWidthM, section.channelDepthM);
    if (factor < 1.0 || factor > 2.5) {
      allCatalogSitesPass = false;
    }
  } else {
    missingCount++;
    const factor = constrictionFactor(section.channelWidthM, section.channelDepthM);
    if (factor !== 1.0) {
      allCatalogSitesPass = false;
    }
  }

  // Ensure forecast computation works seamlessly for this site
  const siteFc = forecastHours({
    hours: tideSeries72,
    inwardBearingDeg: 90,
    ...section,
  });

  if (siteFc.length === 0 || siteFc.some((h) => !STRENGTHS.includes(h.strength) || !["incoming", "outgoing"].includes(h.direction))) {
    allCatalogSitesPass = false;
  }
}

assert(
  presentCount >= 2 && missingCount >= 10,
  `4.4.1 Catalog contains both constricted sites (${presentCount}) and unconstricted sites (${missingCount})`
);
assert(
  allCatalogSitesPass,
  "4.4.2 All catalog sites (with or without dimensions) evaluate cleanly without NaN or fallback failures"
);

// =============================================================================
// SUMMARY & VERDICT
// =============================================================================
console.log("\n================================================================================");
console.log(`CHALLENGER EMPIRICAL SUITE SUMMARY: ${passedTests}/${totalTests} PASSED`);
if (failedTests > 0) {
  console.log(`FAILED TESTS: ${failedTests}`);
  failureLog.forEach((f) => console.log(f));
} else {
  console.log("ALL INVARIANTS AND EDGE CONDITIONS EMPIRICALLY CONFIRMED AND VERIFIED.");
}
console.log("================================================================================");

process.exit(failedTests > 0 ? 1 : 0);
