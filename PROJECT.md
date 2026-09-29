# Project: dive-current

## Architecture
`dive-current` is a Next.js / TypeScript engine predicting marine currents for Maldives dive sites based on astronomical tides, Open-Meteo ocean models, atoll pass geometry, and crowdsourced diver reports.

### Subsystem Flow
```
Open-Meteo / Cache (marine.ts) ──┐
Atoll Perimeter Geometry (bearing.ts) ──┼──> Hydrodynamic & Monsoon Forecast Engine (forecast.ts)
Site Catalog / Pass Dimensions (sites.json) ──┤        │
Crowdsourced Diver Reports (store.ts) ─────────┘        ▼
                                              Hourly Current & Slack Forecast
                                                       │
                                        ┌──────────────┴──────────────┐
                                        ▼                             ▼
                            Web UI (load-site.ts)         Benchmark Harness (replay.ts)
```

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Channel Constriction Modeling | Modulate current velocity/strength based on pass cross-sectional area ($A_c = W \times D$) relative to open water | M1 | ORIGINAL_REQUEST §R1 |
| F2 | Tidal Range Amplitude Scaling | Scale peak velocity with spring vs neap cycle tidal range | M1 | ORIGINAL_REQUEST §R1 |
| F3 | Pass Geometry Catalog | Populate channel width & depth in `data/sites.json` and pass to forecast engine via `loadSite` | M1 | ORIGINAL_REQUEST §R1 |
| F4 | Seasonal Monsoon Climatology | Seasonal drift vectors for SW (May–Oct, eastward) and NE (Dec–Mar, westward) monsoons with transitions | M2 | ORIGINAL_REQUEST §R2 |
| F5 | Atoll Perimeter Flux Integration | Project open-ocean surface currents onto pass inward bearing (outside-in push vs inside-out draw) | M2 | ORIGINAL_REQUEST §R2 |
| F6 | Net Axial Flow Superposition | Combine monsoon flux with tidal current, modulating speed, direction, and shifting slack timing | M2 | ORIGINAL_REQUEST §R2 |
| F7 | Temporal Decay Report Weighting | Weight recent diver reports higher using exponential decay ($t_{1/2} = 90$ days) | M3 | ORIGINAL_REQUEST §R3 |
| F8 | Outlier Dampening & Anti-Jump | $L_1$ lag penalty and consensus ratio threshold preventing erratic phase jumps on noisy reports | M3 | ORIGINAL_REQUEST §R3 |
| F9 | Calibrated Confidence Scoring | Penalize high slope-diver discrepancy and enforce hard guarantee: never "high" when recent reports contradict | M3 | ORIGINAL_REQUEST §R3 |
| F10 | Benchmark Fixture Dataset | Curated benchmark dataset (`data/benchmark-reports.json`) covering canonical passes, turns, and outliers | M4 | ORIGINAL_REQUEST §R4 |
| F11 | Quantitative Evaluation Harness | Calculate Directional Accuracy (%), Slack Timing Deviation MAE (mins), False-High-Confidence Rate (%) | M4 | ORIGINAL_REQUEST §R4 |
| F12 | Automated Benchmark CLI | Upgrade `scripts/replay.ts` to execute evaluation, print statistics table, and write `data/replay.json` | M4 | ORIGINAL_REQUEST §R4 |
| F13 | Full E2E & Adversarial Verification | 100% E2E test pass across all 4 tiers, zero regression in `npm test`, `npm run build`, and clean audit | M5 | ORIGINAL_REQUEST Acceptance Criteria |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M0 | E2E Testing Track | Independent requirement-driven test suite (Tiers 1–4) & `TEST_READY.md` | none | DONE |
| M1 | Hydrodynamic Pass & Tidal Range Physics | F1, F2, F3: channel constriction factor, tidal amplitude scaling, site geometry wiring | none | DONE |
| M2 | Monsoon & Seasonal Current Integration | F4, F5, F6: SW/NE climatological drift, perimeter flux projection, net axial flow | M1 | IN_PROGRESS |
| M3 | Calibrated Diver Report Learning & Confidence Scoring | F7, F8, F9: temporal decay, outlier dampening, calibrated confidence guards | M1 | PLANNED |
| M4 | Automated Backtesting & Reliability Benchmark | F10, F11, F12: benchmark fixture, quantitative evaluation harness, CLI execution | M1, M2, M3 | PLANNED |
| M5 | Final Verification & Adversarial Hardening | F13: Pass 100% E2E suite, Vitest, build, adversarial challenge, forensic audit | M0, M4 | PLANNED |

## Interface Contracts
### Channel Geometry (`lib/types.ts` & `lib/forecast.ts`)
```typescript
export type ForecastInput = {
  hours: MarineHour[];
  inwardBearingDeg: number;
  reports?: readonly Report[];
  allowHighConfidence?: boolean;
  channelWidthM?: number;
  channelDepthM?: number;
};
```
- Constriction factor: $C_{\text{constrict}} = \text{clamp}\left( (A_{\text{ref}} / (W \cdot D))^\gamma, C_{\min}, C_{\max} \right)$ with $A_{\text{ref}} = 2{,}000{,}000\text{ m}^2$, $\gamma \approx 0.35$, $C_{\min} = 1.0$, $C_{\max} = 2.5$.
- Unconstricted sites (missing width/depth) strictly produce $C_{\text{constrict}} = 1.0$ for backward compatibility.

### Monsoon & Climatology (`lib/forecast.ts`)
```typescript
export type OceanDrift = {
  velocityMs: number;
  directionDeg: number;
};
export function getMaldivesMonsoonDrift(date: Date): OceanDrift;
```
- Inward flux: $v_{\text{monsoon, inward}} = v_{\text{drift}} \cos((\theta_{\text{drift}} - \theta_{\text{inward}}) \cdot \frac{\pi}{180})$.

### Diver Report Learning & Confidence (`lib/forecast.ts`)
- Weight function: $w_i = 2^{-\Delta t_i / t_{1/2}}$ ($t_{1/2} = 90$ days).
- Phase lag selection: regularized score $S(k) = \text{weightedScore}(k) - \lambda_{\text{lag}} \cdot |k|$.
- Confidence hard gate: if any recent report ($\le 7$ days) has $r.\text{direction} \neq D_{\text{pred}}$, confidence $\in \{\text{"low"}, \text{"medium"}\}$, NEVER $\text{"high"}$.

### Benchmark Metrics (`lib/replay.ts`)
```typescript
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

export type ReplayResult = {
  ok: boolean;
  failures: number;
  strengthMismatches: number;
  metrics?: BenchmarkMetrics;
};
```

## Code Layout
- `lib/types.ts`: Core data structures (`Site`, `MarineHour`, `Report`, `ForecastHour`, `Strength`).
- `lib/bearing.ts`: Geographic bearing calculations and atoll rim inward vectors.
- `lib/forecast.ts`: Core hydrodynamic engine (tidal slope, constriction, monsoon flux, report fitting, confidence).
- `lib/load-site.ts`: Server orchestration loading marine data, site config, and computing forecasts.
- `lib/replay.ts`: Quantitative backtesting and replay evaluation harness.
- `scripts/replay.ts`: CLI entrypoint for running benchmark replay.
- `data/sites.json`: Dive site catalog and channel measurements.
- `data/benchmark-reports.json`: Curated benchmark scenarios used as test fixtures. Not real dive observations, so it says nothing about forecast accuracy.
