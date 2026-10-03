# Shallow-water simulation of North and South Malé (research prototype)

A depth-averaged hydrodynamic simulation of North Malé, South Malé, Vaadhoo Kandu between them and the sea round
them, with the islands and shallow reefs in it, run over 25–30 Sep 2026 and compared site by site with the forecast
the app showed for the same ocean. It is offline research: nothing here feeds the forecast, the model version is
unchanged, and CI does not run it.

North and South Malé were picked together: North Malé has the most dive sites (77), South Malé (33) holds the only
benchmark fixtures that fall in the cached window, and the strait between them is where the app runs its hand-set
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
  reef flats, islands as walls. Numba, about 13 s per simulated hour on 4 cores.
- **Forcing** (`forcing.py`): the cached Open-Meteo series in `data/benchmark-marine-cache`, the only ocean data in
  the repo (the marine API was not reachable from the session that built this).
  - East edge: the mean sea level of three points east of the atolls (they agree within 2 cm).
  - West edge: one point in the inner sea off North Ari. It runs up to ±0.15 m off the east level through the tide,
    because the tide crosses the double chain of atolls with a lag. That head across the chain is the second driver.
  - The north and south edges are walls drawn through Gaafaru and Vaavu, so that head drops across the atolls and
    the gaps between them instead of running round the domain's ends.
  - Only levels are imposed; every current inside comes from the levels, the depths and friction. The ocean model's
    current is not imposed (forcing it at the edges pushes the whole drift against a chain that blocks the section).
- **Two cases** (`SIM_CASE`): `chain` drives the edges as above; `uniform` gives both edges the east level, leaving
  only the tide's rise and fall, to separate the two drivers.
- **Comparison** (`npm run sim-compare`, `scripts/sim-compare.ts`): runs `loadSite` for every site with Open-Meteo
  stubbed by the same cached series (a point west of its atoll's centre gets the inner-sea series, others the
  nearest east point), so the forecast's head term sees the same west–east difference. The simulated current at the
  nearest open-water cell to each pin is projected on the axis the app shows for the site. Hours: 26 Sep 00:00 to
  30 Sep 11:00 (the first day is spin-up; the forecast has no 25-hour mean in its last 12 hours).

## Findings (chain case)

| Kind | Sites | Direction agrees* | Correlation | Best lag (h)† | Sim p95 speed | Sim hours in | Forecast hours in |
|---|---|---|---|---|---|---|---|
| Channel | 44 | 58 % | 0.03 | −4 | 0.40 m/s | 45 % | 20 % |
| Along the reef | 25 | 58 % | 0.25 | +1 | 0.12 m/s | 37 % | 62 % |
| Lagoon | 34 | 59 % | 0.41 | −2 | 0.25 m/s | 56 % | 60 % |
| Strait wall | 7 | 86 % | 0.62 | −1 | 0.35 m/s | 56 % | 79 % |

\* Of the hours both call non-slack. † Median over sites; negative means the simulation turns that many hours before
the forecast. Full per-site output: `sim/out/chain/compare.txt` after a run.

1. **The head across the chain drives the channels; the lagoon filling barely does.** With one uniform tide on
   both sides, channel currents in the simulation peak at about 0.05 m/s (p95): the lagoons fill and drain through
   so many openings that the flow is slow. With the inner sea and the ocean at their own levels, the same channels
   reach 0.2–0.9 m/s. The forecast's head term (`H / τ`) is the right idea; in the simulation it is the main driver,
   not a correction.
2. **West-rim channels agree; east-rim channels turn 3–5 hours earlier.** Channels on the west rims (Madi, Kuda,
   Ziyaarai, Bodu Hithi Thila; Vaagili, Ran Faru, Ramm Faru, Lhohi, Rannalhi) agree on direction 70–100 % of hours,
   correlate 0.6–0.8 and lead by 0–2 h. Channels on the east rims (HP Reef, Lankan, Furana, Kani Corner, Kandooma,
   Embudhoo, Cocoa, Guraidhoo and the rest) agree only about half the time, yet correlate 0.6–0.8 once the forecast
   is moved 3–5 h earlier: the same rhythm, a different phase. The east-rim flow follows the cross-chain head, which
   runs about a quarter-cycle ahead of the ocean's rise and fall that the forecast's slope keys on.
