import {
  constrictionFactor,
  forecastHours,
  hourlyStrength,
} from "../lib/forecast";
import { STRENGTHS, type MarineHour, type Site, type Strength } from "../lib/types";
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

// Synthetic tidal generator
function generateTideSeries(
  amplitude: number,
  periodHours: number = 12,
  countHours: number = 72,
  noise: number = 0
): MarineHour[] {
  const origin = Date.UTC(2026, 8, 23, 0, 0);
  return Array.from({ length: countHours }, (_, i) => {
    const t = i;
    const wave = amplitude * Math.sin((2 * Math.PI * t) / periodHours);
    const n = noise !== 0 ? Math.sin(t * 1.7) * noise : 0;
    return {
      time: new Date(origin + t * 3600 * 1000).toISOString().slice(0, 16),
      seaLevelM: 0.5 + wave + n,
      currentVelocityMs: 0,
      currentDirectionDeg: 0,
    };
  });
}

console.log("=================================================");
console.log("STARTING EMPIRICAL ADVERSARIAL STRESS TEST FOR M1");
console.log("=================================================\n");

// -----------------------------------------------------------------
// 1. BOUNDARY INPUTS STRESS SUITE
// -----------------------------------------------------------------
console.log("--- Category 1: Boundary & Pathological Dimension Inputs ---");

const pathologicalDims: [number | undefined, number | undefined, string][] = [
  [0, 0, "W=0, D=0"],
  [0, 40, "W=0, D=40"],
  [500, 0, "W=500, D=0"],
  [-1, 40, "W=-1, D=40"],
  [500, -1, "W=500, D=-1"],
  [-100, -50, "W=-100, D=-50"],
  [Number.NaN, 40, "W=NaN, D=40"],
  [500, Number.NaN, "W=500, D=NaN"],
  [Number.NaN, Number.NaN, "W=NaN, D=NaN"],
  [Number.POSITIVE_INFINITY, 40, "W=Inf, D=40"],
  [500, Number.POSITIVE_INFINITY, "W=500, D=Inf"],
  [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, "W=Inf, D=Inf"],
  [Number.NEGATIVE_INFINITY, 40, "W=-Inf, D=40"],
  [500, Number.NEGATIVE_INFINITY, "W=500, D=-Inf"],
  [undefined, undefined, "W=undefined, D=undefined"],
  [500, undefined, "W=500, D=undefined"],
  [undefined, 40, "W=undefined, D=40"],
  [null as unknown as number, 40, "W=null, D=40"],
  [500, null as unknown as number, "W=500, D=null"],
  [1e-300, 1e-300, "W=1e-300, D=1e-300 (underflow area = 0)"],
  [1e300, 1e300, "W=1e300, D=1e300 (overflow area = Inf)"],
];

for (const [w, d, desc] of pathologicalDims) {
  const c = constrictionFactor(w, d);
  assert(
    c === 1.0,
    `Pathological dimension fallback to 1.0: [${desc}]`,
    `Received C=${c}`
  );
}

// Extreme channel sizes
assert(
  constrictionFactor(1, 1) === 2.5,
  "Extreme narrow channel 1m x 1m clamps to C_max (2.5)",
  `Received C=${constrictionFactor(1, 1)}`
);

assert(
  constrictionFactor(0.1, 0.1) === 2.5,
  "Extreme microscopic channel 0.1m x 0.1m clamps to C_max (2.5)",
  `Received C=${constrictionFactor(0.1, 0.1)}`
);

assert(
  constrictionFactor(100_000, 5_000) === 1.0,
  "Gigantic channel 100,000m x 5,000m clamps to C_min (1.0)",
  `Received C=${constrictionFactor(100_000, 5_000)}`
);

assert(
  constrictionFactor(1_000_000, 10_000) === 1.0,
  "Massive ocean passage 1,000,000m x 10,000m clamps to C_min (1.0)",
  `Received C=${constrictionFactor(1_000_000, 10_000)}`
);

// Reference channel (5000m x 400m = 2,000,000 m^2)
assert(
  Math.abs(constrictionFactor(5000, 400) - 1.0) < 1e-9,
  "Reference channel (5000m x 400m = 2,000,000m^2) evaluates to exactly 1.0",
  `Received C=${constrictionFactor(5000, 400)}`
);

