# Hydrodynamics & Channel Physics Implementation Plan

**Target System**: `CyberoniOntoni/dive-forecast` / `dive-current`  
**Purpose**: Rigorous, phased engineering specification to upgrade the forecast engine from an uncoupled tidal breather heuristic to an oceanographically grounded channel pass model. Aligns geometric channel axes, accounts for monsoon-driven through-flow, eliminates speculative parallel physics, and grounds predictions in empirical diver calibration.


> **Status (2026-09-29):** Stages A1 and A2 are shipped, merged, and deployed. Stage B is on hold (its gates are in 4.0). Stage C needs diver reports that do not exist yet: the reports in `data/benchmark-reports.json` are curated fixtures, so the project has no ground truth. Section 3.9 is the findings log; section 6 is the checklist.
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
| **Stage A1** | **Explicit Override + Guardrail Test.** Done. | Optional `inwardBearingDeg` on `Site`, preferred by `lib/bearing.ts`. Populate the 7 known-bad sites with measured values. Add a seeded-data sanity test so a bad bearing on any current or future site fails CI. Maintain the existing direction contract (slope = direction; ocean = nudge). | **~0.5 – 1 day** (plus measurement time) |
| **Stage A2** | **Rim-Derived Default (scales to new sites).** Done. | Replace the mate-centroid / `outside → pin` default with the normal to the nearest atoll rim segment, pointing into the lagoon. Needed because more sites, and new atolls, are coming. | **~1 – 2 days** (depends on rim data quality) |
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
In [`lib/forecast.ts`](lib/forecast.ts), `monsoonNudge` calculates:
```typescript
const inward = monsoonInwardFlux(drift, inwardBearingDeg);
return Math.max(-1, Math.min(1, inward / NUDGE_SATURATION_MS));
```
Because this uses $\cos(\theta_{\text{drift}} - \theta_{\text{inward}})$, changing `inwardBearingDeg` will immediately alter the nudge value for those 7 sites:
- **Kuredu Express** ($317^\circ \to 170^\circ$): Under SW Monsoon (drift $90^\circ$), previously $\cos(90^\circ - 317^\circ) = \cos(-227^\circ) = -0.68$ (negative nudge, weakening incoming). Now $\cos(90^\circ - 170^\circ) = \cos(-80^\circ) = +0.17$ (near zero/neutral cross-flow).
- **Vaavu Passes (CRITICAL RISK TARGET)** ($110^\circ\text{–}126^\circ \to 220^\circ\text{–}230^\circ$): Under SW Monsoon ($90^\circ$), previously $\cos(90^\circ - 120^\circ) = +0.86$ (falsely boosting flood). Now $\cos(90^\circ - 230^\circ) = -0.76$ (correctly opposing flood into the lagoon).
  > [!WARNING]
  > The Vaavu passes experience a full sign reversal on their strength nudge ($+0.86 \to -0.76$). During peak SW monsoon (June–August), this is large enough to shift strength by a full band (e.g., from `strong` to `mild`). All historical reports for Vaavu during June–August were to be checked against this shift before merging Stage A. No June–August Vaavu reports exist; the September check is in 3.9. The measured Vaavu bearings are 250° to 280°, so the real nudge is about −0.94 to −0.98, not −0.76.

### 3.4 Coupling Impact on Open-Meteo Sampling Point (`seawardPoint`)
In [`lib/marine.ts`](lib/marine.ts), the marine data sampling coordinates are calculated via `seawardPoint(site.lat, site.lon, inwardBearingDeg)`:
```typescript
const outwardBearing = ((inwardBearingDeg + 180) % 360 + 360) % 360;
return destinationKm(lat, lon, outwardBearing, 3.0); // 3 km seaward
```
**Critical Architecture Insight**:
- For a site whose inward bearing is inverted (e.g. Kuredu Express from $317^\circ$ to $170^\circ$), its outward bearing changes from $137^\circ$ (Southeast into the atoll lagoon) to $350^\circ$ (North into open ocean).
- Previously, the app was sampling marine data **inside the lagoon** because the outward vector pointed backwards! Correcting `inwardBearingDeg` now correctly places the 3 km sample point in open ocean.
- **Cache Invalidation**: Because `data/marine-cache` keys files by `lat_lon.json`, fixing the bearing will query a new coordinate. Offline test suites that mock or cache marine hours must be checked to ensure test fixtures provide coverage for the new seaward points.

