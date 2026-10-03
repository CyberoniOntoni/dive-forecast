# Shallow-water simulation of North and South Malé (research prototype)

A depth-averaged hydrodynamic simulation of North Malé, South Malé, Vaadhoo Kandu between them and the sea round
them, with the islands and shallow reefs in it, run over 23 Sep – 2 Oct 2026 on live Open-Meteo levels and compared
site by site with the forecast the app showed for the same ocean. It is offline research: nothing here feeds the
forecast, the model version is unchanged, and CI does not run it.

North and South Malé were picked together: North Malé has the most dive sites (77), South Malé (33) holds the only
benchmark fixtures that fall in a recent window, and the strait between them is where the app runs its hand-set
strait model. One domain covers 110 sites.

## What it does

- **Grid** (`grid.py`): 200 m cells, 663 × 311, about 133 × 62 km. Three sources, finest first:
  - **Islands:** land from the open terrarium elevation tiles on AWS at zoom 12 (about 38 m a pixel). 656 cells.
  - **Reefs:** the Allen Coral Atlas reef zones already exported to `public/overlays/reef-zones`, each zone given a
    typical depth (`ZONE_DEPTH_M`: reef crest 0.4 m, flats 0.6–0.8 m, slopes 6–12 m, lagoon patches 3–12 m).
  - **Everything else:** the terrarium sea floor at zoom 10 (ETOPO/GEBCO class, about 1–2 km underneath). It smooths
    the rims into banks and fills Vaadhoo Kandu to 25–100 m, so open water inside an atoll outline is held at least
    25 m deep (channels, lagoon floor) and outside it falls away from the reef at 0.3 m per m to 400 m (Vaadhoo
    Kandu is 5 km wide and 400 m deep per `data/sites.json`).
  - Each cell averages 4 × 4 subcells of 50 m. ![depth](figures/depth.png)
- **Solver** (`swe.py`): the nonlinear shallow-water equations on a C-grid, explicit (1.5 s step), upwind
  advection, Manning friction (n = 0.035 on reef crest and flats, 0.025 elsewhere), Coriolis, wetting and drying of
  reef flats, islands as walls. Numba, about 12 s per simulated hour on 4 cores.
- **Forcing** (`forcing.py`, `marine.py`): Open-Meteo sea level over `domain.WINDOW` (10 days, 23 Sep – 2 Oct),
  fetched the way the app fetches it (nearest sea cell, Maldives wall clock) and cached in `sim/cache/marine/`.
  - Every ocean-model cell (1/12°) along each open edge, 16 a side from the south wall to the north wall: the inner
    sea at 73.21° E and the open ocean at 73.79° E. The solver interpolates each edge's level in latitude, so it
    varies along the edge as the ocean model's does (up to 0.11–0.12 m from end to end).
  - The inner sea runs up to ±0.17 m off the ocean through the tide (std 0.07 m), the two within an hour of each other:
    the tide crosses the double chain of atolls with a lag, and that head across the chain is the second driver.
    The 10-day mean head is +0.6 cm (inner sea higher).
  - The north and south edges are walls drawn through Gaafaru and Vaavu, so that head drops across the atolls and
    the gaps between them instead of running round the domain's ends.
  - Only levels are imposed; every current inside comes from the levels, the depths and friction. The ocean model's
    current is not imposed (forcing it at the edges pushes the whole drift against a chain that blocks the section).
- **Two cases** (`SIM_CASE`): `chain` drives the edges as above; `uniform` gives both edges the east level, leaving
  only the tide's rise and fall, to separate the two drivers. Only `chain` was run on the live levels.
- **Comparison** (`npm run sim-compare`, `scripts/sim-compare.ts`): runs `loadSite` for every site with Open-Meteo
  stubbed by the same window's live series, each point the forecast asks for (seaward sample points, the atoll
  ring points) getting its own ocean-model cell, so the forecast's head term sees what it would have seen live. The
  simulated current at the nearest open-water cell to each pin is projected on the axis the app shows for the site.
  Hours: 24 Sep 00:00 to 2 Oct 11:00 (the first day is spin-up; the forecast has no 25-hour mean in its last 12 h).
- **Run time:** about 12 s a simulated hour on 4 cores, so 10 days take 50 minutes. `swe.py` checkpoints every
  simulated day and resumes from it, for longer windows.

## Findings (chain case, 23 Sep – 2 Oct, live levels)

| Kind | Sites | Direction agrees* | Correlation | Best lag (h)† | Sim p95 speed | Sim hours in | Forecast hours in |
|---|---|---|---|---|---|---|---|
| Channel | 44 | 68 % | 0.30 | −2 | 0.36 m/s | 42 % | 27 % |
| Along the reef | 25 | 73 % | 0.35 | +1 | 0.13 m/s | 36 % | 56 % |
| Lagoon | 34 | 63 % | 0.09 | −1 | 0.24 m/s | 57 % | 81 % |
| Strait wall | 7 | 71 % | 0.47 | −2 | 0.36 m/s | 62 % | 90 % |

