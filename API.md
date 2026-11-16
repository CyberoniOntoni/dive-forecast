# JSON API (v1)

The API the Android app (`android/`) is built against. The routes are under `app/api/v1/` and are shaped by `lib/api-v1.ts`.
They wrap the same server actions the web pages use (`listSites`, `getSite`, `forecastSite`, `mapNowcasts`), so the
app and the site always show the same forecast. The forecast model is untouched.

## Rules

- **Versioning.** Every body carries `apiVersion` (now `1`). Adding a field is not a breaking change, so the app must
  ignore unknown fields. Removing or changing the meaning of a field means a new `/api/v2/` route, with `/v1` kept
  until old app versions are gone.
- **Model version.** Forecast bodies carry `modelVersion` (`FORECAST_MODEL_VERSION`). A report the app files later
  stores the prediction it was shown with that version, just like the web form.
- **Times.** Forecast and report times are Maldives wall-clock strings `YYYY-MM-DDTHH:MM` (UTC+5, no zone suffix).
  `fetchedAt` is Unix ms.
- **Caching.** Successful responses send `Cache-Control: public, max-age=300, stale-while-revalidate=86400`. The app
  should keep the last body for each site (Room) and show it with its `fetchedAt` age when it is offline.
- **Errors.** `{"error": {"code": "not_found" | "bad_request" | "unauthorized" | "needs_nickname" | "server_error",
  "message": "..."}}` with the matching HTTP status and `Cache-Control: no-store`. An app must treat an unknown code
  by its HTTP status. The message can be shown to the diver. A 500 never carries the internal
  error.
- **Privacy.** No email or diver id is ever in a response. Sites added in the app show `userAdded: true`, not who added
  them.
- **Methods.** Reads are GET. Writes are POST with an `application/json` body (anything else gets 415): a browser
  cannot send that to this site from another one without a CORS check, which this API never passes. The Cloudflare
  worker lets posts under `/api/v1/` through to the routes (`lib/request-guard.ts`), which answer the 415 themselves,
  and turns away other non-GET requests that are not server actions.
- **Signed in.** Endpoints about one diver take `Authorization: Bearer <token>` from
  `POST /api/v1/sign-in/token`, and only that: the web's cookie never signs an API write
  in. Without a header they answer 401 `unauthorized`; with an expired, forged or signed-out token too. Their
  responses are `Cache-Control: private, no-store`.

## Endpoints

The example values below show the shape of each response. They are not real data.

### `GET /api/v1/sites`

Every site on the map (the catalog and pins added in the app) and the atolls' names.

```json
{
  "apiVersion": 1,
  "atolls": [{ "id": "north-male", "name": "North Malé" }],
  "sites": [
    {
      "id": "banana-reef",
      "name": "Banana Reef",
      "atollId": "north-male",
      "lat": 4.2397,
      "lon": 73.5336,
      "siteType": "outer-reef",
      "siteTypeLabel": "Outer reef",
      "atollName": "North Malé",
      "userAdded": false,
      "sourceUrl": "https://…",
      "diveTopM": 5,
      "diveMaxM": 30,
      "approximatePin": false,
      "pinNote": null,
      "howToDive": null,
      "photoUrls": ["/site-photos/<site>/<photo>.jpg"]
    }
  ]
}
```

`siteType` is `pass | channel-thila | corner | outer-reef | lagoon | strait-wall`, or null when the site is not
classified; `siteTypeLabel` is the same in the site page's words ("Rim pass"). `photoUrls` are paths on this server.

### `GET /api/v1/sites/{id}`

One site in the same shape as an entry of `sites` above. Returns 404 `not_found` for an unknown or hidden site.

### `GET /api/v1/sites/{id}/forecast`

The site page's forecast: about a week of hours plus the sea state. The fields are listed one by one in
`apiForecast` (`lib/api-v1.ts`), so a field added to `SiteForecast` is not part of the API until it is added there.