### 3.4b Missing-Bearing Contract
Implemented. A site resolves in order: override, rim-derived, heuristic (`resolveBearing` in `lib/bearing.ts`), and each result carries its `BearingSource`. A heuristic heading is drawn as an outlined arrow with "heading estimated" in the tooltip and an estimate note on the site page. A pin with no atoll (an app-added pin more than 5 km from every stored outline gets `atollId: "unseeded"`) has no bearing, no forecast, and no arrow; `SiteNowcast.inwardBearingDeg` is `number | null` and the old `?? 0` is gone.

### 3.5 Data Schema Changes
In [`lib/types.ts`](lib/types.ts):
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

### 3.6 Seeded Sites Geometry Table
What each seeded site resolves to today (`npm run bearings` prints the same). **Bearing** is the heading of water entering the lagoon, degrees clockwise from north. **Source** is the `BearingSource`: `override` is stored in `data/sites.json`, `rim-derived` comes from the atoll outline, `heuristic` is the old centroid fallback and is drawn as an outlined arrow. **Audit estimate** is the eyeballed figure from `divesite_audit.md`, kept for comparison only. `rimFacing` is not used by the code yet; it is kept for Stage B.

| Site ID | Atoll | Bearing | Source | Audit estimate | `rimFacing` | Basis |
|---|---|---|---|---|---|---|
| `kuredu-express` | Lhaviyani | **165°** | override | 170° | `north` | Measured on Esri imagery, ±15°. N→S pass between two reefs. |
| `miyaru-kandu` | Vaavu | **280°** | override | 230° | `east` | Measured, ±15°. Northernmost of the three Vaavu passes, runs W-WNW. |
| `devana-kandu` | Vaavu | **250°** | override | 230° | `east` | Measured, ±15°. Pin is on the reef flat between two passes; both read ~250°. |
| `alimatha-house-reef` | Vaavu | **250°** | override | 220° | `east` | Measured, ±15°. Pass south of the island. |
| `fotteyo-kandu` | Vaavu | **298°** | override | 285° | `east` | Pinned to the old heuristic output. A rim normal would move it 134°; the OSM outline is a thin spike at Vaavu's east tip. |
| `kandooma-thila` | South Malé | **285°** | override | 280° | `east` | Measured, ±15°, from the gap between the two reefs at low zoom. |
| `kuda-giri` | South Malé | **285°** | override | 265° | `east` | Estimate, low trust. Open lagoon water 1.9 km inside the east rim, no pass; this is the rim's inward direction. |
| `embudhoo-express` | South Malé | **216°** | override | 225° | `east` | Pinned to the old heuristic output (a rim normal would move it 28°). |
| `vaadhoo-caves` | South Malé | **171°** | rim-derived | 170° | `north` | Rim-derived. |
| `rasdhoo-madivaru` | Rasdhoo | **330°** | override | 335° | `south` | Measured, ±15°, at the reef tip and island gap. |
| `hp-reef` | North Malé | **271°** | override | 275° | `east` | Pinned to the old heuristic output (a rim normal would move it 51°). |
| `banana-reef` | North Malé | **337°** | heuristic | 340° | `east` | Heuristic. Open lagoon water 1.8 to 2.3 km inside the North Malé east rim; no pass to measure. |
| `manta-point-lankanfinolhu` | North Malé | **292°** | rim-derived | 300° | `east` | Rim-derived. |
| `nassimo-thila` | North Malé | **308°** | heuristic | 320° | `east` | Heuristic. Open lagoon water 1.8 to 2.3 km inside the North Malé east rim; no pass to measure. |
| `kuda-faru` | North Malé | **155°** | override | 160° | `north` | Pinned to the old heuristic output (a rim normal would move it 60°). |
| `kuda-haa` | North Malé | **41°** | heuristic | 30° | `west` | Heuristic. Open lagoon water 1.8 to 2.3 km inside the North Malé east rim; no pass to measure. |
| `fish-head` | North Ari | **307°** | heuristic | 315° | `inside` | Heuristic. Patch reef or thila in the middle of Ari's lagoon; no pass to measure. |
| `maaya-thila` | North Ari | **200°** | heuristic | 210° | `inside` | Heuristic. Patch reef or thila in the middle of Ari's lagoon; no pass to measure. |
| `fesdhoo` | North Ari | **90°** | heuristic | 75° | `west` | Heuristic. Patch reef or thila in the middle of Ari's lagoon; no pass to measure. |
| `fesdu-wreck` | North Ari | **90°** | heuristic | 75° | `west` | Heuristic. Patch reef or thila in the middle of Ari's lagoon; no pass to measure. |
| `himandhoo-thila` | North Ari | **90°** | override | 50° | `west` | Measured, ±15°. West-to-east gap between two reefs, ocean to the west. |
| `halaveli-wreck` | North Ari | **236°** | heuristic | 250° | `inside` | Heuristic. Patch reef or thila in the middle of Ari's lagoon; no pass to measure. |
| `kudarah-thila` | South Ari | **280°** | heuristic | 300° | `east` | Heuristic. Deep open water at a channel mouth; no pass to measure. |
| `broken-rock` | South Ari | **294°** | rim-derived | 300° | `east` | Rim-derived. Canyon in the Dhigurah pass. |
| `rangali-madivaru` | South Ari | **92°** | rim-derived | 85° | `west` | Rim-derived. |

