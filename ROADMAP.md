# Roadmap

The product is a Maldives dive-site current forecast for guides and liveaboard crews. At a named site and hour it says incoming or outgoing, how strong the current is, and how much to trust that call. Open ocean data is the base. Reports from boats teach the pass.

Marine-life forecasts, visibility as its own product, and 3D seafloor maps are not on this list. Those are what DiveSight and Marla already sell. This app is the current call those products leave open.

## Shipped

- Map of seeded Maldives sites with the current Maldives hour.
- Incoming or outgoing, strength (slack, mild, strong, too strong), and confidence.
- Arrow on each pin. Too-strong and low confidence are quieter or louder with the rest of the glance.
- Site page with a time slider for today and tomorrow, opened on the current hour.
- One strength for an incoming or outgoing run. Slack is the turn.
- After-dive report: direction and strength. The report stores the tide slope and can move the next forecast.
- Site quality rating. It does not change the current.
- Add a site that is not on the map yet.
- Published dive depths where a source printed them. Channel width and depth only for named channels with a printed measurement. Those numbers are shown. They do not invent a speed.
- Each site uses its own sea-level series, about 3 km seaward of the pin.
- Satellite map. The site page scrolls. The phone list starts as a drawer.

## Before production

The app is still a single-machine prototype. Reports sit in `data/store.json`. The ocean feed is Open-Meteo’s free non-commercial tier. `marineSeriesStale` turns a series older than twelve hours into an unavailable page. Do these actions before a crew uses the forecast as the call. Each one is done only when its check passes.

### The call has to be trustworthy

1. **Replay past reports before any hour can say high.** Add a script that, for each saved report, runs `forecastHours` with only reports stored earlier than that one and compares direction and strength. A confident hour that is wrong on direction fails the script. `confidenceFor` in `lib/forecast.ts` does not return `high` while the latest replay has a failure. Done when `npm test` includes a fixture where one wrong confident direction keeps every hour below high, and the script exits 0 on an empty or clean store.

2. **Fix or remove Kuda Haa.** Open the Purely Maldives fact sheet cited on that row and a page that names the Baa manta site. If the fact-sheet coordinate is not that Baa site, move the pin only when a cited Baa ocean point exists. Otherwise delete the row. Done when the site name on the source page matches the pin, and the atoll on the pin matches that page.

3. **Draw the tide on the site page.** Pass the residual sea-level series for today and tomorrow from the site load into `app/sites/[id]/page.tsx`. Draw it under the slider and mark the selected hour. Done when changing the slider moves the marker along that line and the incoming or outgoing word matches the slope at the mark.

4. **Paint too strong as a stop.** Add a stop color and use it for `too_strong` on the pin, in `CurrentOverlay`, and on `HourSlider`. Sort the now list as too strong, then strong, then mild, then slack. Done when a too-strong site is visually distinct from a strong one and sits at the top of the list.

### It has to work on the boat

5. **Show the last series when the feed is stale.** In `lib/load-site.ts`, a stale or failed refresh still returns the cached hours, the fetch time, and a stale flag. The site page and the map say when that series was fetched. They do not invent a tide when no cache exists. Done when a series older than twelve hours still shows direction and strength, with the age visible, and a site with no cache still says unavailable.

6. **Share one hour.** Accept `?at=` as a Maldives wall time on `/sites/[id]`. The slider opens on that hour. A control copies the URL. Done when opening the copied link on a second browser shows the same site, hour, direction, and strength.

7. **Shorten the report form.** In `components/ReportForm.tsx`, default the time to the current Maldives hour. Replace the radio lists with two direction buttons and four strength buttons. Done when a report can be saved in two taps after the time, and the saved report still has site, time, direction, and strength.

8. **Separate overlapping pins.** When several North Malé sites fall on the same screen point below zoom 10, spread those markers so each arrow can be tapped. Done when Banana Reef and its neighbors are separate targets at the default zoom.

9. **Finish the phone check.** At a 390 px width, confirm the map is at least half the screen, the now list starts collapsed, and every button and the zoom control is at least 44 px. Fix the ones that are smaller. Done when that pass finds no target under 44 px.

### It has to stay up for more than one crew

10. **Stop writing reports by rewriting one JSON file.** Keep the store functions in `lib/store.ts`, and make their writes safe when two requests add a report at the same time. Done when a test runs two overlapping adds and both reports are present afterward.

11. **Write down the ocean and map license, then comply.** Read the current Open-Meteo and Esri World Imagery terms. Record the decision in the README: stay on the non-commercial tier, or name the paid plan. If Esri’s terms do not allow this public map, switch the tile URL in `components/SiteMap.tsx`. Leave the Open-Meteo and SMOC attribution on the page. Done when the README states the decision and the live map matches it.

12. **Put the app on one HTTPS address.** Deploy the Next.js app. The fetch time and the attribution are visible on that URL. Done when that address loads the map and a site page.

## Later

Held back on purpose.

- A 3–4 dive slate for today or tomorrow, chosen from the boat’s reach.
- A wishlist for mantas, sharks, or whale sharks, as a property of the site.
- Other countries.
- A week-long slider. Crews plan the next morning here. A longer horizon is what DiveSight and Navionics already offer, and it can wait until today and tomorrow are trusted.
