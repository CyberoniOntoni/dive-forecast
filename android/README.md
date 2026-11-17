# 50bar for Android

The dive-current forecast as a phone app. It reads the web app's JSON API (`/api/v1`, contract in `../API.md`),
so it shows exactly what the site shows and never runs the model itself.

What it does:

- **Look and layout** ("Tideline", `ui/theme/`): deep navy behind everything, the current's colours carry the answer
  (incoming teal, outgoing amber, very strong red, along a reef foam) and a pale blue is kept for the tide. The Material
  display, headline and titleLarge styles (the answer, big numbers, screen titles) are set in Space Grotesk with
  tabular figures, every other style in Inter; both are bundled (`res/font/`) under the SIL
  Open Font License (`licenses/`). A bottom bar (`ui/components/TabBar.kt`) holds the four top screens: Now (the map),
  Plans, Navigate and You (sign-in or the account). It shows only on those screens, each sitting right on the map, so
  Back from any of them goes to the map.

- **Map**: every site with an arrow pointing the way the water runs at the current Maldives hour, coloured and faded like
  the web pins (incoming teal, outgoing amber, along a reef foam, very strong the stop colour; low confidence fainter).
  Satellite (Esri World Imagery) or OpenStreetMap base. Tap an arrow to open the site.
- **Now list**: the bottom sheet lists the sites strongest first, as the web list does, with the web's search (every word starts a word of the site's or atoll's name; `domain/SiteSearch.kt`) and its atoll
  picker, which also moves the map to that atoll.
- **Site page**: a slider over the week, opened on the current Maldives hour; strength bars, residual tide and sea
  state for every hour; the hour's direction, strength, confidence and sea state; the server's `notice` and `siteNote`;
  depths, how to dive it, photos, the source; share the hour as text (site, Maldives time, way and strength) with the site's link (`https://50bar.app/sites/<id>`;
  not `?at=`, which on the web only fills the report form's dive time).
- **Sign-in and reports**: the web's email-code sign-in (a new diver picks a nickname) gives the app its own token
  (`POST /api/v1/sign-in/token`), kept in shared prefs file `session`, out of backups. On a site page, "Report the
  current" as on the web: this hour or up to 3 h ago in one tap or another day and time, then "As forecast" in one
  tap or which way and how strong, in the site's own words (`reportWays`); what it earned comes back in words. Recent
  reports are listed below it. The You tab opens sign-in or the account (points, sign out, sign out
  everywhere). A 401 from the server means the token stopped working, and the app forgets it.
- **Dive plans**: plans made on the web (`/plans/new`) open in the app: a shared `https://50bar.app/plans/<id>` link
  (the app offers itself for `/plans/<id>` only, so the web editor's `/plans/new` and `/plans/<id>/edit` stay in the browser; not verified, so Android asks which app to use), a pasted link on the Plans
  screen (the Plans tab, or "My dive plans" on the account), or the diver's own plans when signed
  in. Each day shows its dives on a small satellite map, numbered and coloured as on the web with the boat route between
  them (`ui/plan/PlanDayMap.kt`), then lists them with the forecast at the dive time, warnings and a better window, the
  boat legs between them, and "Report the current" once a dive is over, which opens the site's report form at the dive time. The last copy
  of a plan is kept for use out of signal. Signed in, "New plan" on the Plans screen and "Edit plan" on your own plan
  open the editor: title, trip notes, boat speed, then days with their dives (site from a searchable list, time,
  note, and at a channel the current you want), checked with the web editor's rules before saving. Delete is there too.
- **Boat navigation**: "Navigate here by boat" on a site page, the Navigate tab (sites nearest first, with a
  search), or a long press on the map for a point. The screen follows the phone's GPS while it is open (and keeps the
  screen on), asks the server for a route round the islands and reef (`GET /api/v1/boat-route`, the web's route and
  its forecast current), and shows distance left, speed, the steer allowing for the current, the ETA with the current
  each stretch has when the boat gets there, and the web panel's warnings (very strong current ahead, a shallow
  reef-flat gap, a current the boat cannot beat). It asks again when the boat is 300 m off the route, at most every
  20 seconds. The steer and ETA are worked out in the app (`domain/BoatNav.kt`, `domain/RouteCurrent.kt`,
  `domain/NavReadout.kt`), ported from `lib/boat-nav.ts` and `lib/route-current.ts` with their tests. Location comes
  from the platform `LocationManager` (no Play services), only while the screen is started. Satellite outlines, not a
  chart.
