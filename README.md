# dive-current

Maldives dive-site current forecast for guides and liveaboard crews. Open a site, move the time slider, and read incoming or outgoing, strength, and confidence before the site goes on the board.

The forecast uses Open-Meteo sea level and ocean current, sampled about 3 km seaward of each pin. A 25-hour mean is removed before the slope is taken. Strength follows the tide's rate of change hour by hour, so each run eases in from slack, peaks at the steepest hour, and eases out. Slack is the turn. A dive report can pull the next few hours by how far it differed from the forecast at its own hour, and it stores the tide around that hour so the pass can learn a lag. A site rating does not change the current.

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

The map's layer button switches the base and each overlay on or off, and remembers the choice in the browser. Bases: Esri World Imagery (default), OpenStreetMap, or none. Overlays, from [OpenSeaMap](https://www.openseamap.org/) under CC BY-SA 2.0: seamarks (on by default), depth shading from the GEBCO 2021 grid (about 450 m, so atoll shape rather than pass detail), sonar depths shared by boats (sparse in the Maldives), and depth contours. The coordinate grid is drawn by the app and is on by default, like seamarks. Depth shading and contours clash with satellite imagery, so turning either on over satellite switches the base to the street map. Each layer's credit shows while it is on. Whether Esri's terms allow this public map is still open (roadmap item 7).

`data/marine-cache` holds fetched Open-Meteo hours and is not part of the repo. `data/store.json` holds reports, ratings, and sites added in the app.

## Checking the forecast

Each diver report saves the prediction the app made for that hour: what the site page showed, what the model said on its own, the model version, and the bearing used. Nothing is recomputed later, so a change to the model cannot rewrite past results. Score them against what divers reported:

```bash
npm run verify
```

It groups results by model version and warns while there are too few reports to mean anything. The reports in `data/benchmark-reports.json` are curated test scenarios with no saved prediction, so they are not scored.

## Roadmap

What is shipped, what comes next, and what stays out of this version is in [ROADMAP.md](ROADMAP.md).