\* Of the hours both call non-slack. † Median over sites; negative means the simulation turns that many hours
*after* the forecast (the forecast at hour t lines up best with the simulation at t + |lag|). The first write-up of
this table read the sign the other way round. Full per-site output: `sim/out/chain/compare.txt` after a run.

The first run (25–30 Sep, cached series, one inner-sea point off North Ari) gave channels 58 %, correlation 0.03,
lag −4 h. With the whole of both edges forced from live levels, agreement is higher and the lag shorter, but the
pattern holds. The semidiurnal tide repeats every 12.4 h, so a lag near ±6 h is close to half a tide either way.

1. **The forecast turns before the simulation, by more on the east rims.** West-rim channels (Kuda, Bodu Hithi,
   Ziyaarai, Madi Thila; Vaagili, Ran Faru, Ramm Faru, Lhohi, Rannalhi) agree 66–94 % of hours and correlate
   0.8–0.9 with the simulation 0–2 h behind the forecast. East-rim channels (HP Reef, Furana, Kandooma, Embudhoo,
   Cocoa, Guraidhoo, Dhigu, Medhu Faru) agree 57–72 % and correlate 0.55–0.85 with the simulation 3–6 h behind.
   This was the finding that rested on one inner-sea point; with 16 points a side it stands.
2. **The forecast holds the east rims outgoing.** It calls South Malé's east-rim channels incoming only 11–17 % of
   hours and North Malé's 9–33 %; the simulation runs them in 30–45 %. The head term (τ = 0.25 h) outweighs the tide
   there, as in the first run.
3. **North Malé's north-east corner runs the other way round.** Furana South, Club Med Corner, Vah Kandu, Kagi,
   Prisca, Miyaru and Helengeli correlate −0.6 to +0.2 at lag 0 and 0.6–0.8 only 4–5 h apart: near half a tide
   out. These face the gap to Gaafaru, where the varying edge level now drives a flow along the chain.
4. **Strait walls agree 71 %, the simulation about 2 h behind the forecast.** The forecast makes them east 85–91 % of hours; the simulation 38–77 %.
   Its speeds (p95 0.2–0.5 m/s) stay below the owner's 0.8–1.2 m/s.
5. **Walls along the reef move a little more** (agree 73 %, p95 0.13 m/s): the edge level now varies along the chain,
   which gives a weak along-chain stream, still far short of the real one.
6. **Lagoon sites agree least** (63 %, correlation 0.09): the forecast runs them incoming 81 % of hours, the
   simulation 57 %.
7. **Benchmark fixtures:** the 10 scored curated reports at Kandooma Thila and Embudhoo Express on 27 Sep all disagree
   with the simulation, as in the first run. They are scenarios written from the tide, not dives.

![flood](figures/flow-flood.png) ![sites](figures/sites.png)

## How far to trust it

- **No ground truth.** Both models are judged against each other. Real dive reports are what decide.
- **Ten days is under a spring–neap cycle** (about 15 days). The timing comparison holds across tides; speeds
  reflect this stretch only.
- **The forcing is the ocean model's.** Levels from an 8 km model that does not resolve the atolls. If it gets the
  lag across the chain wrong, the east-rim phase moves with it.
- **The rim's openings are guessed.** Gaps between mapped reef are held 25 m deep. Speeds scale with the opening
  area: fewer or shallower openings mean faster channels. Real sill depths per channel would sharpen this most.
- **200 m cells** blur channels narrower than about 400 m and thilas; a pin often samples a cell 50–150 m away.
- **Depth-averaged**, no wind, no waves, no ocean drift imposed; the strait's 400 m cap is real, the ocean's is not.

## What it could become

- A longer window (15 days for a spring–neap cycle, 90 for a season) is a change to `domain.WINDOW`; about 12 s a
  simulated hour.
- Fit, per site, the simulated along-axis current to the ocean slope and the west–east head (a gain and a lag each).
  That would give the live model per-site constants grounded in physics without running a simulation in the app.
- Finer nests (50 m) round the dive-heavy rims, with sill depths from charts or the owner.

## Running it

```bash
python3 -m pip install -r sim/requirements.txt
python3 sim/fetch_terrain.py              # 113 tiles into sim/cache/ (gitignored)
python3 sim/grid.py                       # sim/out/grid.npz
python3 sim/forcing.py                    # fetches the edge levels into sim/cache/marine/
python3 sim/swe.py && python3 sim/export.py    # about 50 min for 10 days
npm run sim-compare                       # prints the tables, writes sim/out/chain/compare.json; fetches the
                                          # forecast's own sample points with curl if not cached
python3 sim/plot.py                       # sim/figures/
# the uniform-tide case: prefix each of forcing, swe, export, sim-compare and plot with SIM_CASE=uniform
# behind a proxy with its own CA, point Python at it: SSL_CERT_FILE=/path/to/ca.crt python3 sim/forcing.py
```
