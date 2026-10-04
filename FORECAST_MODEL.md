# Forecast model

How the current forecast works today: model version `tide+throughflow+head+alongreef+lagoon+strait/16`. This is the reference for what the code does. `HYDRODYNAMICS_PLAN.md` holds the reasoning, the calibration runs and the history behind each choice (§4.5–4.10), and `ROADMAP.md` holds what is planned.

Nothing here is fitted to real dive observations yet. The constants were set from the ocean model's own data and the owner's experience of how Maldivian channels run. Diver reports are saved with the prediction they were made against so they can correct it later (see "Reports and scoring").

## The data

For every point it needs, the app fetches hourly **sea level** and **ocean current** from the Open-Meteo marine API (`lib/marine.ts`). The current is Mercator SMOC: ocean model drift, Stokes drift and the FES2014 tide, on a grid of about 8 km.

- **Window:** one past day and seven forecast days. The last 12 hours have no 25-hour mean, so the slider shows about six and a half days ahead.
- **Cache:** `data/marine-cache/`, one file per point, keyed by coordinates. A cached series is served at once. If it is older than 6 hours, a refresh runs in the background. A failed fetch keeps the old series, and the page shows its age. At most 4 requests run at once, and the map never waits for a point it has not fetched yet (`{ wait: false }`).
- **Where a site samples:** seaward of the pin, opposite its inward bearing (`seawardPoint`). The usual distance is 3 km. GEBCO 2026 (`data/seaward-floor.json`) checks the cell under that point. Open water is an elevation of −50 m or deeper. A shallower cell, including land, steps out to the first open cell at 6, 9, 12, or 15 km. If none of those is open, the sample stays at 3 km. The 15-arc-second grid is not a channel cross-section. Its type-identifier value is stored so a gravity-predicted cell is not later treated as a sounding. Ring points stay at 3 km outside the outline. The 8 km ocean grid cannot see a channel, so the point has to be in open water outside it.
- **Ring points:** for each atoll, 12 points spaced evenly round its outline (`data/rims.json`, from OpenStreetMap), each 3 km outside it (`lib/atoll-ring.ts`). Their mean level stands for the lagoon level.

**Residual sea level** is the level less its 25-hour mean (`residualLevels`). The mean removes the daily average and the slow non-tidal changes, and leaves the tide. A **slope** is the change in residual over the next hour, in metres per hour. It is a forward difference on purpose: centred differences scored worse on the benchmark.

**Drift** is the 25-hour vector mean of the current, which removes the tidal stream. At the series ends the window slides inward so it always covers a full tidal cycle. An hour with too few current samples takes the drift of the nearest hour that has one. Only a series with no current at all falls back to the monsoon climatology (`lib/seasonal.ts`), scaled by 0.4 to the measured drift (`SEASONAL_DRIFT_SCALE`).

## Which model a site gets

Every site has a type (`lib/site-type.ts`, `ADDING_SITES.md` §5): rim pass, channel thila, channel corner, outer reef, lagoon, or strait wall. The type and position pick one of four models:

| Site | Model | What it shows |
|---|---|---|
| Pass, channel thila, channel corner, and an outer wall within 0.8 km of a pass in the same atoll (the channel's funnel) | **Across the rim** | Incoming / outgoing, along the inward bearing |
| Any other outer-reef site: a wall with land or unbroken reef behind it (`flowsAlongReef`). The type decides, not the name | **Along the reef** | A compass direction ("Running NE"), along the reef |
| Lagoon (pin more than 0.8 km inside the outline) | **Lagoon flow** | A compass direction along the site's main flow axis |
| Strait wall, set by hand: the walls of Vaadhoo Kandu, the strait between North and South Malé | **Through the strait** | East or west ("Running E") |

A site's **inward bearing** comes from, in order:
- an explicit `inwardBearingDeg`;
- the normal to the atoll outline, if the pin is within 0.8 km of it;
- a fallback heuristic.

The fallback heuristic draws a dashed arrow and an estimate note. See `lib/bearing.ts` and `lib/rim.ts`.

**Sites set by hand as channels.** A site typed by hand (`siteTypeSource: "manual"`) as a pass, channel thila or corner takes the outline's normal from up to 3 km away. That covers channel pins the coarse outline places inside the lagoon, such as Cave Corner, Sundune and Maaddoo Giri.

**Curved channels.** A channel that bends can set `outgoingBearingDeg`, so the outgoing arrow points where the water actually leaves. HP Reef runs in toward 10 o'clock and out toward 5. The model itself keeps the inward axis.

**The owner's classification (3 Oct 2026).** The owner set the kind of every site in North Malé, South Malé, Baa, South Ari and Faafu that names and distances got wrong. The list is pinned in `lib/site-classes.test.ts`.

## Across the rim: channels

`forecastHours` in `lib/forecast.ts`. A channel runs from the higher water to the lower. The net flow at each hour, in residual metres per hour, positive running in:

    S_net = S_tide + K · F_inward + H / τ

- **`S_tide`:** the residual slope at the site's sample point. The rising tide fills the lagoon.
- **`K · F_inward`, through-flow:**
  - `F_inward` is the drift at the sample point along the inward bearing (`monsoonInwardFlux`). It is positive when the ocean current pushes into the channel.
  - `K = THROUGHFLOW_SLOPE_PER_MS = 0.7`.
  - In the monsoon, channels facing the current run in most of the day and the far side runs out. The NE monsoon (about Dec–Apr) runs east-side channels in; the SW monsoon (about May–Nov) the reverse.
- **`H / τ`, the head across the atoll:**
  - `H` is the site's residual level less the atoll's ring level. The tide reaches opposite sides of an atoll at slightly different times, so one side stands higher than the lagoon while the other stands lower.
  - `τ = ATOLL_HEAD_TAU_HOURS = 0.25 h` is how fast the lagoon follows the ocean.
  - With no ring level (no outline, or fewer than 9 of 12 points with data), `H = 0`.

**Direction** is the sign of `S_net`. An hour with exactly zero takes the next signed hour.

**Strength** is graded in two steps:

1. **The day's envelope.** It comes from the residual range over the 25 hours around the hour, plus the range a tide would need to give the extra slope that through-flow and head add (`extra slope × 12.42 / π`). This is multiplied by the channel's constriction factor:
   - The factor is `(31,500 m² / (width × depth))^0.35`, held between 1.0 and 2.5.
   - A channel uses a published section width and depth only, and only when the depth is hydraulic. Every section stores what its depth is (`channelDepthKind`: `mean`, `typical`, `max`, `least`, `range`, `sounding`), and `sectionInput` passes width and depth to the factor only for `mean` or `typical`. A stated maximum, a least depth over a sill, or the deep end of a range is not the section depth. A GEBCO cell is not a section either. A missing or non-positive width or depth leaves the factor at 1.
   - Atoll lagoon means (`lagoonMeanDepthM` on South Malé, Vaavu, and Addu) are catalog data. They are not a model input.
   - Atlas channel widths (`atlasWidthM` on 44 sites) are catalog data too. They are the gap between reef-crest and reef-flat polygons on the Allen Coral Atlas geomorphic map, measured across the channel at the pin (`npm run channel-widths`), and reviewed on the Atlas satellite mosaic: 39 `checked`, 5 `low`. They are not a model input. The Atlas bathymetry saturates near 15 m, so it gives no channel depth, and a width without a depth sets no factor.
   - Channel records (`channels` in `data/sites.json`) hold each source's statement about a named channel once: width, depth, depth kind and source. A site's `channelLeads` point at records that bear on it but are not its section, each with a reason: matched to the site by position only (`position`), a depth with no width (`depth-only`), or disagreeing with the site's stored section (`conflict`). 23 sites point at 22 records. The factor ignores them. The main sources are the Malé harbour sailing directions, NGA Sailing Directions Pub. 173 (an archived edition with surveys from 1917 to 1987), IUCN shark and ray area factsheets, and dive-site pages.
   - 31,500 m² was the median of the channel sections stored before model 16. Six of them (Kandooma, Miyaru, Fotteyo, Kuredu, Devana, Rasdhoo Madivaru) turned out not to be in their cited sources and were removed, and Embudhoo was corrected to its IUCN factsheet. The reference was kept. The sections now are Vaadhoo (Ocean Science paper, about 400 m maximum) and seven from IUCN Important Shark and Ray Area factsheets: Embudhoo Express and Embudhu Thila (450 m, 5–30 m range), Gangehi (500 m inner width, 25 m maximum), Fushifaru Thila and Corner (700 m, the narrow end of 0.7–1 km, 30 m floor), Maa Kandu (600 m inner) and Maa Kandu Beyru (900 m mouth), both 30 m maximum. Only the two Fushifaru sites have a typical depth, so they are the only sections the factor sizes.
   - The envelope bands (`RANGE_BANDS_M`) on that effective range are:

     | Band | Effective range |
     |---|---|
     | slack | below 0.25 m |
     | mild | below 0.6 m |
     | strong | below 2.0 m |
     | very strong | 2.0 m and above |

     A spring tide alone (up to about 1.1 m) tops out at strong. Very strong takes a monsoon push, a strong head, or a narrow channel on top. Very strong is stored as `too_strong`.
2. **Each hour within that envelope** (`hourlyStrength`):
   - Below 0.02 m/h is slack.
   - The steepest hour of the 25 takes the envelope band.
   - The other hours ramp up to it with their own `|S_net|`.
   - So a run eases in from slack, peaks and eases out.

Over 99 days of ocean data (1 Jul – 7 Oct 2026):
- Channel hours are slack 9 %, mild 46 %, strong 44 %, very strong 1 %.
- 3 % of channel-days reach very strong, mostly at channels facing the monsoon current.

**Reports pull** the channel forecast (see below). **Confidence** can reach high only at channels.

## Along the reef: outer walls

`alongReefHours`. Water cannot cross an island or an unbroken reef, so at an outer wall it runs along the reef.

- **The reef heading** is the inward bearing turned 90° clockwise (`alongReefHeading`). "incoming" means toward that heading, "outgoing" the other way. The UI shows the compass point.
- **The current along the reef** is the hourly current at the sample point projected on that heading. It is split into its tidal part (the hour less the 25-hour drift) and the drift:

      v = 3 · (v_hour − v_drift) + v_drift      (ALONG_REEF_TIDE_GAIN = 3)

  The 8 km grid smooths the tidal stream along the walls, so taken as is the drift would hold half the walls one way all day. Scaled by 3, most walls turn with the tide, and a strong monsoon still holds some one way. The tidal part follows the sea level and runs as one stream along a whole flank, with no split between channels.
- **Strength** comes from `|v|` (`ALONG_REEF_BANDS_MS`):

  | Band | `\|v\|` |
  |---|---|
  | slack | below 0.15 |
  | mild | below 0.5 |
  | strong | below 1.3 |
  | very strong | 1.3 and above |

  Very strong is reached on 4 % of wall-days.
- **Confidence** is always low, and reports do not pull it yet.

## Through the strait: Vaadhoo Kandu walls

`straitHours` in `lib/forecast.ts`. Vaadhoo Kandu is an ocean strait between North and South Malé, not a pass into a lagoon: about 5 km wide and 300–400 m deep between shallow rims, carrying the ocean from east to west or back.

Seven walls are strait walls, set by hand from the owner's knowledge:
- **South Malé's north rim:** Vaadhoo Caves, Velassaru Caves, Embudhoo Canyon, Cathedral.
- **North Malé's south rim:** Lions Head, Old Shark Point, Hans Hass Place.

Coral Garden and Vaadhoo House Reef sit inside their own channels, so they are passes. Velassaru Caves also feels its neighbouring channel, but it shows the strait.

How the strait runs, per the owner:
- **The monsoon sets the main direction:** west in the NE monsoon (about Dec–Apr), east in the SW (about May–Nov).
- **The tide pushes and pulls:** the semi-diurnal tide crosses the archipelago eastward, so the rising tide pushes east and the falling tide pulls west.
- **The strait funnels both like a venturi.**

The flow at a wall, in m/s toward the east along the strait's axis:

    v = 2.5 · tide slope (m/h) + 3.5 · 25-hour drift along the strait (m/s)      (STRAIT_TIDE_GAIN, STRAIT_DRIFT_GAIN)

- **SW monsoon:** a spring flood rips east, and on the ebb the eastward drift slackens or briefly turns west. In the NE monsoon the ebb supercharges the westward set and the flood brakes it.
- **Strength:** real speeds in m/s (`STRAIT_BANDS_MS`):

  | Band | Speed |
  |---|---|
  | slack | below 0.2 m/s |
  | mild | below 0.6 m/s |
  | strong | below 1.3 m/s |
  | very strong | 1.3 m/s and above (about 2.5 kn) |

- **Over 99 days of the SW monsoon:**
  - The walls run east 93 % of hours, and west on 23 % of mid-ebb hours.
  - Neap days peak at about 0.76 m/s and spring days at 1.19 m/s (p90 1.39).
  - 16 % of days reach very strong.
- **Confidence** is always low.

## Lagoon flow

`lib/lagoon-flow.ts`. Inside the lagoon the current is the water moving in and out through the rim's openings.

- **Openings:**
  - The porous rim: the 12 ring points on the outline plus the midpoints between them, each standing for its share of the perimeter. Each opening's flow `q` is the channel model's `S_net` there, along the outline's inward normal.
  - Each across-rim dive site in the atoll, with its own `S_net` and a weight of `CHANNEL_WEIGHT_KM = 2` km.
- **The current at a site** is each opening's exchange spreading from it (running in) or drawing toward it (running out), as a 2-D source:

      u = Σ q · w · (site − opening) / (2π |site − opening|²)  +  sink

  The sink is the same water rising or falling evenly over the lagoon, from a grid of cells inside the outline. Without it, openings spread evenly round a closed rim would give no flow inside, and the flood would never spread inward.
- **What comes out:**
  - On the flood, water spreads inward from the rim and drains back on the ebb.
  - Water crosses the lagoon from channels running in to channels running out. In the SW monsoon, that is eastward in 12 of 13 atolls.
  - A thila near a channel follows that channel.
- **Display:** each site's flow is projected on its main axis (the principal axis of its hourly flow, `mainAxisDeg`) and shown as a compass direction, like a wall.
- **Strength** comes from that projection (`LAGOON_BANDS`):

  | Band | Projected flow |
  |---|---|
  | slack | below 0.02 |
  | mild | below 0.2 |
  | strong | below 0.55 |
  | very strong | 0.55 and above |

  Lagoon hours are 18 % strong, against 44 % for channels, and 2 % of lagoon-days reach very strong.
- **Confidence** is always low.
- **Fallback:** an atoll with no outline or ring data keeps the channel model.

## Reports and scoring

Divers report direction and strength after a dive (`components/ReportForm.tsx`, `lib/actions.ts`). Each report saves:

- the residual slopes from 6 hours before to 6 after (`slopeWindowM`), the day's range (`rangeM`), the through-flow (`throughflowM`) and the head (`headWindowM`) at that hour, so it can still be graded once its hour has left the series;
- at walls and lagoon sites, the compass heading "incoming" meant when it was filed (`alongHeadingDeg`), so it keeps its meaning if the site's bearing or axis changes (`alongReportDirection`);
- the prediction the page showed and the model's own call, with the model version and bearing (`predicted`, `lib/forecast-log.ts`).

At channels, reports teach the forecast (`lib/forecast.ts`):

- **Phase lag.** The forecast is shifted by up to ±6 hours if earlier reports agree better with it shifted. This needs at least 2 reports, with a penalty of 0.05 per hour of shift.
- **Speed factor.** Strength is scaled by between 0.5 and 2 if reports run consistently stronger or weaker than the model at their own hours.
- **Pull.** A report pulls the next 6 hours toward what it saw, fading over those hours, and stops at the next turn. Direction needs 60 % agreement.
- **Decay.** Every report is weighted by 2^(−age / 90 days). A slack report says how strong but casts no direction vote.

**Confidence** (`confidenceFor`):

| Confidence | Requires |
|---|---|
| high | at least 4 reports on the same phase of the tide, all agreeing on direction, at least 60 % agreeing on strength at their own hours, and no contradicting report within 3 hours, or within 7 days on the same tide phase |
| medium | at least 80 % direction agreement |
| low | anything else |

High is also blocked:
- inside the lagoon and at walls;
- while the benchmark replay fails (`data/replay.json` `ok: false`).

**Scoring.** `npm run verify` scores saved predictions against reports, grouped by model version. Past predictions are never recomputed. `npm run replay` replays the curated fixtures in `data/benchmark-reports.json` as a regression check: currently 30 reports at 80 % direction. It is not an accuracy measure, because the fixtures are scenarios, not dives. Walls are replayed with the along-reef model. Lagoon sites and pre-axis reports are left out.

Bump `FORECAST_MODEL_VERSION` whenever a change alters what the forecast says for the same inputs.

## Constants

| Constant | Value | Where | Set by |
|---|---|---|---|
| Sample point offset | 3 km seaward | `marine.ts` | design |
| Forecast window | 1 past + 7 forecast days | `marine.ts` | review §4.7 |
| Slack slope | 0.02 m/h | `forecast.ts` | original model |
| `THROUGHFLOW_SLOPE_PER_MS` (K) | 0.7 m/h per m/s | `forecast.ts` | owner, §4.5 |
| `ATOLL_HEAD_TAU_HOURS` (τ) | 0.25 h | `forecast.ts` | owner, §4.8 |
| `RANGE_BANDS_M` | 0.25 / 0.6 / 2.0 m | `forecast.ts` | owner + 99-day climatology, §4.9 |
| Constriction | ref 31,500 m², exponent 0.35, 1.0–2.5 | `forecast.ts` | channel sections before model 16 |
| `SEASONAL_DRIFT_SCALE` | 0.4 | `forecast.ts` | measured drift, §4.7 |
| `ALONG_REEF_TIDE_GAIN` | 3 | `forecast.ts` | owner, §4.6 |
| `ALONG_REEF_BANDS_MS` | 0.15 / 0.5 / 1.3 | `forecast.ts` | §4.6, §4.9 |
| `CHANNEL_FUNNEL_KM` | 0.8 km | `site-type.ts` | owner, §4.6 |
| Ring points | 12, at least 9 for a level | `atoll-ring.ts` | §4.8 |
| `CHANNEL_WEIGHT_KM` | 2 km | `lagoon-flow.ts` | §4.10 |
| `LAGOON_BANDS` | 0.02 / 0.2 / 0.55 | `lagoon-flow.ts` | owner + 99 days, §4.10 |
| `STRAIT_TIDE_GAIN`, `STRAIT_DRIFT_GAIN` | 2.5 m/s per m/h, 3.5 | `forecast.ts` | owner + 99 days, §4.11 |
| `STRAIT_BANDS_MS` | 0.2 / 0.6 / 1.3 m/s | `forecast.ts` | owner's dive speeds, §4.11 |
| Report half-life | 90 days | `forecast.ts` | original model |

**Calibration scripts** (all `npm run <name>`):

| Script | What it does | Data |
|---|---|---|
| `throughflow-calibrate` | sweeps K | local marine cache |
| `along-reef-calibrate` | checks the wall stream and its bands | local marine cache |
| `atoll-head-calibrate` | checks the head and sweeps τ | point `MARINE_CACHE_DIR` at a fresh directory, so all series come from one model run |
| `strength-calibrate` | sweeps the channel and wall bands | 99 days, cached under the OS temp directory by `scripts/long-series.ts` |
| `lagoon-calibrate` | checks the lagoon flow and sweeps the channel weight | same 99-day cache |
| `strait-calibrate` | sweeps the strait gains | same 99-day cache |

## Model versions

| Version | Date | Change |
|---|---|---|
| `tide-slope+drift-nudge/1`–`/6` | 29–30 Sep 2026 | Tide slope decides direction, drift only nudges strength. Predictions are saved with reports (/1). Graded hourly strength (/2). Slack reports cast no direction vote (/3). Narrowing applies to the envelope only (/4). Strength agreement is judged at each report's own hour (/5). Site types, with no high confidence in the lagoon (/6). |
| `tide+throughflow/7` | 1 Oct | Monsoon through-flow decides direction with the tide (§4.5). |
| `…+alongreef/8` | 1 Oct | Outer walls run along the reef (§4.6). |
| `…/9` | 1 Oct | Drift gaps, a week ahead, wall reports keep their meaning (§4.7). |
| `…+head…/10` | 1 Oct | Head across the atoll (§4.8). |
| `…/11` | 1 Oct | Strength bands from the range climatology, "very strong" (§4.9). |
| `…+lagoon/12` | 1 Oct | Lagoon flow (§4.10). |
| `…+strait/13` | 1 Oct | Vaadhoo Kandu walls run through the strait (§4.11). |
| `…/14` | 3 Oct | The owner's site classification: channel corners, channel dives inside the outline, the strait walls revised, curved HP Reef. |

## Known limits

- **No ground truth yet.** K, τ, the gains and every band come from the ocean model and the owner's experience. They should be refitted once real reports exist (Stage C, `HYDRODYNAMICS_PLAN.md` §5).
- **January to March is not checked.** The marine API gives at most 92 past days, so the NE monsoon has not been in any calibration.
- **The ocean model barely sees the atolls.** At 8 km it treats them almost as open sea. Its tidal stream along the walls is smoothed (hence the ×3 gain), and its head across an atoll is the open ocean's gradient, likely smaller than the real one (hence the short τ).
- **Surface current, not current at dive depth.** It includes Stokes drift. There is no wind forcing beyond what the ocean model carries.
- **Passes are only width × depth.** Opposite flows between neighbouring channels, eddies and reef-flat pumping are not modelled.
- **Lagoon flow is a 2-D picture.** It has no reefs inside the lagoon, no depth, and the dive sites cluster near one rim in several atolls.
- **Lagoon sites react the same way in both directions.** Some don't. Kings Corner is pushed deeper by two channels on the flood, and slows and splits on the ebb. Kudadhoo Etheru Faru is pulled toward its channel when outgoing and sheltered when incoming. The model shows neither.
