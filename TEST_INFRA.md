# Test Infrastructure & Methodology — dive-current

## Overview
This document specifies the end-to-end (E2E) testing architecture, feature inventory, test tier taxonomy, authoritative derivation methods, and coverage thresholds for the `dive-current` hydrodynamic forecast and benchmark engine.

The testing suite resides in `lib/e2e-requirements.test.ts` and runs within the Vitest test runner.

---

## 1. 4-Tier Test Architecture

The E2E test suite adheres to an opaque-box, requirement-driven methodology. Tests exercise external observable behaviors, return structures, and physical predictions experienced by end users and consuming UI components, without binding to private implementation details.

```
┌────────────────────────────────────────────────────────────────────────┐
│               Tier 4: Real-World Application Scenarios                 │
│      (Rasdhoo Madivaru, Miyaru Kandu, Kandooma Thila, Fotteyo, etc.)   │
├────────────────────────────────────────────────────────────────────────┤
│               Tier 3: Cross-Feature Combinations                       │
│    (Constriction + Monsoon, Constriction + Diver Noise, Ebb vs Drift)  │
├────────────────────────────────────────────────────────────────────────┤
│               Tier 2: Boundary & Corner Cases                          │
│     (Zero/extreme dimensions, flat tides, seasonal transitions, ties)  │
├────────────────────────────────────────────────────────────────────────┤
│               Tier 1: Feature Coverage (R1, R2, R3, R4)                 │
│      (Hydrodynamics, Monsoon Climatology, Diver Calibration, Replay)   │
└────────────────────────────────────────────────────────────────────────┘
```

### Tier 1: Feature Coverage (>= 5 tests per feature group)
- **R1: Hydrodynamic Pass & Tidal Range Modeling**: Channel constriction velocity amplification, area scaling formula bounds ($[1.0, 2.5]$), backward compatibility with unconstricted sites, spring vs. neap cycle amplitude scaling, and pass geometry integration.
- **R2: Monsoon & Seasonal Current Integration**: Climatological drift vectors (`getMaldivesMonsoonDrift`), seasonal vector reversal (SW eastward vs NE westward), atoll perimeter inward flux projection ($\cos\Delta\theta$), net axial flow superposition, and orthogonal pass flux isolation.
- **R3: Calibrated Diver Report Learning & Confidence Scoring**: Temporal exponential decay ($t_{1/2} = 90$ days), hard confidence guard (never "high" if recent report within $\le 7$ days contradicts direction), outlier dampening anti-jump regularizer, tidal slope discrepancy penalty, and concordant report confidence elevation.
- **R4: Automated Backtesting & Reliability Benchmark**: Replay harness outputting `BenchmarkMetrics`, directional accuracy computation, false-high-confidence rate accounting, confidence tier breakdown (high, medium, low), and slack timing deviation quantification.

### Tier 2: Boundary & Corner Cases (>= 5 tests per feature group)
- **R1 Boundaries**: Undefined channel width/depth fallback, zero width/depth division-by-zero protection, flat tides ($\Delta h = 0$), extreme spring tidal ranges ($> 1.8\text{m}$), micro-tidal dead neap ranges ($< 0.05\text{m}$), and massive channel area clamping ($C_{\min} = 1.0$).
- **R2 Boundaries**: Seasonal transition inflection dates (Apr 30 / May 1, Oct 31 / Nov 1, Nov 30 / Dec 1, Mar 31 / Apr 1), exactly orthogonal drift ($\Delta\theta = 90^\circ$, zero flux), and antiparallel drift ($\Delta\theta = 180^\circ$, maximum negative draw).
- **R3 Boundaries**: Same-timestamp contradictory reports, empty report collection, 100% contradictory reports, ancient report decay ($> 730$ days), immediate recent contradiction ($\le 2$ hours), and equal-weight opposing report determinism.
- **R4 Boundaries**: Zero reports replay evaluation, out-of-bounds report handling, 100% contradictory replay accuracy (0%), 100% concordant replay accuracy (100%), and exact slack timing evaluations.

### Tier 3: Cross-Feature Combinations (Pairwise Interactions)
- **T3.C1**: Constriction + Monsoon Drift: Narrow pass aligned with monsoon flux displays superposed velocity.
- **T3.C2**: Constriction + Opposing Monsoon: High constriction against counter-drift alters slack water turn.
- **T3.C3**: Constriction + Noisy Diver Reports: Narrow high-energy pass maintains phase stability under noisy reports.
- **T3.C4**: Monsoon Push + Spring Tide Slope: Aligned peak spring flood and monsoon drift saturate cleanly at `"too_strong"`.
- **T3.C5**: Monsoon Opposing Ebb + Calibrated Confidence: Opposing hydrodynamic shear depresses confidence rating to `"low"`.
- **T3.C6**: Constriction + Spring Tide + Recent Diver Validation: Agreement between spring flood, constriction, and fresh diver reports confirms `"high"` confidence.