Summary: 12 overrides (7 measured, 1 low-trust estimate, 4 pinned), 4 rim-derived, 9 heuristic. Measured values are read by eye from Esri World Imagery, so treat them as ±15°. The nine heuristic sites have no channel axis to measure; see 3.9.

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

**A2 result (implemented)**: `data/rims.json` holds the six OSM outlines; `lib/rim.ts` averages inward normals of rim segments within 1.5 km of the pin and only applies when the pin is within 0.8 km of the rim. Order is now override, then rim-derived, then the legacy heuristic (`resolveBearing`). Against the measured sites the rim normal was within ~12° for Kandooma, Rasdhoo, Miyaru, Kuredu and Devana. It would have regressed four previously-fine sites (Fotteyo 134°, Kuda Faru 60°, Hp Reef 51°, Embudhoo 28°), so those are pinned to their previous heuristic output (298, 155, 271, 216) and behave exactly as before. Internal thilas and pins more than 0.8 km from the rim stay on the heuristic (11 sites). Kuda Giri was on the wrong heuristic value (357°) and now has an estimated override (see the 3.6 table). The seeded-data sanity test lives in `lib/rim.test.ts`; Fotteyo is exempt because the OSM outline is a thin spike at Vaavu's east tip. Still open: the UI trust marker for `BearingSource`, and removing the `?? 0` in `lib/nowcast.ts`.

---

### 3.9 Findings Log

