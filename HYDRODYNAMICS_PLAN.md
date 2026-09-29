# Hydrodynamics & Channel Physics Implementation Plan

**Target System**: `CyberoniOntoni/dive-forecast` / `dive-current`  
**Purpose**: Rigorous, phased engineering specification to upgrade the forecast engine from an uncoupled tidal breather heuristic to an oceanographically grounded channel pass model. Aligns geometric channel axes, accounts for monsoon-driven through-flow, eliminates speculative parallel physics, and grounds predictions in empirical diver calibration.

---

## 1. Executive Summary & Critical Reality Check

### 1.1 The Oceanographic Reality
In Maldives atolls, channel current is physically driven by two interacting mechanisms:
1. **Tidal Pumping (Barotropic Storage)**: Sea level rising/falling causes radial exchange through passes ($\vec{U}_{\text{tide}} \propto \frac{\partial \eta}{\partial t}$).
2. **Monsoon Through-Flow (Oceanic Drift & Lagoon Head)**: Strong open-ocean currents (Eastward in SW Monsoon May–Oct; Westward in NE Monsoon Dec–Mar) pile water against the windward rim. This creates a hydraulic head across the atoll, supercharging inflow on the windward rim and forcing continuous outflow on the leeward rim—even during a rising tide.
3. **1D Bathymetric Constraint**: In any reef cut (*kandu*), water cannot flow sideways through a solid coral wall. Flow is physically constrained to the channel trench axis ($\theta_{\text{axis}}$).

### 1.2 Engineering Realities & Honest Schedule
A scientifically sound model cannot be delivered as an uncalibrated "3-hour patch". Attempting to ship free hydrodynamic constants without empirical tuning creates "monsoon-shaped cartoons" that fail at the critical dive hour. Specifically:
- **Direction Contract Change**: Today, the locked product contract states: *Residual tide slope dictates direction; ocean drift only nudges strength*. Letting through-flow flip the direction of weak tides is a major product behavior change that requires rewriting test baselines and replay benchmarks.
- **Opposite Neighbor Passes**: Macro rim classification (`east`/`west`) cannot explain why two adjacent eastern channels run in opposite directions (caused by local reef-flat wave radiation stress and hydraulic return relief). That requires per-pass empirical calibration from diver reports over time.
- **No Parallel Strength Systems**: The app already possesses a validated relative strength model based on tidal slope, spring/neap range, and constriction (`hourlyStrength`, `strengthFromRange`, `NUDGE_BAND`). Any through-flow physics must integrate with this system, not invent conflicting absolute velocity thresholds (e.g. 0.1 / 0.5 m/s).
- **Phased Approach**: We separate **high-confidence geometric corrections** (Stage A) from **complex hydrodynamics and direction flipping** (Stage B), followed by **empirical reporting calibration** (Stage C).

---

## 2. Phased Roadmap & Effort Breakdown

| Stage | Scope | Focus & Acceptance Bar | Realistic Effort |
|---|---|---|---|
| **Stage A1** | **Explicit Override + Guardrail Test** | Optional `inwardBearingDeg` on `Site`, preferred by `lib/bearing.ts`. Populate the 7 known-bad sites with measured values. Add a seeded-data sanity test so a bad bearing on any current or future site fails CI. Maintain the existing direction contract (slope = direction; ocean = nudge). | **~0.5 – 1 day** (plus measurement time) |
| **Stage A2** | **Rim-Derived Default (scales to new sites)** | Replace the mate-centroid / `outside → pin` default with the normal to the nearest atoll rim segment, pointing into the lagoon. Needed because more sites, and new atolls, are coming. | **~1 – 2 days** (depends on rim data quality) |
| **Stage B** | **Monsoon Through-Flow Projection** | **ON HOLD.** Blocked on the sign fix in §4.2, a real drift input, and enough reports to calibrate (§4.0 gates). | **~2 – 4 days once unblocked** |
| **Stage C** | **Empirical Pass Learning** | Learn local pass quirks and opposite-neighbor flow from diver reports so confidence ratings stay honest. | **Ongoing (post-launch)** |