3. **The forecast holds the east rims outgoing.** Fed this west–east difference, the forecast calls east-rim
   channels incoming only 10–20 % of hours: with τ = 0.25 h its head term outweighs the tide. The simulation runs
   them in about 45 % of hours. So the head term is very sensitive to what the ring points get, and in the app each
   ring point has its own Open-Meteo series, not one inner-sea point.
4. **Strait walls agree best** (86 %, lag −1 h), so the hand-set strait model's timing matches the physics. The
   simulation is not east-dominant (56 % of hours) because these levels carry only +0.5 cm mean head across the
   chain; the forecast's drift gain makes it east 79 % of hours. Its speeds (p95 0.2–0.5 m/s) are below the owner's
   0.8–1.2 m/s.
5. **Walls along the reef barely move** in the simulation (p95 0.12 m/s): it has no tidal stream along the chain,
   because only levels are imposed and the domain's ends are walls. This comparison says nothing useful about walls.
6. **Lagoon sites split:** those near west-rim channels agree well (Kagi, Funadhoo, Z Reef, Peak, Eri Faru, 70–97 %,
   lag −1 to −2 h); those in the south-east of North Malé (Banana Reef, Maagiri, Nassimo, Chicken Island) do not.
7. **Benchmark fixtures:** the 11 curated reports at Kandooma Thila and Embudhoo Express on 27 Sep (incoming on the
   morning flood, outgoing on the night ebb) all disagree with the simulation, which runs those east-rim channels out
   on that flood. The fixtures are scenarios written from the tide, not dives, so this marks a question, not a fault.

![flood](figures/flow-flood.png) ![sites](figures/sites.png)

## How far to trust it

- **No ground truth.** Both models are judged against each other. Real dive reports are what decide.
- **The forcing is thin.** Six days from one inner-sea point and three ocean points, all from the 8 km ocean model.
  Finding 2 rests on that one inner-sea series' tidal phase; if the ocean model gets the lag across the chain wrong,
  the east-rim phase moves with it.
- **The rim's openings are guessed.** Gaps between mapped reef are held 25 m deep. Speeds scale with the opening
  area: fewer or shallower openings mean faster channels. Real sill depths per channel would sharpen this most.
- **200 m cells** blur channels narrower than about 400 m and thilas; a pin often samples a cell 50–150 m away.
- **Depth-averaged**, no wind, no waves, no ocean drift imposed; the strait's 400 m cap is real, the ocean's is not.

## What it could become

- Re-run with live Open-Meteo levels round the whole domain (ring points both sides) over 90+ days, ideally covering
  the NE monsoon too. Needs network access to marine-api.open-meteo.com.
- Fit, per site, the simulated along-axis current to the ocean slope and the west–east head (a gain and a lag each).
  That would give the live model per-site constants grounded in physics without running a simulation in the app.
- Finer nests (50 m) round the dive-heavy rims, with sill depths from charts or the owner.

## Running it

```bash
python3 -m pip install -r sim/requirements.txt
python3 sim/fetch_terrain.py              # 122 tiles into sim/cache/ (gitignored)
python3 sim/grid.py                       # sim/out/grid.npz
python3 sim/forcing.py && python3 sim/swe.py && python3 sim/export.py    # about 30 min
npm run sim-compare                       # prints the tables, writes sim/out/chain/compare.json
python3 sim/plot.py                       # sim/figures/
# the uniform-tide case: prefix each of forcing, swe, export, sim-compare and plot with SIM_CASE=uniform
```
