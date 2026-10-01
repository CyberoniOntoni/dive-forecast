# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

`dive-current`: a Next.js 16 / React 19 app that forecasts current (direction, strength, confidence) at Maldives dive sites, hour by hour for about a week. No database: all state is JSON files under `data/`. How the model works today is in `FORECAST_MODEL.md`; the reasoning, calibration runs and findings log are in `HYDRODYNAMICS_PLAN.md`; product scope is in `ROADMAP.md`.

## Commands

```bash
npm run dev                  # http://localhost:3000
npm test                     # vitest run (lib/**, components/**, tests/**)
npx vitest run lib/forecast.test.ts          # one file
npx vitest run lib/forecast.test.ts -t "name" # one test
npm run lint
npm run build
npm run replay               # benchmark replay of past reports; writes data/replay.json
```

CI (`.github/workflows/ci.yml`, Node 22) runs `npm test`, `npm run lint`, `npm run build`, `npm run replay` — run all four before pushing.

Data/maintenance scripts (all `vite-node scripts/*.ts`): `verify` (score saved predictions vs. diver reports, grouped by model version), `benchmark`, `bearings -- <site-id>`, `site-types [-- --write]`, `atlas-overlays [-- reefZones|bottomTypes|reefOutline]`, `extract-dive-guide`, `import-dive-guide`.

Calibration scripts (print tables; they set no constants themselves): `throughflow-calibrate` (K), `along-reef-calibrate` (walls), `atoll-head-calibrate` (τ; point `MARINE_CACHE_DIR` at a fresh dir so all series share one model run), `strength-calibrate` (channel and wall bands) and `lagoon-calibrate` (lagoon). The last two fetch 99-day series into an OS-temp cache via `scripts/long-series.ts`, never into `data/marine-cache`. See `FORECAST_MODEL.md` § Constants.

Tests run with networking disabled and a throwaway `MARINE_CACHE_DIR` (see `vitest.setup.ts`); any test needing Open-Meteo data must stub `fetch` or write fixture hours itself.

## Architecture

Data flow: `marine.ts` → `load-site.ts` → `forecast.ts` → pages/server actions.

- **`lib/marine.ts`** fetches Open-Meteo sea level + ocean current (1 past + 7 forecast days) for a point ~3 km *seaward* of each pin (opposite the inward bearing), with a file cache in `data/marine-cache/` (6 h TTL refreshed in the background, stale-after-failure fallback, max 4 concurrent requests; the map passes `{ wait: false }` so it never waits on a first fetch).
- **`lib/bearing.ts` / `lib/rim.ts`** resolve a site's inward bearing: explicit `inwardBearingDeg` override → rim-derived normal from the atoll outline in `data/rims.json` (pin within 0.8 km of rim) → fallback heuristic. The bearing drives the arrow, the drift projection, and where marine data is sampled, so a wrong bearing fails silently. Follow `ADDING_SITES.md` when adding or editing sites.
- **The site type picks the model** (`lib/site-type.ts`; details in `FORECAST_MODEL.md`):
  - **Across the rim** (passes, channel thilas, corners, walls within 0.8 km of a pass): `forecastHours` in **`lib/forecast.ts`**. Net flow = residual tide slope (25 h mean removed) + through-flow (`K` × 25 h drift along the inward bearing) + head across the atoll (site level − atoll ring level, over `τ`). Direction is its sign; strength ramps hour by hour up to an envelope from the effective range (tide range + extra from through-flow/head, × channel constriction) in `RANGE_BANDS_M`. Reports (90-day half-life) fit a phase lag and speed factor and pull the next 6 h; confidence has hard gates (never "high" if a recent report contradicts, at walls or lagoon sites, or while the replay fails).
  - **Along the reef** (other outer-reef walls, `flowsAlongReef`): `alongReefHours` — the current projected on the reef line, tidal part ×3 plus drift; shown as a compass direction.
  - **Lagoon**: `lib/lagoon-flow.ts` — 2-D sources at the rim's openings (ring points and channel sites, each with its channel-model net flow) plus a sink over the lagoon area; projected on the site's main flow axis and shown as a compass direction.
  - Along-reef and lagoon sites set `SiteLoad.alongHeadingDeg` ("incoming" = toward it); the UI, report form and `alongReportDirection` key off that.
- **`lib/atoll-ring.ts`** loads 12 ring points round each atoll outline (cached like any sample point, memoised 10 min per atoll); their mean residual level is the lagoon level for the head term, and their series are the lagoon model's rim openings.
- **`FORECAST_MODEL_VERSION`** in `forecast.ts` must be bumped whenever a change alters output for the same inputs — every saved report stores the prediction shown with that version (`lib/forecast-log.ts`), and `npm run verify` groups by it. Past predictions are never recomputed.
- **`lib/load-site.ts`** assembles a `SiteLoad` for a site (routing by model above; per-atoll memo of lagoon openings); it reads `data/replay.json` and blocks "high" confidence while the replay says `ok: false`. `lib/nowcast.ts` does the same for all sites at the current hour (map glance, `lib/nowcast-glance.ts`).
- **Strength** is stored as `slack | mild | strong | too_strong`; `too_strong` is *shown* as "very strong" (it depends on the diver whether it can be dived).
- **`lib/store.ts`** reads the seeded catalog `data/sites.json` (read-only at runtime) and the mutable `data/store.json` (reports, ratings, user-added sites with `sourceUrl: "user"`), writing via temp-file + rename under a serialized mutation queue (process-local only). `lib/actions.ts` (`"use server"`) is the only entry point from the UI for reads/writes.
- **UI**: `app/page.tsx` (map with nowcasts, `components/SiteMap.tsx` on Leaflet; layer config in `lib/map-layers.ts`) and `app/sites/[id]/page.tsx` (hour slider, report and rating forms). Allen Coral Atlas overlays are prebuilt static tiles in `public/overlays/`.
- **Time**: forecast/report times are Maldives wall-clock strings (UTC+5); use `toMaldivesWall` / `parseWall` from `forecast.ts` rather than raw `Date` parsing.

## Tests layout

Unit tests sit next to modules in `lib/`. `lib/e2e-requirements.test.ts` is a 4-tier requirements suite (see `TEST_INFRA.md`; filter with `-t "Tier 1"` etc.). `tests/challenger-*.test.ts` are milestone adversarial tests. `data/benchmark-reports.json` holds curated fixture scenarios, not real ground truth: the replay skips lagoon sites and reads walls along the reef, so it scores 30 of its reports. Tests that need the head term or the lagoon model build ring levels or sources themselves (no network).

## Deployment

`output: "standalone"`; `Dockerfile` + `docker-compose.yml` bind-mount `./data` for persistence, so the host's `data/` (catalog, rims, store, marine cache) is what the running app reads.