- **Ratings and reviews**: the site page's "Ratings and reviews" card, as the web's: the average, other divers'
  reviews with their photos, and, signed in, the diver's own score 1 to 5, written review and up to 6 photos, each
  changeable or removable (`/api/v1/sites/{id}/reviews`, `/rating`, `/review`, `/review/photos`). Photos come from the
  system photo picker (no storage permission) and are shrunk on the phone as the web's picker does them
  (`ui/site/PhotoShrink.kt`: turned upright, 1600 px, JPEG), then sent one by one.
- **Map layers**: the map's "Layers" chip has the web map's menu: the base (satellite, street map or none) and every
  overlay, kept between launches. Seamarks and the coordinate grid start on, as on the web, and depth shading or
  contours over satellite show the street map instead. The Allen Coral Atlas reef
  outline, reef zones and bottom types read the web map's static tiles under `/overlays/` (`domain/AtlasOverlay.kt`,
  `ui/map/AtlasViewModel.kt`: only tiles in view, from each overlay's zoom) with the web's colour key; depth shading
  (GEBCO), sonar depths and depth contours come from the same WMS servers as the web; the grid ports the web's spacing
  and chart labels (`domain/CoordinateGrid.kt`). "Sheltered water" shades each lagoon and the sea
  round it shaded by felt wave height, with the web legend's hour picker and a tap readout (`GET /api/v1/shelter`,
  `/shelter/shapes/{wayId}`, `/shelter/point`). The shading is drawn as the web draws it: `domain/ShelterField.kt` ports
  `fieldPixels` (checked pixel for pixel against it), and `ui/map/ShelterRaster.kt` scales each atoll's cells up and
  cuts them to its outline and islands once, where the web cuts on screen.
- **Offline**: the last body of each read endpoint except boat routes and the sea state layer (about one position or
  view) is kept in Room as raw JSON and shown with its age when the server
  cannot be reached (API.md § Caching). A 404 is never hidden behind an old copy.

- **Adding sites**: long-press the map on the site's spot (the list's + says so) and pick "Add a dive site here": the
  web form's name, kind of site, depths, how to dive it, the adder's rating and up to 6 photos, sent one by one after
  the site is added (`POST /api/v1/sites`, `/sites/{id}/photos`; `domain/NewSite.kt` makes the server's checks first, in its words). The
  new site's page opens in the form's place, and the map reads the list again. On a site they added, the diver can add
  more photos from its page (`addedSiteIds` from `GET /api/v1/me`).

- **Scoreboard and divers**: the account screen, or "See the scoreboard" on the signed-out You tab, opens the web's three boards (this month, all time, new sites;
  `GET /api/v1/scoreboard`), your own row marked; a nickname opens that diver's public page (`/api/v1/divers/{nickname}`:
  found by nickname, so no diver id reaches the app). The account screen has what the web's account page has: numbers,
  every badge, how points work, About me and the nickname (`PUT /api/v1/me/about`, `/me/nickname`), and your own page.
  The words come from the server (`lib/profile-words.ts`).

Nothing from the web is missing from the app now (API.md § Next).

## Build and run

Open `android/` in Android Studio, or from this folder:

```bash
./gradlew testDebugUnitTest      # unit tests (no device)
./gradlew installDebug           # build and install on a connected device or emulator
```

Gradle needs a JDK 17+; Android Studio's own (`<Studio>/jbr`) works as `JAVA_HOME`.

### Which server

