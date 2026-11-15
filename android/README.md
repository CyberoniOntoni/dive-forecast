# 50bar for Android

The dive-current forecast as a phone app. It reads the web app's JSON API (`/api/v1`, contract in `../API.md`),
so it shows exactly what the site shows and never runs the model itself.

Version 1 is read-only:

- **Map**: every site with an arrow pointing the way the water runs at the current Maldives hour, coloured and faded like
  the web pins (incoming teal, outgoing amber, along a reef foam, very strong the stop colour; low confidence fainter).
  Satellite (Esri World Imagery) or OpenStreetMap base. Tap an arrow to open the site.
- **Now list**: the bottom sheet lists the sites strongest first, as the web list does, with a search by site or atoll.
- **Site page**: a slider over the week, opened on the current Maldives hour; strength bars, residual tide and sea
  state for every hour; the hour's direction, strength, confidence and sea state; the server's `notice` and `siteNote`;
  depths, how to dive it, photos, the source; share the hour as text (site, Maldives time, way and strength) with the site's link (`https://50bar.app/sites/<id>`;
  not `?at=`, which on the web only fills the report form's dive time).
- **Offline**: the last body of each endpoint is kept in Room as raw JSON and shown with its age when the server
  cannot be reached (API.md § Caching). A 404 is never hidden behind an old copy.

Sign-in, reports and ratings stay on the web until the API has them (API.md § Next).

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
| `data/db/` | Room: the last raw body per endpoint |
| `data/DataRepository.kt` | Network first, then the last copy |
| `domain/Glance.kt` | Reads the server's `glance` (arrow heading, "incoming" / "running NE along the reef", tone, rank) |
| `domain/MaldivesTime.kt` | Maldives wall-clock strings (UTC+5), never the phone's zone |
| `ui/map/` | MapLibre map, now list |
| `ui/site/` | Site page, hour strip |

The display rules live only on the server (`lib/nowcast-glance.ts`, put on every hour by `lib/api-v1.ts`): the app
draws the glance it is given, so a wording change ships with the server. Site kinds come as `siteTypeLabel`.

## Rules carried over from the API

- Ignore unknown fields, and read enums through the `of()` helpers: a value the app does not know gives null, so it
  draws no arrow instead of a wrong one, and never fails a whole body.
- A saved nowcast is for its own hour: once the Maldives hour has moved on, the map shows no arrows from it.
- Times are Maldives wall-clock `YYYY-MM-DDTHH:MM`; parse them with `MaldivesTime`, not `LocalDateTime.now()`.
- Show `notice` and `siteNote` with the forecast.
- No diver id or email is ever in a response, and the app asks for none.