> **Scaling note**: more dive sites will be added soon. Hand-measured per-site bearings do not scale, and the current heuristic degrades as sites are added: a new atoll's first site falls into the `outside → pin` fallback (the Kuredu / Rasdhoo failure), and every added site shifts its atoll's centroid, silently moving bearings for existing sites. Overrides (A1) are the escape hatch; the rim-derived default (A2) is the fix.

---

## 3. Stage A: Channel Geometry & Rim Verification (Immediate Phase)

### 3.1 Objective
Eliminate the severe centroid/fallback distortions discovered in the audit (where pins pointed out to sea or along the reef) by (A1) allowing sites to store an optional, verified `inwardBearingDeg`, and (A2) replacing the default heuristic with a rim-derived bearing so new sites and atolls start out correct.

> **Product-rule change**: `divesite_audit.md` §5 and §7 record "no stored bearings" and "no code fixes required" as locked rules. This plan deliberately reverses them (the audit's own Option A / Option B). Update the audit's §5 and §7 when Stage A merges so the two documents do not contradict each other.

### 3.2 Product Rule & Contract Guardrails
- **Direction Contract Preserved**: `slopeFromResidual` continues to decide incoming vs. outgoing.
- **Monsoon Nudge Preserved**: Ocean drift continues to project onto `inwardBearingDeg` to nudge strength bands via `monsoonNudge(hour, inwardBearingDeg)`.
- **Zero Risk of Wild Direction Flips**: Because the fundamental direction contract is untouched, boat crews are never presented with uncalibrated direction reversals.
- **High Visual Accuracy**: Pin arrows on the map and site headers now point along the actual physical channel cut into the lagoon.
- **User-Added Sites Asymmetry Stated**: When a user adds a custom site without azimuth data, it explicitly falls back to the existing centroid/ocean fallback heuristic.

### 3.3 Immediate Impact on `monsoonNudge` & Critical Risk Flag
In [`lib/forecast.ts`](file:///D:/Gork/dive-current/lib/forecast.ts), `monsoonNudge` calculates:
```typescript
const inward = monsoonInwardFlux(drift, inwardBearingDeg);
return Math.max(-1, Math.min(1, inward / NUDGE_SATURATION_MS));
```
Because this uses $\cos(\theta_{\text{drift}} - \theta_{\text{inward}})$, changing `inwardBearingDeg` will immediately alter the nudge value for those 7 sites:
- **Kuredu Express** ($317^\circ \to 170^\circ$): Under SW Monsoon (drift $90^\circ$), previously $\cos(90^\circ - 317^\circ) = \cos(-227^\circ) = -0.68$ (negative nudge, weakening incoming). Now $\cos(90^\circ - 170^\circ) = \cos(-80^\circ) = +0.17$ (near zero/neutral cross-flow).
- **Vaavu Passes (CRITICAL RISK TARGET)** ($110^\circ\text{–}126^\circ \to 220^\circ\text{–}230^\circ$): Under SW Monsoon ($90^\circ$), previously $\cos(90^\circ - 120^\circ) = +0.86$ (falsely boosting flood). Now $\cos(90^\circ - 230^\circ) = -0.76$ (correctly opposing flood into the lagoon).
  > [!WARNING]
  > The Vaavu passes experience a full sign reversal on their strength nudge ($+0.86 \to -0.76$). During peak SW monsoon (June–August), this is large enough to shift strength by a full band (e.g., from `strong` to `mild`). All historical reports for Vaavu during June–August in `data/replay.json` must be explicitly verified against this shift prior to merging Stage A.

### 3.4 Coupling Impact on Open-Meteo Sampling Point (`seawardPoint`)
In [`lib/marine.ts`](file:///D:/Gork/dive-current/lib/marine.ts), the marine data sampling coordinates are calculated via `seawardPoint(site.lat, site.lon, inwardBearingDeg)`:
```typescript
const outwardBearing = ((inwardBearingDeg + 180) % 360 + 360) % 360;
return destinationKm(lat, lon, outwardBearing, 3.0); // 3 km seaward
```
**Critical Architecture Insight**:
- For a site whose inward bearing is inverted (e.g. Kuredu Express from $317^\circ$ to $170^\circ$), its outward bearing changes from $137^\circ$ (Southeast into the atoll lagoon) to $350^\circ$ (North into open ocean).
- Previously, the app was sampling marine data **inside the lagoon** because the outward vector pointed backwards! Correcting `inwardBearingDeg` now correctly places the 3 km sample point in open ocean.
- **Cache Invalidation**: Because `data/marine-cache` keys files by `lat_lon.json`, fixing the bearing will query a new coordinate. Offline test suites that mock or cache marine hours must be checked to ensure test fixtures provide coverage for the new seaward points.

### 3.4b Missing-Bearing Contract
`ForecastInput.inwardBearingDeg` is a required `number` and `lib/nowcast.ts` currently does `loaded.bearing ?? 0`. Define one behavior for sites with no override and no usable rim data (user-added sites in a new atoll): use the fallback heuristic, tag the bearing source as `fallback`, and let the UI show a low-trust marker instead of a confident arrow. Never silently substitute `0`.

### 3.5 Data Schema Changes
In [`lib/types.ts`](file:///D:/Gork/dive-current/lib/types.ts):
```typescript
export type RimFacing = "east" | "west" | "north" | "south" | "inside";

export type Site = {
  id: string;
  name: string;
  atollId: string;
  lat: number;
  lon: number;
  sourceUrl: string;
  diveTopM?: number;
  diveMaxM?: number;
  depthSourceUrl?: string;
  channelWidthM?: number;
  channelDepthM?: number;
  channelSourceUrl?: string;

  /**
   * True physical inward channel axis (0-359 degrees).
   * Direction water flows when entering the lagoon from the ocean.
   * If omitted, uses the rim-derived default (A2), then the legacy
   * mate-centroid / ocean fallback if the atoll has no rim data.
   */
  inwardBearingDeg?: number;

  /**
   * Rim facing relative to atoll perimeter. Stage B only; do not add until
   * Stage B is unblocked (dead data in Stage A).
   */
  rimFacing?: RimFacing;
};

/** Where a resolved bearing came from. Drives the UI trust marker. */
export type BearingSource = "override" | "rim-derived" | "fallback";

export type ForecastInput = {
  hours: MarineHour[];
  inwardBearingDeg: number;
  reports?: readonly Report[];
  allowHighConfidence?: boolean;
  channelWidthM?: number;
  channelDepthM?: number;
  /** Rim facing used for monsoon through-flow coupling. */
  rimFacing?: RimFacing;
};
```

### 3.6 Seeded Sites Geometry Table (Pending Satellite Ruler Measurement)
The azimuths below are **proposed approximations derived from geographic audit analysis**. Each bearing MUST undergo explicit measurement against satellite imagery (Sentinel-2 / Esri World Imagery) and OpenStreetMap channel cut lines during Task 1 before production merge:

| Site ID | Atoll | Physical Feature | Proposed Azimuth (`inwardBearingDeg`) | `rimFacing` | Verification Status |
|---|---|---|---|---|---|
| `kuredu-express` | Lhaviyani | North rim trench | **165° (SSE)** | `north` | Measured on Esri imagery (2026-09-29), ±15°; pass runs N→S between the two reefs. Audit proposed 170° |
| `miyaru-kandu` | Vaavu | Northeast rim channel | **280° (W)** | `east` | Measured, ±15°; northernmost of the three passes, runs W-WNW. Audit proposed 230° |
| `devana-kandu` | Vaavu | Northeast rim channel | **250° (WSW)** | `east` | Measured, ±15°; pin sits on the reef flat between two passes, both read ~250°. Audit proposed 230° |
| `alimatha-house-reef` | Vaavu | Northeast channel edge | **250° (WSW)** | `east` | Measured, ±15°; pass south of the island reads ~250°. Audit proposed 220° |
| `kandooma-thila` | South Malé | Cocoa Pass (Biyaadhoo Kandu) | **285° (WNW)** | `east` | Measured, ±15°, from the gap between the two reefs at low zoom. Audit proposed 280° |
| `kuda-giri` | South Malé | Inner rim drop-off | **265° (West)** | `east` | NOT measured: the pin sits in open water with no defined pass in imagery. Left on the heuristic (357°, wrong) until a better source exists |
| `rasdhoo-madivaru` | Rasdhoo | Southeast corner cut | **330° (NNW)** | `south` | Measured, ±15°, at the reef tip / island gap. Audit proposed 335° |
| `fotteyo-kandu` | Vaavu | East tip pass | **285° (WNW)** | `east` | Verified accurate in audit (13° diff) |
| `embudhoo-express` | South Malé | Embudhoo channel | **225° (SW)** | `east` | Verified accurate in audit (9° diff) |
| `vaadhoo-caves` | South Malé | Vaadhoo Kandu rim | **170° (South)** | `north` | Verified accurate in audit (12° diff) |
| `hp-reef` | North Malé | Himmafushi pass | **275° (West)** | `east` | Verified accurate in audit (4° diff) |
| `banana-reef` | North Malé | North Malé pass | **340° (NNW)** | `east` | Verified accurate in audit (3° diff) |
| `manta-point-lankanfinolhu` | North Malé | Southeast barrier reef | **300° (WNW)** | `east` | Verified accurate in audit (1° diff) |
| `nassimo-thila` | North Malé | Outer reef thila | **320° (NW)** | `east` | Verified accurate in audit (12° diff) |
| `kuda-faru` | North Malé | North rim pass | **160° (SSE)** | `north` | Verified accurate in audit (5° diff) |
| `kuda-haa` | North Malé | Southwest entrance | **30° (NNE)** | `west` | Verified accurate in audit (11° diff) |
| `fish-head` | North Ari | Internal thila | **315° (NW)** | `inside` | Verified accurate in audit (8° diff) |
| `maaya-thila` | North Ari | Internal thila | **210° (SSW)** | `inside` | Verified accurate in audit (10° diff) |
| `fesdhoo` | North Ari | West rim reef | **75° (ENE)** | `west` | Verified accurate in audit (15° diff) |
| `fesdu-wreck` | North Ari | West rim wreck | **75° (ENE)** | `west` | Same reef area as Fesdhoo (15° diff) |
| `himandhoo-thila` | North Ari | Southwest pass | **50° (NE)** | `west` | Verified accurate in audit (3° diff) |
| `halaveli-wreck` | North Ari | Internal wreck | **250° (WSW)** | `inside` | Verified accurate in audit (14° diff) |
| `kudarah-thila` | South Ari | Southeast pass thila | **300° (WNW)** | `east` | Inner channel thila; flood enters from East (20° diff) |
| `broken-rock` | South Ari | Dhigurah channel cut | **300° (WNW)** | `east` | Canyon in Dhigurah pass; flood enters from East (20° diff) |
| `rangali-madivaru` | South Ari | West rim pass | **85° (East)** | `west` | Verified accurate in audit (15° diff) |

> The "Proposed Azimuth" values above are the audit's eyeballed `~` figures, not measurements. Only the 7 discrepant rows need overrides (the "Verified accurate" rows are within ~20° of the heuristic today, and A2 should reproduce them). Do not write any proposed value into `data/sites.json` until it has been measured.

### 3.7 Stage A1 Implementation Steps (override + guardrail)
1. **Satellite Ruler Measurement**:
   - Inspect satellite imagery for the 7 discrepant channels and record exact centerline azimuths.
2. **Update `lib/bearing.ts`**:
   - Check `site.inwardBearingDeg` first. If present and finite, return it with source `override`.
   - If missing, execute the existing mate-centroid / ocean fallback heuristic (source `fallback`) until A2 lands.
3. **Update Tests (`lib/bearing.test.ts`)**:
   - Add unit tests verifying that explicit `inwardBearingDeg` is prioritized when provided.
   - Assert fallback behavior remains intact for unseeded or user-added sites.
4. **Seeded-data sanity test (new, guards future sites)**:
   - For every site in `data/sites.json`, assert the resolved bearing points from the rim into the lagoon (e.g. the point 1 km along the inward bearing is inside the atoll rim polygon, the point 1 km along the outward bearing is outside). A newly added site with a bad bearing fails CI.
   - Sites on internal thilas (`rimFacing: "inside"`) are exempt or use a looser check.
5. **Verify Replay & Backtest (`npm test`, `lib/replay.test.ts`)**:
   - Run replay evaluation, paying special attention to the Vaavu June–August reports under the $+0.86 \to -0.76$ nudge shift.

### 3.8 Stage A2 Implementation Steps (rim-derived default)
1. **Rim data**: each atoll already has a `rimSourceUrl` (OpenStreetMap way). Fetch each polygon once, simplify it, and store it in-repo (e.g. `data/rims.json`). Do not fetch at request time. Assess coverage first: confirm every current atoll has a usable closed polygon.
2. **Algorithm**: find the nearest rim segment to the site; take its normal pointing into the polygon interior. Return source `rim-derived`.
3. **Known limits**: a rim normal only approximates flow in a trench. It is poor for internal thilas and for passes that cut the rim obliquely. Those keep overrides. Compare A2 output against the 25-site audit table and use overrides wherever the difference exceeds ~30°.
4. **Cheaper stopgap** if rim data is unusable: one `lagoonLat` / `lagoonLon` per atoll (audit Option B). Wrong for elongated atolls but better than the centroid of dive pins.
5. **New-site workflow**: adding a site to an existing atoll needs no bearing work. Adding a new atoll needs its rim polygon added, and the sanity test in 3.7 step 4 will fail until it is.
6. **UI trust marker**: surface `BearingSource`; render `fallback` arrows as low-trust.

**A2 result (implemented)**: `data/rims.json` holds the six OSM outlines; `lib/rim.ts` averages inward normals of rim segments within 1.5 km of the pin and only applies when the pin is within 0.8 km of the rim. Order is now override, then rim-derived, then the legacy heuristic (`resolveBearing`). Against the measured sites the rim normal was within ~12° for Kandooma, Rasdhoo, Miyaru, Kuredu and Devana. It would have regressed four previously-fine sites (Fotteyo 134°, Kuda Faru 60°, Hp Reef 51°, Embudhoo 28°), so those are pinned to their previous heuristic output (298, 155, 271, 216) and behave exactly as before. Internal thilas and pins more than 0.8 km from the rim stay on the heuristic (11 sites). Kuda Giri is still on the wrong heuristic value (357°) and needs a source. The seeded-data sanity test lives in `lib/rim.test.ts`; Fotteyo is exempt because the OSM outline is a thin spike at Vaavu's east tip. Still open: the UI trust marker for `BearingSource`, and removing the `?? 0` in `lib/nowcast.ts`.

---

## 4. Stage B: Monsoon Through-Flow Modeling (ON HOLD)

### 4.0 Entry Gates (all must hold before starting)
1. **Rim sign fixed and tested** (see 4.2). As originally written the coupling was inverted.
2. **Real drift input.** `getMaldivesMonsoonDrift` in `lib/seasonal.ts` is a hard-coded seasonal curve used only when Open-Meteo hourly current is missing. Calibrating on it means fitting to the calendar, not to an independent signal. Confirm the Open-Meteo current fields are populated and used before calibration; otherwise the "$V_{\text{ocean}} \ge 0.25$ m/s" filter selects almost every May–Oct and Dec–Mar report.
3. **Enough reports.** Count reports per rim class in `data/store.json` / `data/replay.json`. Three free parameters over ~500 grid points will overfit a small set. Set a minimum (e.g. ≥ 30 reports per rim class, with a held-out split) and do not start below it.
4. **Stage A merged**, so calibration runs on correct bearings.

### 4.1 Objective
Incorporate physical open-ocean current drift ($\vec{V}_{\text{ocean}}$) and atoll hydraulic head into the existing relative strength and direction pipeline, allowing strong monsoon flow to overpower weak tidal draw in leeward passes.

### 4.2 Integration with Existing Strength Pipeline (No Conflicting Velocity Systems)
Instead of introducing arbitrary absolute velocity thresholds ($0.1 / 0.5\text{ m/s}$), through-flow is expressed as an **equivalent tidal slope contribution** ($\Delta S_{\text{throughflow}}$ in meters of residual head per hour):

$$\Delta S_{\text{throughflow}} = \beta \cdot \frac{V_{\text{ocean}}}{V_{\text{sat}}} \cdot \left[ \cos(\theta_{\text{ocean}} - \theta_{\text{axis}}) + F_{\text{rim}}(\theta_{\text{ocean}}, \text{rimFacing}) \right] \cdot S_{\text{ref}}$$

Where:
- $S_{\text{ref}}$: **Primary Calibration Parameter** (nominal reference spring tidal slope in m/hr, initial search space $[0.02, 0.08]$).
- $V_{\text{sat}} \approx 0.75\text{ m/s}$ (saturation ocean current velocity).
- $\beta \in [0.1, 0.5]$ (empirical atoll transmission coefficient).
- **Atoll Rim Coupling Function ($F_{\text{rim}}$)**:
  $\theta_{\text{ocean}}$ is the direction the water is moving **toward** (the `seasonal.ts` convention: SW monsoon = $90^\circ$, eastward). Let $\theta_{\text{normal}}$ be the outward-facing rim normal ($0^\circ$ for `north`, $90^\circ$ for `east`, $180^\circ$ for `south`, $270^\circ$ for `west`).
  > **Sign correction**: the original draft treated a rim as windward when $\cos(\theta_{\text{ocean}} - \theta_{\text{normal}}) > 0$. With a "toward" heading that is backwards: eastward water moving past an east rim is leaving the atoll, and it piles up against the **west** rim (normal $270^\circ$, cos $= -1$). A windward rim is one whose outward normal points **against** the flow, i.e. $\cos(\theta_{\text{ocean}} - \theta_{\text{normal}}) < 0$. This also matches the Stage A nudge, where SW-monsoon drift opposes flood on the east-rim Vaavu passes.
  - Windward rim ($c = \cos(\theta_{\text{ocean}} - \theta_{\text{normal}}) < 0$): $F_{\text{rim}} = +|c|$ (pushes water into lagoon).
  - Leeward rim ($c \ge 0$): $F_{\text{rim}} = -\lambda \cdot c$ (hydraulic head forces water out).
  - Add a unit test with both monsoon headings on all four rim facings before any calibration.
  - Sheltered internal thilas (`rimFacing === "inside"`): $F_{\text{rim}} = 0$.
- Net Effective Slope: $S_{\text{net}} = S_{\text{tide}} + \Delta S_{\text{throughflow}}$.

**Direction & Strength Determination**:
- If $|S_{\text{net}}| < \text{SLACK\_SLOPE\_M}$ ($0.015\text{ m}$): Current is `slack`.
- If $S_{\text{net}} \ge \text{SLACK\_SLOPE\_M}$: Direction is `incoming` (heading $\theta_{\text{axis}}$).
- If $S_{\text{net}} \le -\text{SLACK\_SLOPE\_M}$: Direction is `outgoing` (heading $\theta_{\text{axis}} + 180^\circ$).
- Strength is determined by passing $|S_{\text{net}}|$ directly into the existing `hourlyStrength` function.

### 4.3 Concrete Calibration Methodology
To avoid ungrounded free constants:
1. **Calibration Dataset**: Extract all diver reports from `data/store.json` and `data/replay.json` that occurred during peak monsoon conditions ($V_{\text{ocean}} \ge 0.25\text{ m/s}$).
2. **Multi-Parameter Grid Search Procedure**:
   - Parameter sweep:
     - $\beta \in [0.05, 0.50]$ (step $0.05$)
     - Leeward attenuation $\lambda \in [0.3, 0.8]$ (step $0.1$)
     - Reference slope $S_{\text{ref}} \in [0.02, 0.08]$ (step $0.01\text{ m/hr}$)
   - Objective function: Maximize Directional Concordance Rate ($R_{\text{dir}} = \frac{\text{correct directions}}{\text{total reports}}$) while keeping Slack Timing Error within $\pm 45\text{ min}$.
3. **Rollback & Feature Flag Strategy**:
   - Add a configuration flag in [`lib/forecast.ts`](file:///D:/Gork/dive-current/lib/forecast.ts): `enableThroughflowReversal: boolean`.
   - If Stage B testing shows improved concordance in Vaavu/South Malé but regressions in Ari Atoll, the flag can be scoped per atoll (`enabledAtolls: string[]`).

### 4.4 Acceptance Bar for Stage B
- **Benchmark Gate**: Total directional accuracy across all report replays in `lib/replay.test.ts` must **not decrease** relative to Stage A.
- **Direction Flip Guardrail**: If through-flow reverses the tidal direction ($S_{\text{net}} \cdot S_{\text{tide}} < 0$), `confidenceFor` must cap confidence at `"medium"` unless $\ge 2$ concordant diver reports confirm the reversal.
- **Deliberate Test Retuning**: All existing test assertions that hardcoded `slope > 0 ==> incoming` must be updated intentionally to test the coupled through-flow contract.

---

## 5. Stage C: Empirical Diver Calibration & Local Quirks (Long-Term)

### 5.1 The Opposite Neighbor Challenge
Adjacent channels (e.g. Miyaru Kandu vs Devana Kandu) can experience opposite flows due to micro-bathymetry, reef crest wave pumping, or localized circulation eddies. No macro formula can reliably predict this without local empirical data.

### 5.2 The Strategy
1. Rely on boat crew reports collected via the in-app reporting form (`components/ReportForm.tsx`).
2. Use [`lib/reports.ts`](file:///D:/Gork/dive-current/lib/reports.ts) to fit pass-specific phase lags ($\Delta t$) and speed coupling coefficients ($\alpha_{\text{site}}$).
3. If reports consistently contradict the theoretical through-flow or tidal slope, automatically reduce the site's `Confidence` rating to `"low"` and display a notice rather than making high-confidence false predictions.

---

## 6. Execution Checklist

### Phase 1a: Stage A1 Execution (override + guardrail)
- [ ] Measure and verify the 7 channel centerline azimuths against satellite imagery.
- [ ] Add `inwardBearingDeg?: number` to `Site` and the `BearingSource` type to `lib/types.ts`. Defer `rimFacing` to Stage B.
- [ ] Update `lib/bearing.ts` to prioritize `site.inwardBearingDeg` while keeping centroid/ocean fallback for custom user sites; return the bearing source.
- [ ] Define the missing-bearing contract (3.4b); remove the `?? 0` in `lib/nowcast.ts`.
- [ ] Populate measured satellite azimuths in `data/sites.json` for the 7 discrepant sites.
- [ ] Add the seeded-data sanity test (3.7 step 4).
- [ ] Update `divesite_audit.md` §5 and §7 to reflect the reversed product rule.
- [ ] Verify `seawardPoint(site.lat, site.lon, inwardBearingDeg)` points into open ocean, and ensure test marine caches / fixtures provide coverage for the updated seaward coordinates.
- [ ] Add unit tests in `lib/bearing.test.ts`.
- [ ] Audit `monsoonNudge` impact on historical reports in `lib/replay.test.ts`, verifying Vaavu June–August reports.
- [ ] Verify `npm test` and `npm run build` pass 100%.

### Phase 1b: Stage A2 Execution (rim-derived default)
- [ ] Assess OSM rim polygon coverage for every atoll; fetch and store in-repo.
- [ ] Implement nearest-segment inward normal; add tests including an atoll with a single site.
- [ ] Compare against the audit table; keep overrides where the difference exceeds ~30°.
- [ ] Add the `BearingSource` UI trust marker.

### Phase 2: Stage B Preparation & Tuning (ON HOLD until 4.0 gates pass)
- [ ] Fix and unit-test the rim sign convention (4.2).
- [ ] Implement `enableThroughflowReversal` feature flag in `lib/forecast.ts`.
- [ ] Formulate through-flow in terms of equivalent tidal slope $\Delta S_{\text{throughflow}}$ (no parallel velocity systems).
- [ ] Execute multi-parameter grid search calibration for $(\beta, \lambda, S_{\text{ref}})$ across historical reports.
- [ ] Update `lib/forecast.ts` direction contract with the medium-confidence guardrail.
- [ ] Retune vitest test suites to encode the new coupled contract.
