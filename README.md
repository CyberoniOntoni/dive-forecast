# dive-current

Maldives dive-site current forecast for guides and liveaboard crews. Open a site, move the time slider (about a week ahead), and read which way the current runs, how strong it is (slack, mild, strong, very strong), and how much to trust the call before the site goes on the board.

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

## Map

Seeded sites are in `data/sites.json`, with a source for each coordinate. See `ADDING_SITES.md` before adding one. Published dive depths are stored only when a page printed them. Channel width and depth are stored only for a named channel with a printed measurement.

The map's layer button switches the base and each overlay on or off, and remembers the choice in the browser. Bases: Esri World Imagery (default), OpenStreetMap, or none. Overlays, from [OpenSeaMap](https://www.openseamap.org/) under CC BY-SA 2.0: seamarks (on by default), depth shading from the GEBCO 2021 grid (about 450 m, so atoll shape rather than pass detail), sonar depths shared by boats (sparse in the Maldives), and depth contours. The coordinate grid is drawn by the app and is on by default, like seamarks. Depth shading and contours clash with satellite imagery, so turning either on over satellite switches the base to the street map. Each layer's credit shows while it is on.

Three overlays come from the [Allen Coral Atlas](https://allencoralatlas.org/), CC BY 4.0, all off by default:

- **Reef outline** (from zoom 10): the edge of every mapped reef.
- **Reef zones** (from zoom 11): the geomorphic map, reef crest, reef flats, reef slopes, plateau and lagoon.
- **Bottom types** (from zoom 12): the benthic map, coral/algae, rock, rubble, sand, seagrass and microalgal mats. Patches under 600 m² are left out; most are single-pixel specks from the satellite classification.

They are served from static tiles in `public/overlays/`, built from the Atlas region download:

1. Sign in at allencoralatlas.org, download the Maldives area (Geomorphic map, Benthic map and Reef extent, as GeoPackage) and unzip it into `data/sources/aca/` (gitignored).
2. `npm run atlas-overlays` rewrites the tiles and their indexes (`-- reefZones`, `bottomTypes` or `reefOutline` for one).

The Atlas maps only the shallow reef tops, so it does not decide a site's type (see `ADDING_SITES.md`). Whether Esri's terms allow this public map is still open (roadmap item 7).

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