- **Remaining fallback sites (2026-09-29)**: imagery review of the ten sites still on the heuristic found one real pass, Himandhoo Thila (now an override, 90°). The other nine have no channel axis to measure. Banana Reef, Nassimo Thila and Kuda Haa are in open lagoon water 1.8 to 2.3 km inside the North Malé east rim. Fish Head, Maaya Thila, Halaveli Wreck, Fesdhoo and Fesdu Wreck are patch reefs and thilas in the middle of Ari's lagoon. Kudarah Thila is in deep open water at a channel mouth. For these, "inward" is only the direction the atoll edge faces the lagoon, which feeds the arrow heading, the nudge sign and the seaward sample point. They stay on the heuristic with outlined arrows rather than getting numbers that look measured. The audit's ~15 degree accuracy claim for them still stands as an estimate. If one matters, a diver's knowledge of the flow beats imagery.
- **Benchmark reports are fixtures, not observations (2026-09-29, retracts the entry below).** `data/benchmark-reports.json` holds 51 curated scenarios (`scenarioId: SC-CANON-FLOOD`, canned notes such as "hammerhead point"); `PROJECT.md` calls it a "Benchmark Fixture Dataset". The live store has 0 real reports. So there is no ground truth for direction, strength, timing, or confidence. The "91% directional accuracy" only shows the model reproduces the curated scenarios (direction is "rising tide means incoming", and the scenarios agree with it). Nothing scored against these files, including the Vaavu comparison below, is evidence about forecast quality.
- **Ocean-current investigation (2026-09-29).** Sources and a 60-day analysis (Aug to Sep 2026, all 25 sample points, using the repo's own model code):
  - *What the variable is.* Open-Meteo's docs say `ocean_current_*` considers "Eulerian, Waves and Tides" on a 0.08 degree (about 8 km) grid, hourly, from Meteo-France SMOC. SMOC's total current is the ocean-model current plus Stokes drift plus tidal currents from FES2014. Rasheed et al. 2021 (Ocean Science 17, 319) find currents in deeper Maldivian waters mainly tide-driven, above 2 m/s in channels and rim gaps.
  - *Sea level* is almost pure tide: five constituents (M2, S2, N2, K1, O1) explain 94 to 95% of its variance at every point.
  - *The current* is very unevenly tidal. The tide explains 93% of the east-west current at the Vaavu cell and Embudhoo (M2 semi-major 0.40 to 0.48 m/s) and only 3 to 10% at Himandhoo, Kuredu and Banana Reef, where the tidal current is tiny.
  - *A real monsoon drift exists in the residual.* The 25-hour mean of the current points east (within 45 degrees) 74% of the time, matching the SW monsoon, but its median speed is about 0.17 m/s, roughly half of the seasonal curve's 0.35 to 0.43 m/s. The curve in `lib/seasonal.ts` is only a fallback for hours with no API value, so it does not run in normal operation.
  - *The deployed nudge mostly is not drift.* It projects the hourly total current, tide included, onto the inward bearing. That component is unrelated to the tide slope at zero lag (correlation averages -0.07, signs agree 48% of the time) and about -0.5 at strongly tidal cells. Effect on strength versus the nudge off, share of non-slack hours moved up / down: as deployed 8% / 12%; drift only (tide removed) 4% / 8%; the seasonal curve 27% / 40%. At the Vaavu trio the deployed nudge moves 33 to 36% of hours down and 5 to 9% up, which is a tide-phase artifact that weakens both flood and ebb.
  - *The data is coarser than the bearing work assumed.* Each request snaps to a 1/12 degree cell whose centre averages 3.5 km from the requested point, so the "3 km seaward" offset is smaller than the grid. 25 sites use 20 cells. Miyaru, Devana and Alimatha get identical series, so the model cannot separate their tide phases. The bearing fixes changed the data cell for 7 of 25 sites only.
  - *Not established.* Whether the nudge helps or hurts (no ground truth). The NE monsoon (data is Aug to Sep only). How an 8 km cell relates to a pass a few hundred metres wide. All correlations are at the cell, not in the pass.
  - *Decision (2026-09-29):* the strength nudge now uses the tide-removed drift, the 25-hour vector mean of the current (`currentForNudge` in `lib/forecast.ts`), instead of the hourly total current. Over the same 60 days and 25 sites it moves 4% of non-slack hours up and 8% down versus the nudge off, against 8% and 12% before. `NUDGE_SOURCE` (`"drift"` or `"off"`) is a one-line switch; `"off"` changes 0% of hours and would need four nudge-asserting tests updated. This is a hypothesis, not a validated improvement: with no real reports there is nothing to score it against. Revisit when real reports exist, and compare drift, off, and the old hourly current on them.
- **Vaavu monsoon-nudge check (2026-09-29). RETRACTED, see the first entry above.** Kept for the record of what was done. It compared model strength for the Vaavu passes under the old and new bearings against the curated benchmark scenarios, and it described the nudge as driven by the SW-monsoon curve. Both were wrong: the scenarios are not observations, and the nudge is fed by the hourly API current (tide included), not the curve. What still stands: moving Miyaru from 126 to 280 degrees and Alimatha from 118 to 250 degrees changes no direction (the nudge never flips direction), and lowers modelled incoming strength by one to two bands under the hourly current.

## 4. Stage B: Monsoon Through-Flow Modeling (ON HOLD)

### 4.0 Entry Gates (all must hold before starting)
1. **Rim sign fixed and tested** (see 4.2). As originally written the coupling was inverted. *Status: text corrected, no code or test yet.*
2. **Real drift input.** `getMaldivesMonsoonDrift` in `lib/seasonal.ts` is a hard-coded seasonal curve used only when Open-Meteo hourly current is missing. Calibrating on it means fitting to the calendar, not to an independent signal. Confirm the Open-Meteo current fields are populated and used before calibration; otherwise the "$V_{\text{ocean}} \ge 0.25$ m/s" filter selects almost every May–Oct and Dec–Mar report. *Status: not met. The API value is a total current (ocean model plus Stokes drift plus FES2014 tide), so it is not a drift signal as it stands. A drift can be recovered by taking the 25-hour mean, which shows an eastward monsoon signal of about 0.17 m/s, half the curve's speed (see 3.9). Untested: reliability inside passes, and the NE monsoon.*
3. **Enough reports.** Count reports per rim class in `data/store.json` / `data/replay.json`. Three free parameters over ~500 grid points will overfit a small set. Set a minimum (e.g. ≥ 30 reports per rim class, with a held-out split) and do not start below it. *Status: not met at all. The live store has 0 real reports. The 51 in `data/benchmark-reports.json` are curated fixtures, not observations (see 3.9).*
4. **Stage A merged**, so calibration runs on correct bearings. *Status: met.*

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
   - Add a configuration flag in [`lib/forecast.ts`](lib/forecast.ts): `enableThroughflowReversal: boolean`.
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
1. Rely on boat crew reports collected via the in-app reporting form (`components/ReportForm.tsx`), stored by `lib/store.ts` in `data/store.json`.
2. The forecast already fits a per-site phase lag (`fitPhaseOffset`) and speed factor (`fitSpeedFactor`) from reports in `lib/forecast.ts`, and `lib/replay.ts` scores them. Stage C extends those fits, for example a per-site coupling coefficient $\alpha_{\text{site}}$, once there are enough reports to fit them.
3. `confidenceFor` already lowers confidence when reports contradict the forecast. If reports consistently contradict the tidal slope or the through-flow, show a notice rather than a confident false prediction.

---

## 6. Execution Checklist

### Phase 1a: Stage A1 Execution (override + guardrail)
- [x] Measure the 7 channel centerline azimuths against satellite imagery. Six measured, Kuda Giri is a low-trust estimate (no pass); Himandhoo later measured.
- [x] Add `inwardBearingDeg?: number` to `Site` and the `BearingSource` type to `lib/types.ts`. `rimFacing` deferred to Stage B.
- [x] Update `lib/bearing.ts` to prioritize `site.inwardBearingDeg` while keeping centroid/ocean fallback; return the bearing source.
- [x] Define the missing-bearing contract (3.4b); remove the `?? 0` in `lib/nowcast.ts`.
- [x] Populate azimuths in `data/sites.json` for the 7 discrepant sites (plus Himandhoo, and 4 pinned sites).
- [x] Add the seeded-data sanity test (3.7 step 4), in `lib/rim.test.ts`.
- [x] Update `divesite_audit.md` §5 and §7 to reflect the reversed product rule.
- [x] Verify `seawardPoint(...)` points into open ocean (`npm run bearings`), and add benchmark fixtures for the moved sample points.
- [x] Add unit tests in `lib/bearing.test.ts`.
- [ ] Audit `monsoonNudge` impact on historical reports, verifying Vaavu June–August reports. *Not done. No June–August reports exist, and the September comparison against the benchmark file was invalid because those are fixtures (see 3.9). Reopen when real summer reports arrive.*
- [x] Verify `npm test` and `npm run build` pass 100%. CI runs both on every PR.

### Phase 1b: Stage A2 Execution (rim-derived default)
- [x] Assess OSM rim polygon coverage for every atoll; fetch and store in-repo (`data/rims.json`).
- [x] Implement the rim-segment inward normal (smoothed over 1.5 km, applied within 0.8 km of the rim); add tests including an atoll with a single site.
- [x] Compare against the audit table; keep overrides where the difference exceeds ~30° (four pinned sites).
- [x] Add the `BearingSource` UI trust marker (outlined arrows and estimate note).

### Also done (outside the original plan)
- [x] The strength nudge is fed the tide-removed drift instead of the hourly total current (see 3.9).
- [x] App-added pins are matched to an atoll by distance to the stored outlines; outside 5 km they become `unseeded` (no forecast, no arrow).
- [x] Tests are hermetic: a throwaway marine cache directory per test file and no network. Benchmark mode reads only the committed fixtures.
- [x] `ADDING_SITES.md` checklist and `npm run bearings`.
- [x] OpenStreetMap credit in the footer.

### Phase 2: Stage B Preparation & Tuning (ON HOLD until 4.0 gates pass)
- [ ] Fix and unit-test the rim sign convention (4.2).
- [ ] Implement `enableThroughflowReversal` feature flag in `lib/forecast.ts`.
- [ ] Formulate through-flow in terms of equivalent tidal slope $\Delta S_{\text{throughflow}}$ (no parallel velocity systems).
- [ ] Execute multi-parameter grid search calibration for $(\beta, \lambda, S_{\text{ref}})$ across historical reports.
- [ ] Update `lib/forecast.ts` direction contract with the medium-confidence guardrail.
- [ ] Retune vitest test suites to encode the new coupled contract.
