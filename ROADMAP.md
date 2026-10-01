# Roadmap

The product is a Maldives dive-site current forecast for guides and liveaboard crews. At a named site and hour it says incoming or outgoing, how strong the current is, and how much to trust that call. Open ocean data is the base. Reports from boats teach the pass.

Marine-life forecasts, visibility as its own product, and 3D seafloor maps are not on this list. Those are what DiveSight and Marla already sell. This app is the current call those products leave open.

## Shipped

- Map of seeded Maldives sites with the current Maldives hour.
- Direction, strength (slack, mild, strong, very strong), and confidence. Channels show incoming or outgoing; outer walls and lagoon sites show a compass direction.
- Arrow on each pin. Very strong and low confidence are quieter or louder with the rest of the glance. Pins cluster when zoomed out, and the side list shows the sites in view.
- Site page with a time slider for about a week ahead, opened on the current hour.
- One strength for an incoming or outgoing run. Slack is the turn.
- After-dive report: direction and strength. The report stores the tide slope and can move the next forecast.
- Site quality rating. It does not change the current.
- Add a site that is not on the map yet.
- Published dive depths where a source printed them. Channel width and depth only for named channels with a printed measurement. Those numbers are shown. They do not invent a speed.
- Each site uses its own sea-level series, about 3 km seaward of the pin.
- Satellite map. The site page scrolls. The phone list starts as a drawer.
- A replay of past reports. A high-confidence hour with the wrong direction fails it, and `confidenceFor` will not return high while `data/replay.json` says the replay failed.
- Kuda Haa stays on North Malé. The Purely Maldives fact sheet names that coordinate. It is not the Baa manta site.
- The residual tide is drawn under the slider, with a marker on the selected hour.
- Very strong (stored as `too_strong`) uses a stop color on the pin, in the now list, and on the slider. The list sorts very strong, then strong, then mild, then slack. Very strong is rare: it takes the monsoon push, the head across the atoll or a narrow channel on top of a spring tide.
- A stale or failed refresh keeps the last cached hours and shows their age. No cache still says unavailable.
- 288 sites in 15 atolls, imported atoll by atoll from the Dive Maldives guide with owner review, each with a site type (rim pass, channel thila, outer reef, lagoon).
- Map layers that can each be switched on or off: satellite, street map, OpenSeaMap seamarks and depths, a coordinate grid, and Allen Coral Atlas reef outline, zones and bottom types.
- Monsoon through-flow: channels facing the monsoon current run in most of the day, the far side runs out.
- Outer walls run along the reef and turn with the tide; corners and walls at a channel mouth keep in and out.
- The level difference across each atoll, so channels on opposite rims can run opposite ways.
- Lagoon flow: thilas inside the atoll follow the water moving through the rim and channels.
- The model, its constants and its limits are written down in `FORECAST_MODEL.md`.

## Before production

Reports still sit in `data/store.json`. The ocean feed is still Open-Meteo’s free non-commercial tier. The map still uses Esri imagery. Do these actions before a crew uses the forecast as the call. Each one is done only when its check passes.

### It has to work on the boat

1. **Share one hour.** Accept `?at=` as a Maldives wall time on `/sites/[id]`. The slider opens on that hour. A control copies the URL. Done when opening the copied link on a second browser shows the same site, hour, direction, and strength.

2. **Shorten the report form.** In `components/ReportForm.tsx`, default the time to the current Maldives hour. Replace the radio lists with two direction buttons and four strength buttons. Done when a report can be saved in two taps after the time, and the saved report still has site, time, direction, and strength.

3. **Separate overlapping pins.** When several North Malé sites fall on the same screen point below zoom 10, spread those markers so each arrow can be tapped. Done when Banana Reef and its neighbors are separate targets at the default zoom. *Partly done: overlapping pins now group into numbered clusters that zoom in when tapped, and the side list shows every site in view. They are not yet separate targets at the default zoom.*

4. **Finish the phone check.** At a 390 px width, confirm the map is at least half the screen, the now list starts collapsed, and every button and the zoom control is at least 44 px. Fix the ones that are smaller. Done when that pass finds no target under 44 px.

### It has to stay up for more than one crew

5. **Stop writing reports by rewriting one JSON file.** Keep the store functions in `lib/store.ts`, and make their writes safe when two requests add a report at the same time. Done when a test runs two overlapping adds and both reports are present afterward.

6. **Write down the ocean and map license, then comply.** Read the current Open-Meteo and Esri World Imagery terms. Record the decision in the README: stay on the non-commercial tier, or name the paid plan. If Esri’s terms do not allow this public map, switch the tile URL in `components/SiteMap.tsx`. Leave the Open-Meteo and SMOC attribution on the page. Done when the README states the decision and the live map matches it.

7. **Put the app on one HTTPS address.** Deploy the Next.js app. The fetch time and the attribution are visible on that URL. Done when that address loads the map and a site page. *Done: the app runs at one HTTPS address with the fetch time and attribution on the page.*

## Later

Held back on purpose.

- A 3–4 dive slate for today or tomorrow, chosen from the boat’s reach.
- A wishlist for mantas, sharks, or whale sharks, as a property of the site.
- Other countries.