// Full forecastHours execution with pathological inputs
const modSeries = generateTideSeries(0.26);
for (const [w, d, desc] of pathologicalDims) {
  try {
    const fc = forecastHours({
      hours: modSeries,
      inwardBearingDeg: 90,
      channelWidthM: w,
      channelDepthM: d,
    });
    assert(
      fc.length > 0 && fc.every((h) => STRENGTHS.includes(h.strength)),
      `forecastHours handles pathological input [${desc}] without crash or invalid output`,
      `Count: ${fc.length}`
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    assert(false, `forecastHours threw on pathological input [${desc}]`, message);
  }
}

// -----------------------------------------------------------------
// 2. MONOTONICITY STRESS SUITE
// -----------------------------------------------------------------
console.log("\n--- Category 2: Physical Monotonicity Verification ---");

let cMonotonic = true;
let prevC = 3.0; // higher than max
let prevArea = 0;
for (let exp = 1; exp <= 8; exp += 0.05) {
  const area = Math.pow(10, exp);
  const dim = Math.sqrt(area);
  const c = constrictionFactor(dim, dim);
  if (c > prevC + 1e-12) {
    cMonotonic = false;
    assert(
      false,
      `constrictionFactor monotonicity violation at area=${area}`,
      `prevArea=${prevArea} had C=${prevC}, larger area=${area} had C=${c}`
    );
    break;
  }
  prevC = c;
  prevArea = area;
}
if (cMonotonic) {
  assert(true, "constrictionFactor is strictly non-increasing across 140 area scales from 10 to 10^8 m^2");
}

const testTideRegimes: { name: string; amp: number; period: number }[] = [
  { name: "Spring Tide (high range)", amp: 0.5, period: 12 },
  { name: "Moderate Tide (medium range)", amp: 0.26, period: 12 },
  { name: "Neap Tide (low range)", amp: 0.15, period: 12 },
  { name: "Micro-Tide (near-slack range)", amp: 0.04, period: 12 },
  { name: "Diurnal Tide (24h period)", amp: 0.35, period: 24 },
  { name: "Mixed Semidiurnal (composite wave)", amp: 0.3, period: 12.42 },
];

const channelsGraded: { name: string; w: number; d: number; area: number }[] = [
  { name: "Ultra-narrow slit (200m x 20m)", w: 200, d: 20, area: 4_000 },
  { name: "Narrow Kandu (500m x 30m)", w: 500, d: 30, area: 15_000 },
  { name: "Tight Pass (700m x 40m)", w: 700, d: 40, area: 28_000 },
  { name: "Medium Pass (1200m x 50m)", w: 1200, d: 50, area: 60_000 },
  { name: "Wide Pass (2000m x 80m)", w: 2000, d: 80, area: 160_000 },
  { name: "Hani Kandu (3000m x 160m)", w: 3000, d: 160, area: 480_000 },
  { name: "Vaadhoo Reference (5000m x 400m)", w: 5000, d: 400, area: 2_000_000 },
  { name: "Wide Channel (8000m x 500m)", w: 8000, d: 500, area: 4_000_000 },
  { name: "Gigantic Ocean Cut (20000m x 1000m)", w: 20000, d: 1000, area: 20_000_000 },
  { name: "Open Baseline (unconstricted)", w: 0, d: 0, area: Infinity },
];

for (const regime of testTideRegimes) {
  const series = generateTideSeries(regime.amp, regime.period);
  const forecasts = channelsGraded.map((ch) => ({
    channel: ch,
    forecast: forecastHours({
      hours: series,
      inwardBearingDeg: 0,
      channelWidthM: ch.w > 0 ? ch.w : undefined,
      channelDepthM: ch.d > 0 ? ch.d : undefined,
    }),
  }));

  let regimeMonotonic = true;
  let violationDetails = "";

  for (let cIdx = 0; cIdx < forecasts.length - 1; cIdx++) {
    const narrower = forecasts[cIdx];
    const wider = forecasts[cIdx + 1];

    for (let h = 0; h < narrower.forecast.length; h++) {
      const hNarrow = narrower.forecast[h];
      const hWide = wider.forecast[h];

      if (hNarrow.time !== hWide.time) continue;

      const rNarrow = rank(hNarrow.strength);
      const rWide = rank(hWide.strength);

      if (rNarrow < rWide) {
        regimeMonotonic = false;
        violationDetails = `At hour ${hNarrow.time}: narrower '${narrower.channel.name}' (area ${narrower.channel.area}) produced '${hNarrow.strength}' (rank ${rNarrow}) < wider '${wider.channel.name}' (area ${wider.channel.area}) produced '${hWide.strength}' (rank ${rWide})`;
        break;
      }
    }
    if (!regimeMonotonic) break;
  }

  assert(
    regimeMonotonic,
    `End-to-end monotonicity under ${regime.name}`,
    violationDetails
  );
}

// -----------------------------------------------------------------
// 3. SLACK INVARIANTS STRESS SUITE
// -----------------------------------------------------------------
console.log("\n--- Category 3: Slack Invariants & Crest Behavior ---");

// Test 3.1: Zero sea-level slope invariant
const zeroSlopeSeries: MarineHour[] = Array.from({ length: 48 }, (_, i) => ({
  time: new Date(Date.UTC(2026, 8, 23, i)).toISOString().slice(0, 16),
  seaLevelM: 0.5,
  currentVelocityMs: 0,
  currentDirectionDeg: 0,
}));

for (const ch of [channelsGraded[0], channelsGraded[1], channelsGraded[5]]) {
  const fc = forecastHours({
    hours: zeroSlopeSeries,
    inwardBearingDeg: 0,
    channelWidthM: ch.w,
    channelDepthM: ch.d,
  });
  const allSlack = fc.every((h) => h.strength === "slack");
  assert(
    allSlack,
    `Zero sea-level slope invariant for channel '${ch.name}' (all output hours must be 'slack')`,
    `Total hours: ${fc.length}, non-slack: ${fc.filter((h) => h.strength !== "slack").length}`
  );
}

// Test 3.2: Slack Preservation Invariant
let slopeSlackPreserved = true;
let slopeSlackDetails = "";

for (const regime of testTideRegimes) {
  const series = generateTideSeries(regime.amp, regime.period);
  const openFc = forecastHours({ hours: series, inwardBearingDeg: 0 });
  const constrictedFc = forecastHours({
    hours: series,
    inwardBearingDeg: 0,
    channelWidthM: 300,
    channelDepthM: 20,
  });

  for (let i = 0; i < openFc.length; i++) {
    if (openFc[i].strength === "slack") {
      if (constrictedFc[i].strength === "strong" || constrictedFc[i].strength === "too_strong") {
        slopeSlackPreserved = false;
        slopeSlackDetails = `Regime ${regime.name} hour ${openFc[i].time}: open was 'slack', but constricted became '${constrictedFc[i].strength}'!`;
        break;
      }
    }
  }
  if (!slopeSlackPreserved) break;
}

assert(
  slopeSlackPreserved,
  "Slack hours under low tidal slope are never transformed into 'strong' or 'too_strong' by channel constriction",
  slopeSlackDetails
);

// Test 3.3: Turnaround crest slack preservation
const crestSeries = generateTideSeries(0.1, 12, 72);
for (const ch of [channelsGraded[0], channelsGraded[1]]) {
  const fc = forecastHours({
    hours: crestSeries,
    inwardBearingDeg: 0,
    channelWidthM: ch.w,
    channelDepthM: ch.d,
  });

  const crestHours = [3, 9, 15, 21, 27, 33, 39, 45, 51, 57, 63];
  let crestsPreserved = true;
  let failedHourInfo = "";

  for (const t of crestHours) {
    const timeStr = new Date(Date.UTC(2026, 8, 23, t)).toISOString().slice(0, 16);
    const hourFc = fc.find((h) => h.time.startsWith(timeStr));
    if (hourFc && hourFc.strength !== "slack") {
      crestsPreserved = false;
      failedHourInfo = `Crest hour ${timeStr} evaluated to '${hourFc.strength}' instead of 'slack'`;
      break;
    }
  }

  assert(
    crestsPreserved,
    `Turnaround crests (|S| < 0.02m) remain strictly 'slack' under extreme constriction (${ch.name})`,
    failedHourInfo
  );
}

// Test 3.4: Neap astronomical tide ceiling
let neapCeilingPreserved = true;
let neapCeilingDetails = "";

for (let range = 0.05; range < 0.35; range += 0.05) {
  const neapSeries = generateTideSeries(range / 2, 12, 72);
  const constrictedNeap = forecastHours({
    hours: neapSeries,
    inwardBearingDeg: 0,
    channelWidthM: 200,
    channelDepthM: 15,
  });

  for (const h of constrictedNeap) {
    if (h.strength === "strong" || h.strength === "too_strong") {
      neapCeilingPreserved = false;
      neapCeilingDetails = `Range ${range.toFixed(2)}m: hour ${h.time} evaluated to '${h.strength}' (exceeded diveable ceiling 'mild')`;
      break;
    }
  }
  if (!neapCeilingPreserved) break;
}

assert(
  neapCeilingPreserved,
  "Neap astronomical tides (H < 0.35m) are strictly capped at diveable 'mild' even under maximum constriction C=2.5",
  neapCeilingDetails
);

// Test 3.5: Direct unit stress on hourlyStrength
let directHourlySlackPreserved = true;
// Narrowing reaches hourlyStrength only through the envelope, so every envelope covers every constriction.
for (const env of STRENGTHS) {
  for (const slope of [0, 0.001, 0.005, 0.01, 0.015, 0.0199]) {
    const res = hourlyStrength(slope, 0.2, env);
    if (res !== "slack") {
      directHourlySlackPreserved = false;
      assert(
        false,
        `hourlyStrength violated slack invariant at slope=${slope}, env=${env}`,
        `Returned: ${res}`
      );
      break;
    }
  }
  if (!directHourlySlackPreserved) break;
}
if (directHourlySlackPreserved) {
  assert(true, "hourlyStrength strictly preserves 'slack' for all slopes < 0.02m across all envelopes");
}

// -----------------------------------------------------------------
// 4. DIRECTIONAL INVARIANCE STRESS SUITE
// -----------------------------------------------------------------
console.log("\n--- Category 4: Directional Invariance Verification ---");

for (const regime of testTideRegimes) {
  const series = generateTideSeries(regime.amp, regime.period);
  const openFc = forecastHours({
    hours: series,
    inwardBearingDeg: 45,
  });
  const constrictedFc = forecastHours({
    hours: series,
    inwardBearingDeg: 45,
    channelWidthM: 300,
    channelDepthM: 25,
  });

  let directionsMatch = true;
  for (let i = 0; i < openFc.length; i++) {
    if (openFc[i].direction !== constrictedFc[i].direction) {
      directionsMatch = false;
      assert(
        false,
        `Direction inverted under ${regime.name} at hour ${openFc[i].time}`,
        `Open: ${openFc[i].direction}, Constricted: ${constrictedFc[i].direction}`
      );
      break;
    }
  }
  if (directionsMatch) {
    assert(true, `Directional invariance holds 100% under ${regime.name}`);
  }
}

// -----------------------------------------------------------------
// 5. TIDAL AMPLIFICATION SENSITIVITY (Acceptance Criteria Check)
// -----------------------------------------------------------------
console.log("\n--- Category 5: Acceptance Criteria Hydrodynamic Amplification ---");

const realPassSites = (sitesData.sites as Site[]).filter(
  (s) => s.channelWidthM != null && s.channelDepthM != null
);

console.log(`Found ${realPassSites.length} catalog sites with physical dimensions.`);

let allPassesAmplified = true;
let narrowestC = 1.0;
let narrowestStronger = false;
const springSeries = generateTideSeries(0.26);
const openBaseline = forecastHours({ hours: springSeries, inwardBearingDeg: 0 });
const peakHour = "2026-09-24T00:00"; // steepest hour of the sine tide
const openPeakStrength = openBaseline.find((h) => h.time.startsWith(peakHour))?.strength;

for (const site of realPassSites) {
  const c = constrictionFactor(site.channelWidthM, site.channelDepthM);
  const siteFc = forecastHours({
    hours: springSeries,
    inwardBearingDeg: 0,
    channelWidthM: site.channelWidthM,
    channelDepthM: site.channelDepthM,
  });
  const sitePeakStrength = siteFc.find((h) => h.time.startsWith(peakHour))?.strength;

  if (c > 1.0) {
    // The factor is relative to a typical pass, so a mildly narrow one may not cross a band at this range.
    if (rank(sitePeakStrength!) < rank(openPeakStrength!)) {
      allPassesAmplified = false;
      console.warn(
        `  Warning: Site ${site.name} (C=${c.toFixed(2)}) strength '${sitePeakStrength}' was weaker than open '${openPeakStrength}'`
      );
    }
    if (c > narrowestC) {
      narrowestC = c;
      narrowestStronger = rank(sitePeakStrength!) > rank(openPeakStrength!);
    }
  }
}

assert(
  allPassesAmplified,
  "No constricted catalog site (C > 1.0) is weaker than open water under identical 0.52m slope"
);
assert(
  narrowestStronger,
  "The narrowest catalog site is strictly stronger than open water under identical 0.52m slope"
);

// -----------------------------------------------------------------
// SUMMARY
// -----------------------------------------------------------------
console.log("\n=================================================");
console.log(`STRESS TEST COMPLETE: ${passedTests}/${totalTests} PASSED`);
if (failedTests > 0) {
  console.log(`FAILED TESTS: ${failedTests}`);
  failureLog.forEach((f) => console.log(f));
} else {
  console.log("ALL ADVERSARIAL STRESS CHALLENGES PASSED WITH ZERO DEFECTS.");
}
console.log("=================================================");

process.exit(failedTests > 0 ? 1 : 0);
