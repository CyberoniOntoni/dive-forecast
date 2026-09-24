# dive-current

Maldives dive-site current forecast for guides and liveaboard crews. Open a site, move the time slider, and read incoming or outgoing, strength, and confidence before the site goes on the board.

The forecast uses Open-Meteo sea level and ocean current, sampled about 3 km seaward of each pin. A 25-hour mean is removed before the slope is taken. Each incoming or outgoing run keeps one strength. Slack is the turn. A dive report can pull the next few hours, and it stores the tide around that hour so the pass can learn a lag. A site rating does not change the current.

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

Seeded sites are in `data/sites.json`, with a source for each coordinate. Published dive depths are stored only when a page printed them. Channel width and depth are stored only for a named channel with a printed measurement.

`data/marine-cache` holds fetched Open-Meteo hours and is not part of the repo. `data/store.json` holds reports, ratings, and sites added in the app.

## Roadmap

What is shipped, what comes next, and what stays out of this version is in [ROADMAP.md](ROADMAP.md).
