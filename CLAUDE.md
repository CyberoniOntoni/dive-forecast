# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

`dive-current`: a Next.js 16 / React 19 app that forecasts current (incoming/outgoing, strength, confidence) at Maldives dive sites, hour by hour. No database: all state is JSON files under `data/`. Product scope and what is deliberately out of scope are in `ROADMAP.md`; physics plans and the findings log are in `HYDRODYNAMICS_PLAN.md`.

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

Tests run with networking disabled and a throwaway `MARINE_CACHE_DIR` (see `vitest.setup.ts`); any test needing Open-Meteo data must stub `fetch` or write fixture hours itself.

## Architecture

Data flow: `marine.ts` → `load-site.ts` → `forecast.ts` → pages/server actions.

- **`lib/marine.ts`** fetches Open-Meteo sea level + ocean current for a point ~3 km *seaward* of each pin (opposite the inward bearing), with a file cache in `data/marine-cache/` (6 h TTL, stale-after-failure fallback, max 4 concurrent requests).
- **`lib/bearing.ts` / `lib/rim.ts`** resolve a site's inward bearing: explicit `inwardBearingDeg` override → rim-derived normal from the atoll outline in `data/rims.json` (pin within 0.8 km of rim) → fallback heuristic. The bearing drives the arrow, the drift projection, and where marine data is sampled, so a wrong bearing fails silently. Follow `ADDING_SITES.md` when adding or editing sites.
- **`lib/forecast.ts`** is the model. Core contract: *direction comes from the residual tide slope* (25 h mean removed) plus diver-report phase lag; ocean drift (`seasonal.ts` monsoon climatology / 25 h-mean current) only nudges strength. Strength follows |slope| per hour within a run envelope from tidal range × channel constriction factor (`channelWidthM`/`channelDepthM`). Reports are time-decayed (90-day half-life) and can shift phase; confidence has hard gates (never "high" if a recent report contradicts, lagoon sites, or failed replay).
- **`FORECAST_MODEL_VERSION`** in `forecast.ts` must be bumped whenever a change alters output for the same inputs — every saved report stores the prediction shown with that version (`lib/forecast-log.ts`), and `npm run verify` groups by it. Past predictions are never recomputed.
- **`lib/load-site.ts`** assembles a `SiteLoad` for a site; it reads `data/replay.json` and blocks "high" confidence while the replay says `ok: false`. `lib/nowcast.ts` does the same for all sites at the current hour (map glance).
- **`lib/store.ts`** reads the seeded catalog `data/sites.json` (read-only at runtime) and the mutable `data/store.json` (reports, ratings, user-added sites with `sourceUrl: "user"`), writing via temp-file + rename under a serialized mutation queue (process-local only). `lib/actions.ts` (`"use server"`) is the only entry point from the UI for reads/writes.
- **UI**: `app/page.tsx` (map with nowcasts, `components/SiteMap.tsx` on Leaflet; layer config in `lib/map-layers.ts`) and `app/sites/[id]/page.tsx` (hour slider, report and rating forms). Allen Coral Atlas overlays are prebuilt static tiles in `public/overlays/`.
- **Time**: forecast/report times are Maldives wall-clock strings (UTC+5); use `toMaldivesWall` / `parseWall` from `forecast.ts` rather than raw `Date` parsing.

## Tests layout

Unit tests sit next to modules in `lib/`. `lib/e2e-requirements.test.ts` is a 4-tier requirements suite (see `TEST_INFRA.md`; filter with `-t "Tier 1"` etc.). `tests/challenger-*.test.ts` are milestone adversarial tests. `data/benchmark-reports.json` holds curated fixture scenarios, not real ground truth.

## Deployment

`output: "standalone"`; `Dockerfile` + `docker-compose.yml` bind-mount `./data` for persistence.
