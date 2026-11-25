# 50Bar (dive-current)

Maldives dive-site current forecast for guides and liveaboard crews, live at [50bar.app](https://50bar.app) and on Google Play as **50Bar: Maldives Dive Currents** (Android). The brand is spelled 50Bar; the domain stays lowercase. The repository and npm package keep the older name `dive-current`. Open a site, move the time slider (about a week ahead), and read which way the current runs, how strong it is (slack, mild, strong, very strong), and how much to trust the call before the site goes on the board.

The forecast uses Open-Meteo sea level and ocean current, sampled about 3 km seaward of each pin and round each atoll's outline. What it shows depends on where the site is:

- **Channels** (passes, channel thilas, corners): incoming or outgoing. The tide fills and empties the lagoon, the monsoon current pushes through the atoll (channels facing it run in, the far side out), and the level difference across the atoll lets opposite sides run opposite ways.
- **Outer walls** with land or solid reef behind them: a compass direction along the reef, turning with the tide, with the monsoon drift making one way stronger or longer.
- **Lagoon sites**: a compass direction from the water moving in and out through the rim and channels: inward on the flood, back out on the ebb, across the lagoon with the monsoon.

Strength follows the flow hour by hour, so each run eases in from slack, peaks and eases out. A dive report can pull the next few hours at a channel, and it stores what the model said so the forecast can be scored and corrected later. A site rating does not change the current. The model in full, with its constants and limits, is in [FORECAST_MODEL.md](FORECAST_MODEL.md).

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Widen the window past about 1024 px for the side list. Narrower widths use the phone drawer.

```bash
npm test
npm run build
```

## Accounts and community

Reading forecasts needs no account. Filing dive reports, rating and reviewing sites, adding sites and saving dive plans need a diver signed in with an emailed six-digit code (sent through Cloudflare Email Sending, Mailgun as fallback). Only nicknames are ever shown. Reports earn points and badges on the public [scoreboard](https://50bar.app/scoreboard), and each diver has a public page with an optional "About me".

Because divers post reviews, photos, sites and profiles, the app follows Google Play's user-generated content rules:

- **[/terms](https://50bar.app/terms)**: the content rules. A diver agrees to them at sign-in before posting anything others see.
- **Report and Block**, on the web and in the app: Report sends a review, site or diver to the moderators (by email, and on `/moderation`); Block hides a diver's reviews and site notes from the one who blocked them.
- **`/moderation`**, for the addresses in the `MODERATOR_EMAILS` secret: remove content, ban a diver, or dismiss a report.
- **Delete account**, on `/account` or the app's You tab (`DELETE /api/v1/me`): the account, codes, plans, ratings, reviews and photos go at once; dive reports stay without a name so they keep teaching the forecast.

**[/privacy](https://50bar.app/privacy)** (`app/privacy/page.tsx`) is the policy Google Play links to. It describes what the code collects and keeps, so change it with any change to that. Privacy questions go to privacy@50bar.app and help with the site or app to support@50bar.app (both Cloudflare Email Routing). `/terms`, `/account` and the app's You tab link support.

A store-review account (`lib/review-account.ts`) lets Google's reviewers sign in with a fixed code and no email. Its address and code are worker secrets (`REVIEW_EMAIL`, `REVIEW_CODE`; `CLOUDFLARE.md` § Sign-in) and are never written in the repository. What it posts is shown only to itself, never teaches the forecast and earns no points.

User data lives in Cloudflare D1 and photos in R2; see [CLOUDFLARE.md](CLOUDFLARE.md) for the Workers deployment.

## Android app

The Kotlin/Compose app is in [`android/`](android/README.md), built over the same JSON API (`app/api/v1/*`, [API.md](API.md)), so the forecast model lives only on the server. Package `app.fiftybar` (permanent once published).

- **Saved atolls**: save an atoll for use without signal: every site's page, week of forecast and recent reports, the Allen Coral Atlas tiles, and our own Sentinel-2 imagery (Esri and OpenStreetMap tiles are never downloaded ahead, as their terms forbid it).
- **Release**: `.github/workflows/android-release.yml` builds a signed `.aab` with the upload key from four repository secrets (run it from the Actions tab or push a tag `android-v1.0.1`); the `versionCode` is the run number. The release build is shrunk by R8, and its mapping file ships in the bundle.
- **Edge to edge** comes from the theme XML, not `enableEdgeToEdge()`, so Play does not flag deprecated window APIs; `android/scripts/check-window-apis.sh` fails CI if any shipped code uses them again.

Details, secrets and the release steps: [android/README.md](android/README.md) § Releasing to Google Play.

## Map

Seeded sites are in `data/sites.json`, with a source for each coordinate. See `ADDING_SITES.md` before adding one. Published dive depths are stored only when a page printed them. Channel width and depth are stored only for a named channel with a printed measurement.

The map's layer button switches the base and each overlay on or off, and remembers the choice in the browser. Bases: Esri World Imagery (default), OpenStreetMap, or none. Overlays, from [OpenSeaMap](https://www.openseamap.org/) under CC BY-SA 2.0: seamarks (on by default), depth shading from the GEBCO 2021 grid (about 450 m, so atoll shape rather than pass detail), sonar depths shared by boats (sparse in the Maldives), and depth contours. The coordinate grid is drawn by the app and is on by default, like seamarks. Depth shading and contours clash with satellite imagery, so turning either on over satellite switches the base to the street map. Each layer's credit shows while it is on. The app's own "Sheltered water" overlay colours each atoll's lagoon by this hour's sea state (see `FORECAST_MODEL.md`, Sea state); island outlines are from OpenStreetMap's land polygons (© OpenStreetMap contributors, ODbL).

Three overlays come from the [Allen Coral Atlas](https://allencoralatlas.org/), CC BY 4.0, all off by default:

- **Reef outline** (from zoom 10): the edge of every mapped reef.
- **Reef zones** (from zoom 11): the geomorphic map, reef crest, reef flats, reef slopes, plateau and lagoon.
- **Bottom types** (from zoom 12): the benthic map, coral/algae, rock, rubble, sand, seagrass and microalgal mats. Patches under 600 m² are left out; most are single-pixel specks from the satellite classification.

They are served from static tiles in `public/overlays/`, built from the Atlas region download:

1. Sign in at allencoralatlas.org, download the Maldives area (Geomorphic map, Benthic map and Reef extent, as GeoPackage) and unzip it into `data/sources/aca/` (gitignored).
2. `npm run atlas-overlays` rewrites the tiles and their indexes (`-- reefZones`, `bottomTypes` or `reefOutline` for one).

The Atlas maps only the shallow reef tops, so it does not decide a site's type (see `ADDING_SITES.md`). Whether Esri's terms allow this public map is still open (roadmap item 6).

The app's saved-atoll satellite imagery is made from Copernicus Sentinel-2 data (2023–2026; `scripts/imagery/sentinel2.py`), free for any use with credit, as the app's map shows it: "Contains modified Copernicus Sentinel data 2023–2026" (`IMAGERY_ATTRIBUTION` in `lib/imagery.ts`; a rebuild with other years changes it there, in `SENTINEL2_CREDIT` in the Android `SiteMapView.kt` and here).

Channel depths in `data/sites.json` (`gridDepthMeanM`, `gridDepthMaxM`) are measured on the Maldives bathymetry grid by Shuaib Rasheed, Simon C. Warder, Yves Plancherel and Matthew D. Piggott: *An Improved Gridded Bathymetric Data Set and Tidal Model for the Maldives Archipelago*, Earth and Space Science 8 (2021), [doi:10.1029/2020EA001207](https://doi.org/10.1029/2020EA001207). The paper is CC BY-NC 4.0. The forecast uses the crossings marked `ok` to size channels that have no published section.

Dive site positions in `data/sites.json` come mostly from the Maldives dive guide on SeaSketch; others from OpenStreetMap (© OpenStreetMap contributors, ODbL), [Wannadive](https://www.wannadive.net/), [Dive Planner Pro](https://diveplannerpro.com/) and PADI, each named in the site's `sourceUrl`. 25 Gaafu Alif and Raa sites come from the owner's own guiding (an empty `sourceUrl`; see `data/sources/gaafu-alif-divesites.json`). Sites marked `pinPlacement: "imagery"` are named by their source but placed on the channel by hand from satellite imagery; the site page says "position approximate".

`data/marine-cache` holds fetched Open-Meteo hours and is not part of the repo. `data/store.json` holds reports, ratings, and sites added in the app.

## Checking the forecast

Each diver report saves the prediction the app made for that hour: what the site page showed, what the model said on its own, the model version, and the bearing used. Nothing is recomputed later, so a change to the model cannot rewrite past results. Score them against what divers reported:

```bash
npm run verify
```

It groups results by model version and warns while there are too few reports to mean anything. The reports in `data/benchmark-reports.json` are curated test scenarios with no saved prediction, so they are not scored. `npm run replay` replays them as a regression check (CI runs it), not as an accuracy measure.

The model's constants were set from the ocean model's own data and the owner's experience, not yet from dives. The calibration scripts that produced them (`throughflow-calibrate`, `along-reef-calibrate`, `atoll-head-calibrate`, `strength-calibrate`, `lagoon-calibrate`) print the tables behind each choice; see [FORECAST_MODEL.md](FORECAST_MODEL.md#constants) and `HYDRODYNAMICS_PLAN.md` §4.5–4.10.

## Roadmap

What is shipped, what comes next, and what stays out of this version is in [ROADMAP.md](ROADMAP.md).