| Field | Meaning |
|---|---|
| `hours[]` | `{ time, direction: "incoming" \| "outgoing", strength: "slack" \| "mild" \| "strong" \| "too_strong", confidence: "low" \| "medium" \| "high", levelM, glance }`. `glance` is below. |
| `forecastRoute`, `alongHeadingDeg`, `inwardBearingDeg`, `outgoingBearingDeg`, `bearingSource` | The inputs each hour's `glance` was built from: which model made the hours (`channel`, `along-reef`, `strait`, `lagoon`), the reef or flow heading off a channel, the inward and curved-outgoing headings (degrees from north), and where the inward one came from (`override`, `rim-derived`, `fallback`). For information only: a client draws `glance` and does not turn these into arrows or words itself. |
| `unavailable` | No forecast. Either there is no cached ocean series yet or the site has no atoll. |
| `stale`, `fetchedAt` | The hours come from the last cached series, and when it was fetched. |
| `seaState` | Per hour `{ time, band: calm \| moderate \| choppy \| rough, feltM, swell, windWaveM, wind, againstCurrent }`. `[]` when the waves failed to load. `null` when the site has no sea state. |
| `seaStale` | The sea state comes from an old cached wave or wind series; say so beside it, as the site page does. |
| `notice`, `siteNote` | Text the app must show with the forecast, as the site page does. |

Show `too_strong` as **"very strong"** (the glance's `label` already does). Whether it can be dived depends on the
diver.

#### `glance`

How the hour reads on screen, made on the server by `lib/nowcast-glance.ts` exactly as the web map and site page make
it, so the app draws what it is given and does not keep its own copy of the rules. Null when the hour has no arrow
(no bearing). The same object is on each nowcast `hour`.

| Field | Meaning |
|---|---|
| `arrowBearing` | Degrees clockwise from north. Bends at a curved channel's outgoing heading. |
| `way` | `incoming`, `outgoing`, or `running NE` on a wall, strait or lagoon site. |
| `spokenWay` | `way` in a sentence: adds "along the reef" at a wall. |
| `wayToward` | At a channel also where the water heads: `incoming, toward NE`. Same as `spokenWay` elsewhere. |
| `label` | Strength in words: `slack`, `mild`, `strong`, `very strong`. |
| `tone` | `incoming`, `outgoing`, `along` (no in/out colour), or `stop` (very strong). An unknown tone should draw no glance. |
| `opacity` | 0 to 1: lower confidence draws quieter. |
| `rank` | Sort order for a list, strongest first: 0 very strong to 3 slack. |
| `estimatedHeading` | The heading is the fallback estimate; say so. |

Returns 404 `not_found` for an unknown or hidden site.

### `GET /api/v1/nowcast`

Every site's forecast for the current Maldives hour, as the map's arrows show it. Like the forecast, each entry's
fields are listed one by one (`apiSiteNowcast` in `lib/api-v1.ts`). The body is for the hour of `maldivesWall`: an app
showing a saved copy later must not present it as the current hour.

```json
{
  "apiVersion": 1,
  "modelVersion": "tide+throughflow+head+alongreef+lagoon+strait/23",
  "maldivesWall": "2026-11-15T09:12",
  "nowcasts": [
    {
      "siteId": "banana-reef",
      "atollId": "north-male",
      "inwardBearingDeg": 41,
      "outgoingBearingDeg": null,
      "bearingSource": "rim-derived",
      "forecastRoute": "along-reef",
      "alongHeadingDeg": 131,
      "hour": {
        "time": "2026-11-15T09:00", "direction": "incoming", "strength": "mild", "confidence": "medium", "levelM": 0.12,
        "glance": {
          "arrowBearing": 131, "way": "running SE", "spokenWay": "running SE along the reef",
          "wayToward": "running SE along the reef", "label": "mild", "tone": "along", "opacity": 0.74, "rank": 2,
          "estimatedHeading": false
        }
      },
      "unavailable": false,
      "stale": false,
      "fetchedAt": 1763180000000
    }
  ]
}
```

This call never waits for a first ocean fetch. A site with no cached series comes back `unavailable` until the
warm-up has fetched it.

### `GET /api/v1/sites/{id}/reports`

Divers' newest reports at the site (at most 10), as the site page lists them. The words are made on the server
(`recentReportRows` in `lib/recent-reports.ts`); `ago` is from the time of the response. Kept for 60 s.

```json
{
  "apiVersion": 1,
  "siteId": "banana-reef",
  "reports": [
    {
      "time": "2026-11-15T08:00", "when": "Sat 15 Nov 08:00", "ago": "1 day ago", "way": "Running SE",
      "strength": "mild", "forecast": { "way": "Running SE", "strength": "strong", "match": "close" },
      "beforeAxis": false, "by": "Manta"
    }
  ]
}
```

`forecast` is what the site showed at that hour (null for a report that saved none); `match` is `match`, `close` or
`miss`. `by` is a nickname, null for a report from before sign-in. 404 for an unknown or hidden site.

## Sign-in and writes

### `POST /api/v1/sign-in/code`

`{"email": "diver@example.com"}`. Emails the same six-digit code as the web's sign-in page (`requestSignIn` in
`lib/account-actions.ts`, with its limits per address and per IP address), without the web's sign-in link: tapped
on the phone, it would sign the browser in and use up the code. Answers
`{"apiVersion": 1, "newUser": true}`: a new address picks a nickname on the next step. 400 with words for the diver
for a bad address or too many codes.

