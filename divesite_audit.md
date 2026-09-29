# Dive Site Location & Current Direction Audit

**Date**: 2026-09-27  
**Repository**: `CyberoniOntoni/dive-forecast` / `dive-current`  
**Dataset**: `data/sites.json`  
**Engine**: `lib/bearing.ts` (`inwardBearingDeg`)

> **Status (2026-09-29): acted on.** The findings below were correct, and the product rules in §5 were reversed. Sites can now store a measured `inwardBearingDeg`, the default comes from the atoll outline, and the old centroid heuristic is the last fallback. What was done and what is still open is in §5 to §7 and in `HYDRODYNAMICS_PLAN.md`. §1 to §4 are kept as the record of the original audit; the "Physical Flow" column in §3 was an eyeballed estimate, not a measurement.

---

## 1. Executive Summary

This audit evaluated all 25 dive sites across the 7 atolls cataloged in `data/sites.json` against satellite bathymetry, nautical charts, OpenStreetMap reef data, and published dive guides.

- **Coordinates & Site Placement**: **100% Correct**. All 25 pins are precisely positioned on their actual reef cuts, pinnacles (thilas), or channel mouths. Depth profiles ($W \times D$) are accurate.
- **Current Direction Calculation (`inwardBearingDeg`)**: **7 Critical Discrepancies Found**. While 18 sites have accurate or reasonable inward headings, 7 key sites have severely distorted inward headings (from 60° to 145° off true physical flow) due to the centroid/fallback heuristic in `lib/bearing.ts`.

---

## 2. Root Cause Analysis: How `inwardBearingDeg` Fails

In `dive-current`, an **"incoming"** current represents ocean water flooding from the open sea through an atoll pass into the inner lagoon, while an **"outgoing"** current represents ebb water draining out to sea.

In `lib/bearing.ts`, `inwardBearingDeg(site, mates, outside)` calculates the incoming flow direction using two heuristics:
1. **Centroid of Mates ($\ge 2$ sites on atoll)**:
   ```typescript
   const center = centroid(seeded);
   return bearingClockwiseFromNorth(site.lat, site.lon, center.lat, center.lon);
   ```
   **Flaw**: This assumes the average lat/lon of *other dive sites* represents the *center of the atoll lagoon*. In practice, dive sites cluster along popular outer tourist reef margins (e.g. east rims) rather than encircling the atoll. The centroid of other sites pulls the bearing along the reef or back out to sea, rather than into the lagoon.
2. **Fallback to `outside` (< 2 sites on atoll)**:
   ```typescript
   return bearingClockwiseFromNorth(outside.lat, outside.lon, site.lat, site.lon);
   ```
   **Flaw**: The `outside` coordinates (`oceanLat`, `oceanLon`) in `data/sites.json` represent a single arbitrary marine sampling point for the entire atoll (often tens of kilometers away in the wrong quadrant). For a single site on a different rim, the vector from `outside` to `site` points *out into open ocean*, completely inverting the inward direction.

---

## 3. Comprehensive Site-by-Site Audit Table