| Build | Server |
|---|---|
| release | `https://50bar.app` |
| debug | `http://10.0.2.2:3000`: the Next.js dev server (`npm run dev` in the repo root) as the emulator sees it |

Point a debug build elsewhere with `-PdevApiBaseUrl=…` or a `devApiBaseUrl=…` line in `~/.gradle/gradle.properties`.
On a physical phone over USB: `adb reverse tcp:3000 tcp:3000` and `-PdevApiBaseUrl=http://localhost:3000`. Plain
HTTP is allowed only in debug builds and only to `10.0.2.2`, `localhost` and `127.0.0.1`
(`app/src/debug/res/xml/network_security_config.xml`).

Share links and "Open on the web" always go to `https://50bar.app` (`BuildConfig.WEB_URL`).

## Layout

| Path | What |
|---|---|
| `data/api/` | The /api/v1 bodies (kotlinx.serialization, unknown fields ignored) and the OkHttp client |
| `data/session/`, `data/AccountRepository.kt` | The signed-in diver's token; sign-in and every write |
| `data/db/` | Room: the last raw body per endpoint |
| `data/DataRepository.kt` | Network first, then the last copy |
| `domain/Glance.kt` | Reads the server's `glance` (arrow heading, "incoming" / "running NE along the reef", tone, rank) |
| `domain/MaldivesTime.kt` | Maldives wall-clock strings (UTC+5), never the phone's zone |
| `ui/map/`, `domain/AtlasOverlay.kt`, `domain/CoordinateGrid.kt`, `domain/ShelterField.kt` | MapLibre map, now list, layers (Atlas, depth, grid, sheltered water) |
| `ui/site/`, `domain/NewSite.kt` | Site page, hour strip, report form, recent reports, reviews, adding a site |
| `ui/account/` | Sign-in and account (About me, nickname, badges) |
| `ui/scoreboard/` | Scoreboard and divers' public pages |
| `ui/plan/`, `domain/PlanLink.kt` | Plan pages, my plans, reading a plan id from a link |
| `ui/nav/`, `domain/BoatNav.kt`, `domain/RouteCurrent.kt`, `domain/NavReadout.kt` | Boat navigation: GPS, route map, steer and ETA |

The display rules live only on the server (`lib/nowcast-glance.ts`, put on every hour by `lib/api-v1.ts`): the app
draws the glance it is given, so a wording change ships with the server. Site kinds come as `siteTypeLabel`.

## Rules carried over from the API

- Ignore unknown fields, and read enums through the `of()` helpers: a value the app does not know gives null, so it
  draws no arrow instead of a wrong one, and never fails a whole body.
- A saved nowcast is for its own hour: once the Maldives hour has moved on, the map shows no arrows from it.
- Times are Maldives wall-clock `YYYY-MM-DDTHH:MM`; parse them with `MaldivesTime`, not `LocalDateTime.now()`.
- Show `notice` and `siteNote` with the forecast.
- No diver id or email is ever in a response. The app asks for an email only to send a sign-in code, and keeps only
  the token and nickname.
- Map label glyphs come from the app's own server (`public/map-fonts/`), not MapLibre's demo server.

## Why the app lives in this repo

Decided 16 Nov 2026: the app stays in the web repo, in `android/`, rather than a repo of its own.

- **The app and the API change together.** The server decides how an hour reads (arrow, words, tone) in
  `lib/nowcast-glance.ts` and `lib/api-v1.ts`, and the app only draws it. A change to the contract (`API.md`) and both
  sides of it lands in one PR with one CI run, with no second PR to merge in step.
- **The builds are already apart.** The `android` CI job runs on its own; Docker (`.dockerignore`), lint, TypeScript
  and the Cloudflare build ignore `android/`.
- **One developer.** A second repo would mostly add a second set of branches and issues to keep in step.

Move the app to its own repo when one of these comes true: someone else owns the app, it gets its own release flow
with signing keys and Play Store uploads as CI secrets that are better fenced off, an iOS app joins it so the API
becomes a contract between several clients, or one part goes open source and the other does not.