### `POST /api/v1/sign-in/token`

`{"email": "...", "code": "123456", "nickname": "Manta"}` (`nickname` only for a new address). Answers

```json
{ "apiVersion": 1, "token": "eyJ1Ijo...", "nickname": "Manta", "expiresAt": 1778900000000 }
```

The token carries the same session as the web's cookie, encrypted (`sealSession` in `lib/session-token.ts`) so the
diver's id in it cannot be read, and starts `app1.`; a cookie value does not work as a token. It is good for 180 days
(`expiresAt`, Unix ms), and ended by "Sign out everywhere" on either side. Treat it as opaque. The app keeps it out of
backups and sends it as `Authorization: Bearer <token>`. A new address without a usable nickname gets 400
`needs_nickname`; a wrong or expired code 400 `bad_request`. No cookie is set.

### `GET /api/v1/me`

Signed in. `{"apiVersion": 1, "nickname": "Manta", "points": 40, "monthPoints": 20, "reports": 2, "monthRank": 3,
"allRank": 7}`: never the email or the diver's id. 401 once the token no longer works, which is how the app learns it
was signed out.

### `POST /api/v1/sign-out-everywhere`

Signed in, body `{}`. Ends every session of the diver: this token, other phones and the web's cookies.

### `POST /api/v1/sites/{id}/reports`

Signed in. `{"time": "2026-11-15T08:00", "direction": "incoming" | "outgoing", "strength": "slack" | "mild" |
"strong" | "too_strong"}`: the dive's Maldives wall time and what the diver felt. At a wall, strait or lagoon site
`incoming` means toward the forecast's `alongHeadingDeg`, as on the web form. Checked exactly as the web form
(`addReport` in `lib/actions.ts`: not ahead of now, at most 14 days old, no duplicate), and saved with the prediction
the site showed at that hour, so it counts for `npm run verify` like a web report. Answers 201

```json
{
  "apiVersion": 1,
  "report": { "id": "…", "siteId": "banana-reef", "time": "2026-11-15T08:00", "direction": "outgoing", "strength": "mild" },
  "award": { "points": 15, "reasons": ["report", "fresh"], "uncounted": null }
}
```

`award` is what the report earned (`lib/points.ts`); `uncounted` says why it earned nothing (`daily-limit`,
`same-dive`). A report moves the next hours of the forecast, so refetch the forecast without the HTTP cache after
one. 400 with the form's own words for a report it refuses, 404 for an unknown site.

## Next (not built yet)

Ratings and reviews (with photos), dive plans, boat routes and the map layers. Each comes with its own section here.