| Site ID | Atoll | Latitude, Longitude | Current Calculated Bearing | Physical Flow into Lagoon | Discrepancy | Status & Impact |
|---|---|---|---|---|---|---|
| `kuredu-express` | Lhaviyani | `5.5585, 73.4781` | **317° (NW)** | **~170° (South)** | **147°** | ❌ **Inverted**: Points outward into open sea instead of south into Lhaviyani lagoon. |
| `miyaru-kandu` | Vaavu | `3.5996, 73.5042` | **126° (SE)** | **~230° (SW)** | **104°** | ❌ **Opposite**: Centroid pulled east by Fotteyo; points toward ocean rather than SW into lagoon. |
| `devana-kandu` | Vaavu | `3.5841, 73.5002` | **110° (ESE)** | **~230° (SW)** | **120°** | ❌ **Opposite**: Points ESE toward ocean rather than SW into lagoon. |
| `alimatha-house-reef` | Vaavu | `3.5938, 73.4980` | **118° (ESE)** | **~220° (SW)** | **102°** | ❌ **Opposite**: Points ESE toward ocean rather than SW into lagoon. |
| `rasdhoo-madivaru` | Rasdhoo | `4.2656, 73.0003` | **222° (SW)** | **~335° (NNW)** | **113°** | ❌ **Distorted**: Points SW into the deep sea passage to Ari instead of NNW into Rasdhoo lagoon. |
| `kandooma-thila` | South Malé | `3.9075, 73.4781` | **5° (North)** | **~280° (West)** | **85°** | ❌ **Skewed**: Points north along outer reef because all other sites are north of it; true flow is west through Cocoa Pass. |
| `kuda-giri` | South Malé | `3.9732, 73.4909` | **357° (North)** | **~265° (West)** | **92°** | ❌ **Skewed**: Points north along rim instead of west into South Malé lagoon. |
| `fotteyo-kandu` | Vaavu | `3.4877, 73.6981` | **298° (WNW)** | **~285° (WNW)** | 13° | ✅ **Accurate**: Cuts cleanly west into the eastern tip of Vaavu lagoon. |
| `banana-reef` | North Malé | `4.2342, 73.5340` | **337° (NNW)** | **~340° (NNW)** | 3° | ✅ **Accurate**: Points into North Malé lagoon basin. |
| `embudhoo-express` | South Malé | `4.0879, 73.5347` | **216° (SW)** | **~225° (SW)** | 9° | ✅ **Accurate**: Channel cuts southwest into South Malé lagoon. |
| `hp-reef` | North Malé | `4.3136, 73.5786` | **271° (West)** | **~275° (West)** | 4° | ✅ **Accurate**: Channel cuts west through Himmafushi pass. |
| `manta-point-lankanfinolhu` | North Malé | `4.2799, 73.5572` | **301° (WNW)** | **~300° (WNW)** | 1° | ✅ **Accurate**: Points into North Malé lagoon. |
| `nassimo-thila` | North Malé | `4.2852, 73.5366` | **308° (NW)** | **~320° (NW)** | 12° | ✅ **Accurate**: Aligns with North Malé lagoon inward flow. |
| `kuda-faru` | North Malé | `4.5671, 73.3794` | **155° (SSE)** | **~160° (SSE)** | 5° | ✅ **Accurate**: Sits on north rim; points south into the lagoon. |
| `kuda-haa` | North Malé | `4.2090, 73.4077` | **41° (NE)** | **~30° (NNE)** | 11° | ✅ **Accurate**: Sits in southwest lagoon opening; points NNE into lagoon. |
| `fish-head` | North Ari | `3.9360, 72.9131` | **307° (NW)** | **~315° (NW)** | 8° | ✅ **Accurate**: Internal thila; flow aligns with main basin axis. |
| `maaya-thila` | North Ari | `4.0914, 72.8620` | **200° (SSW)** | **~210° (SSW)** | 10° | ✅ **Accurate**: Internal thila; flow aligns with main basin axis. |
| `fesdhoo` / `fesdu-wreck` | North Ari | `3.9994, 72.7860` | **90° (East)** | **~75° (ENE)** | 15° | ✅ **Accurate**: Sits on western rim; flood tide pushes eastward into lagoon. |
| `himandhoo-thila` | North Ari | `3.9148, 72.7176` | **53° (NE)** | **~50° (NE)** | 3° | ✅ **Accurate**: Sits on southwest edge of North Ari; points northeast into lagoon. |
| `halaveli-wreck` | North Ari | `4.0546, 72.9108` | **236° (SW)** | **~250° (WSW)** | 14° | ✅ **Accurate**: Aligns with basin tidal exchange. |
| `kudarah-thila` | South Ari | `3.5588, 72.9230` | **280° (West)** | **~300° (WNW)** | 20° | ✅ **Acceptable**: Sits near southeast rim; flood tide draws west into lagoon. |
| `broken-rock` | South Ari | `3.5562, 72.9369` | **280° (West)** | **~300° (WNW)** | 20° | ✅ **Acceptable**: Same pass area as Kudarah Thila; flood tide draws west into lagoon. |
| `rangali-madivaru` | South Ari | `3.5955, 72.7189` | **100° (East)** | **~85° (East)** | 15° | ✅ **Accurate**: Sits on western rim of South Ari; flood tide pushes eastward into lagoon. |
| `vaadhoo-caves` | South Malé | `4.1221, 73.4485` | **158° (SSE)** | **~170° (South)** | 12° | ✅ **Accurate**: Sits on north edge along Vaadhoo Kandu; flood pushes south into South Malé. |

---

## 4. Deep-Dive on Discrepant Sites

### 1. Kuredu Express (`kuredu-express`)
- **Geographic Reality**: Located in the channel on the **North rim** of Lhaviyani (Faadhippolhu) Atoll. The open ocean is to the North, and the sheltered lagoon is to the South.
- **True Inward Direction**: **~170° (South / SSE)**.
- **Current Calculation**: **317° (Northwest)**.
- **Why It Fails**: It is the only site in Lhaviyani in `sites.json`. The fallback `oceanLat`/`oceanLon` is placed at `5.32556, 73.69423` (the southeast ocean corner of the atoll). The vector from that corner to Kuredu points northwest out to sea.
- **Result**: The app currently displays incoming flood currents as pointing *out into the open Indian Ocean*.

