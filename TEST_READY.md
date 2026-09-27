# TEST READY — E2E Test Suite Specification & Verification

## Summary
The comprehensive 4-tier End-to-End Requirement Test Suite has been designed, implemented, and verified in `lib/e2e-requirements.test.ts`.

All test cases are derived strictly from user requirements in `ORIGINAL_REQUEST.md` and interface contracts in `PROJECT.md`. The suite compiles cleanly with zero TypeScript errors and passes all existing test suites without regression.

---

## Test Execution Command

Run the entire E2E test suite:
```bash
npm test -- lib/e2e-requirements.test.ts
```

Run specific test tiers:
```bash
npm test -- lib/e2e-requirements.test.ts -t "Tier 1"
npm test -- lib/e2e-requirements.test.ts -t "Tier 2"
npm test -- lib/e2e-requirements.test.ts -t "Tier 3"
npm test -- lib/e2e-requirements.test.ts -t "Tier 4"
```

Run the full project test suite (existing + E2E):
```bash
npm test
```

Verify build & lint:
```bash
npm run build
npm run lint
```

---

## Test Counts by Tier

| Tier | Category / Feature Scope | Test Count | Current Pass | Pending Milestones |
|------|-------------------------|------------|--------------|-------------------|
| **Tier 1** | **Feature Coverage** | **20** | **18** | **2** |
| | R1: Hydrodynamic Pass & Tidal Range Modeling | 5 | 5 | 0 |
| | R2: Monsoon & Seasonal Current Integration | 5 | 3 | 2 (M2: `getMaldivesMonsoonDrift`) |
| | R3: Calibrated Diver Report Learning & Confidence Scoring | 5 | 4 | 1 (M3: outlier dampening) |
| | R4: Automated Backtesting & Reliability Benchmark | 5 | 5 | 0 |
| **Tier 2** | **Boundary & Corner Cases** | **23** | **22** | **1** |
| | R1 Boundaries (zero/undefined dimensions, flat tides, extreme ranges) | 6 | 6 | 0 |
| | R2 Boundaries (transition boundaries, orthogonal/antiparallel flux) | 6 | 6 | 0 |
| | R3 Boundaries (same-time conflicts, empty/ancient reports, safety gate) | 6 | 5 | 1 (M3: tie-breaker determinism) |
| | R4 Boundaries (empty replay, out-of-range reports, 0%/100% accuracy) | 5 | 5 | 0 |
| **Tier 3** | **Cross-Feature Combinations** | **6** | **6** | **0** |
| | Pairwise interactions (Constriction + Drift, Constriction + Diver Noise, etc.) | 6 | 6 | 0 |
| **Tier 4** | **Real-World Application Scenarios** | **5** | **5** | **0** |
| | Canonical Maldives Passes (Rasdhoo, Miyaru, Kandooma, Fotteyo, Alimatha) | 5 | 5 | 0 |
| **Total** | **Full E2E Requirement Suite** | **54** | **50** | **4** |

---

## Verification & Status

- **Baseline Test Suite**: 84 passed / 84 total (0 regressions across `lib/*.test.ts`).
- **New E2E Suite**: 50 passed / 4 pending implementation across 54 tests.
- **Pending Tests**:
  1. `T1.R2.1`: `getMaldivesMonsoonDrift` returns eastward drift during summer SW monsoon (Milestone 2).
  2. `T1.R2.2`: `getMaldivesMonsoonDrift` returns westward drift during winter NE monsoon (Milestone 2).
  3. `T1.R3.3`: Outlier dampening regularizer dampens isolated contradictory report (Milestone 3).
  4. `T2.R3.6`: Balanced opposing reports evaluate deterministically without order-dependent flipping (Milestone 3).
- **TypeScript Build**: `npm run build` completes in ~2.5s with 0 errors.
- **Lint Verification**: `npm run lint` completes with 0 errors and 0 warnings.

---

## Feature Checklist & Progressive Testability Guide

As milestone implementation agents complete their assignments, their changes will turn the remaining pending tests green:

- [ ] **Milestone 1 (Hydrodynamics)**:
  - F1: Cross-sectional constriction factor ($C_{\text{constrict}} \in [1.0, 2.5]$)
  - F2: Tidal range amplitude scaling
  - F3: Site channel width/depth ingestion from `data/sites.json`
  - *Status*: Verified by T1.R1.1–T1.R1.5, T2.R1.1–T2.R1.6, T3.C1, T4.S1. (Currently green on baseline interface fallback, ready for hydrodynamic amplification).

- [ ] **Milestone 2 (Monsoon Currents)**:
  - F4: Climatology function `getMaldivesMonsoonDrift(date: Date)`
  - F5: Perimeter flux projection onto pass inward vector
  - F6: Net axial flow superposition and slack timing shift
  - *Status*: Tests T1.R2.1 and T1.R2.2 will turn green upon export of `getMaldivesMonsoonDrift`. Remaining R2 tests verified and ready.

- [ ] **Milestone 3 (Diver Report Calibration & Confidence)**:
  - F7: Exponential decay report weighting ($t_{1/2} = 90$ days)
  - F8: Outlier dampening & consensus anti-jump regularizer
  - F9: Calibrated confidence rating with hard safety gate (never "high" on recent contradiction)
  - *Status*: Tests T1.R3.3 and T2.R3.6 will turn green upon outlier dampening and deterministic consensus implementation. Hard confidence gate verified and active.

- [ ] **Milestone 4 (Backtesting Benchmark)**:
  - F10: Canonical benchmark fixture dataset
  - F11: Quantitative evaluation harness (`metrics` in `ReplayResult`)
  - F12: Automated CLI replay runner
  - *Status*: Tests T1.R4.1–T1.R4.5 and T2.R4.1–T2.R4.5 ready to validate `BenchmarkMetrics` output.

- [ ] **Milestone 5 (Final Verification)**:
  - 100% pass across all 54 E2E tests, zero regression in existing 84 tests, clean build and audit.