### Tier 4: Real-World Application Scenarios (Canonical Maldives Passes)
- **T4.S1: Rasdhoo Madivaru (North Ari Atoll)**: Constricted pass ($W \approx 300\text{m}, D \approx 35\text{m}$) during spring flood; verified pelagic shark incoming drift.
- **T4.S2: Miyaru Kandu (Vaavu Atoll)**: High-energy eastern outer pass ($W \approx 800\text{m}, D \approx 45\text{m}$) during peak Southwest Monsoon (July); eastward open-ocean flow superposition.
- **T4.S3: Kandooma Thila (South Male Atoll)**: Moderate constriction pass with noisy historical diver reports; verified temporal phase lag decay and outlier dampening.
- **T4.S4: Fotteyo Kandu (Vaavu Atoll)**: Deep and wide outer pass ($W \approx 1500\text{m}, D \approx 65\text{m}$) during Northeast Monsoon (January); westward drift inward push.
- **T4.S5: Alimatha Kandu (Vaavu Atoll)**: Transitional inter-monsoon (April) sunset/night dive under neap tide; calm ocean drift producing safe "slack" or "mild" currents.

---

## 2. Feature Inventory & Milestone Mapping

| Req | Feature ID | Feature Description | Target Milestone | Test Coverage |
|-----|------------|---------------------|------------------|---------------|
| R1 | F1 | Channel Constriction Factor ($C_{\text{constrict}}$) | M1 | T1.R1.1, T1.R1.2, T1.R1.3, T2.R1.1, T2.R1.2, T2.R1.6, T3.C1, T3.C2, T3.C3, T3.C6 |
| R1 | F2 | Tidal Range Amplitude Scaling (Spring vs Neap) | M1 | T1.R1.4, T2.R1.4, T2.R1.5, T3.C4, T3.C6, T4.S1, T4.S5 |
| R1 | F3 | Pass Geometry Catalog Integration (`data/sites.json`) | M1 | T1.R1.5, T4.S1, T4.S2, T4.S3, T4.S4, T4.S5 |
| R2 | F4 | Seasonal Monsoon Climatology (`getMaldivesMonsoonDrift`) | M2 | T1.R2.1, T1.R2.2, T2.R2.1, T2.R2.2, T2.R2.3, T2.R2.4 |
| R2 | F5 | Atoll Perimeter Inward Flux Projection | M2 | T1.R2.3, T1.R2.5, T2.R2.5, T2.R2.6, T3.C1, T3.C2 |
| R2 | F6 | Net Axial Flow Superposition & Slack Timing Shift | M2 | T1.R2.4, T3.C1, T3.C4, T3.C5, T4.S2, T4.S4 |
| R3 | F7 | Temporal Decay Report Weighting ($t_{1/2} = 90$ days) | M3 | T1.R3.1, T2.R3.4, T4.S3 |
| R3 | F8 | Outlier Dampening & Anti-Jump Regularization | M3 | T1.R3.3, T2.R3.6, T3.C3, T4.S3 |
| R3 | F9 | Calibrated Confidence Scoring & Hard Safety Gates | M3 | T1.R3.2, T1.R3.4, T1.R3.5, T2.R3.1, T2.R3.2, T2.R3.3, T2.R3.5, T3.C5, T3.C6 |
| R4 | F10 | Benchmark Fixture Dataset Evaluation | M4 | T1.R4.1, T2.R4.1, T2.R4.2 |
| R4 | F11 | Quantitative Evaluation Metrics Calculation | M4 | T1.R4.1, T1.R4.2, T1.R4.3, T1.R4.4, T1.R4.5, T2.R4.3, T2.R4.4 |
| R4 | F12 | Automated Benchmark Replay Verification | M4 | T1.R4.1, T2.R4.1, T2.R4.5 |

---

## 3. Methodology & Expected Output Derivation

1. **Hydrodynamic Velocity Modeling**:
   - Cross-sectional pass area: $A_c = W \cdot D$
   - Constriction multiplier: $C_{\text{constrict}} = \text{clamp}\left( (2{,}000{,}000 / A_c)^{0.35}, 1.0, 2.5 \right)$
   - Unconstricted sites (missing geometry) yield $C_{\text{constrict}} = 1.0$.

2. **Monsoon Drift Projection**:
   - Inward flux: $v_{\text{monsoon, inward}} = v_{\text{drift}} \cos\left( (\theta_{\text{drift}} - \theta_{\text{inward}}) \cdot \frac{\pi}{180} \right)$
   - Direction: SW monsoon (May–Oct) headings $\approx 70^\circ\text{–}110^\circ$; NE monsoon (Dec–Mar) headings $\approx 240^\circ\text{–}300^\circ$.

3. **Diver Report Temporal Weighting**:
   - Weight decay: $w_i = 2^{-\Delta t_i / 90\text{ days}}$
   - Hard Safety Invariant: If any report with $\Delta t_i \le 7\text{ days}$ contradicts the predicted tidal direction, confidence is restricted to `{"low", "medium"}` and NEVER returns `"high"`.

4. **Progressive Testability**:
   - Structural typing allows all test cases to compile under strict TypeScript (`npm run build` and `tsc`).
   - Interface functions not yet implemented are guarded with runtime type assertions, yielding clean, actionable test failures during milestone progress without crashing the test runner or blocking existing suites.

---

## 4. Test Execution & Quality Gates

### Execution Commands
- **Full E2E Suite**: `npm test -- lib/e2e-requirements.test.ts`
- **Single Tier Filter**: `npm test -- lib/e2e-requirements.test.ts -t "Tier 1"`
- **All Project Tests**: `npm test`
- **Typecheck & Production Build**: `npm run build`
- **Lint Verification**: `npm run lint`

### Quality Thresholds
- **Pass Rate**: 100% of applicable tests must pass upon completion of each milestone.
- **Regression**: 0 failing tests in existing suites (`84/84` existing tests must pass).
- **TypeScript**: 0 type errors on full build.
- **ESLint**: 0 warnings and 0 errors.
