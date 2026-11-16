# 50bar for Android

The dive-current forecast as a phone app. It reads the web app's JSON API (`/api/v1`, contract in `../API.md`),
so it shows exactly what the site shows and never runs the model itself.

What it does:

- **Map**: every site with an arrow pointing the way the water runs at the current Maldives hour, coloured and faded like
  the web pins (incoming teal, outgoing amber, along a reef foam, very strong the stop colour; low confidence fainter).
  Satellite (Esri World Imagery) or OpenStreetMap base. Tap an arrow to open the site.
- **Now list**: the bottom sheet lists the sites strongest first, as the web list does, with a search by site or atoll.
- **Site page**: a slider over the week, opened on the current Maldives hour; strength bars, residual tide and sea
  state for every hour; the hour's direction, strength, confidence and sea state; the server's `notice` and `siteNote`;
  depths, how to dive it, photos, the source; share the hour as text (site, Maldives time, way and strength) with the site's link (`https://50bar.app/sites/<id>`;
  not `?at=`, which on the web only fills the report form's dive time).
- **Sign-in and reports**: the web's email-code sign-in (a new diver picks a nickname) gives the app its own token
  (`POST /api/v1/sign-in/token`), kept in shared prefs file `session`, out of backups. On a site page, "Report the
  current" as on the web: this hour or up to 3 h ago in one tap or another day and time, then "As forecast" in one
  tap or which way and how strong, in the site's own words (`reportWays`); what it earned comes back in words. Recent
  reports are listed below it. The map's top-left chip opens sign-in or the account (points, sign out, sign out
  everywhere). A 401 from the server means the token stopped working, and the app forgets it.
- **Offline**: the last body of each endpoint is kept in Room as raw JSON and shown with its age when the server
  cannot be reached (API.md § Caching). A 404 is never hidden behind an old copy.

Ratings and reviews, adding sites, dive plans, boat navigation and the extra map layers are on the web for now (API.md
§ Next).

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
| `data/session/`, `data/AccountRepository.kt` | The signed-in diver's token; sign-in and reports |
| `data/db/` | Room: the last raw body per endpoint |
| `data/DataRepository.kt` | Network first, then the last copy |
| `domain/Glance.kt` | Reads the server's `glance` (arrow heading, "incoming" / "running NE along the reef", tone, rank) |
| `domain/MaldivesTime.kt` | Maldives wall-clock strings (UTC+5), never the phone's zone |
| `ui/map/` | MapLibre map, now list |
| `ui/site/` | Site page, hour strip, report form, recent reports |
| `ui/account/` | Sign-in and account |

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