### 2. Miyaru Kandu & Devana Kandu (`miyaru-kandu`, `devana-kandu`, `alimatha-house-reef`)
- **Geographic Reality**: These passes sit along the **Northeast perimeter** of Vaavu (Felidhoo) Atoll. Open ocean is to the Northeast; the deep lagoon is to the Southwest.
- **True Inward Direction**: **~220°–240° (Southwest)**.
- **Current Calculation**: **110°–126° (East-Southeast)**.
- **Why It Fails**: Vaavu has four sites. Three are clustered together on the northeast rim (Miyaru, Devana, Alimatha), while the fourth is `fotteyo-kandu` at the extreme eastern tip of Maldives (`73.6981°E`). For Miyaru and Devana, the centroid of their mates is dominated by Fotteyo's eastern longitude, pulling the inward vector toward the East-Southeast (pointing back out toward open water).
- **Result**: Divers heading out on incoming current are shown arrows pointing back toward open sea rather than through the pass into the lagoon.

### 3. Kandooma Thila (`kandooma-thila`) & Kuda Giri (`kuda-giri`)
- **Geographic Reality**: Kandooma Thila sits inside Cocoa / Kandooma Channel on the **East rim** of South Malé Atoll. Open ocean is to the East (`73.50°E+`), and the lagoon is to the West (`73.40°E`).
- **True Inward Direction**: **~275°–290° (West / WNW)**.
- **Current Calculation**: **5° (North)**.
- **Why It Fails**: All other seeded South Malé sites (`kuda-giri` at 3.97°N, `embudhoo-express` at 4.09°N, `vaadhoo-caves` at 4.12°N) are located to the **North** of Kandooma (3.91°N). Their centroid is at 4.06°N, resulting in a northward vector (5°) along the barrier reef instead of through the channel.
- **Result**: Flood current is shown traveling north along the reef line rather than through the pass.

### 4. Rasdhoo Madivaru (`rasdhoo-madivaru`)
- **Geographic Reality**: Rasdhoo is a small, nearly circular atoll ~8 km across. Madivaru sits at the **Southeast corner** of the atoll rim. The lagoon center lies to the North-Northwest.
- **True Inward Direction**: **~330°–345° (NNW)**.
- **Current Calculation**: **222° (Southwest)**.
- **Why It Fails**: As the only site in Rasdhoo, it falls back to the atoll `oceanLat`/`oceanLon` at `4.3153, 73.0453` (northeast in open water). The bearing from that ocean point to Madivaru points southwest out into the deep channel between Rasdhoo and North Ari Atoll.
- **Result**: Incoming tide is shown pointing away from Rasdhoo Atoll.

---

## 5. Product Rules (revised)

The audit was written against three locked rules. Two of them have changed.

| Original rule | Now |
|---|---|
| The centroid of seeded mates, or `outside → pin`, is the proxy for inward direction. | Still the **last** fallback, used only for a pin that is neither overridden nor within 0.8 km of its atoll outline. It stays wrong for the first site in an atoll and for anything on a different rim from its neighbors. |
| No stored per-site or per-atoll bearings, and no artificial lagoon centers. | **Reversed.** A site may carry a measured `inwardBearingDeg` (an override). Atoll outlines from OpenStreetMap are stored in `data/rims.json` and give a rim-derived default. |
| The known skews are accepted consequences of the lightweight heuristic. | **Reversed.** They were fixed for the sites that matter, and a test now fails if any seeded site's inward bearing does not point into its atoll outline. |

Bearing resolution order (`resolveBearing` in `lib/bearing.ts`): override, then rim-derived, then the heuristic. Each result carries its source, and the app draws a fallback heading as an outlined arrow with an estimate note.

## 6. Options Evaluated

- **Option A, explicit `inwardBearingDeg` in `data/sites.json`: implemented.** 11 sites have one: the 7 discrepant sites (Kuda Giri's is a low-trust estimate), plus Fotteyo, Embudhoo, Hp Reef and Kuda Faru, which are pinned to their previous heuristic output because a rim normal would have moved them by 28 to 134 degrees.
- **Option B, per-atoll lagoon centroids: not built.** The rim-derived default replaced it. It needs no hand-entered coordinates and handles a first site in a new atoll.

## 7. Outcome

- **Site coordinates:** unchanged and still correct.
- **The 7 discrepant sites:** six measured on Esri World Imagery (about ±15 degrees) and stored. The audit was off for Vaavu: its three passes run roughly east-west (280, 250, 250), not southwest (230, 230, 220). The seventh, Kuda Giri, has no pass, so it carries a low-trust estimate of 285.
- **Ten sites** (internal thilas and pins more than 0.8 km from the outline) are still on the heuristic and show outlined arrows. The audit rated most of them accurate to within about 15 degrees, but none has been measured.
- **Effect on the forecast:** direction is unchanged, since it comes from the tide slope. The corrected bearings change the monsoon nudge (strength) and the 3 km seaward sample point. The Vaavu strength check is logged in `HYDRODYNAMICS_PLAN.md` §3.9.
- **Still open:** measuring the remaining heuristic sites, and the Stage B monsoon through-flow work, which is on hold in the plan.
