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
- **Errors.** `{"error": {"code": "not_found" | "bad_request" | "unauthorized" | "forbidden" | "needs_nickname" |
  "server_error", "message": "..."}}` with the matching HTTP status and `Cache-Control: no-store`. An app must treat an unknown code
  by its HTTP status. The message can be shown to the diver. A 500 never carries the internal
  error.
- **Privacy.** No email or diver id is ever in a response. Sites added in the app show `userAdded: true`, not who added
  them.
- **Methods.** Reads are GET. Writes are POST or PUT with an `application/json` body (anything else gets 415), or
  DELETE with none: a browser cannot send any of these to this site from another one without a CORS check, which this
  API never passes. The Cloudflare worker lets POST, PUT and DELETE under `/api/v1/` through to the routes
  (`lib/request-guard.ts`), which answer the 415 (or a 405 for a method they do not take) themselves, and turns away
  every other non-GET request that is not a server action. `forbidden` (403) is a change to something that is another
  diver's, such as `PUT` on their plan; deleting it answers 404, as for a plan that is gone.
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
| `stale`, `fetchedAt` | `stale` is true when the series was fetched more than 12 hours ago (by age alone, whether or not a refresh is under way), when its newest hour is more than 12 hours before now, or when it is the last cached series after a failed fetch. `fetchedAt` is when it was fetched. |
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

## Dive plans

A plan's id is its share link's (`https://50bar.app/plans/<id>`): anyone with it reads the plan. The words come from
the plan page's own rules (`lib/plan-words.ts`), so the app and the page say the same thing. The signed-in owner makes,
changes and deletes plans with the bearer token; every write is checked by the web editor's own rules
(`requirePlanInput` in `lib/dive-plan.ts`) and refused in its words.

### `GET /api/v1/plans`

Signed in. The diver's own plans, newest change first:
`{"apiVersion": 1, "limits": {…}, "plans": [{"id", "title", "span": "17–23 Nov 2026", "size": "4 days · 11 dives", "first", "last", "updatedAt"}]}`.
`limits` is what the editor allows: `{"titleMax": 80, "notesMax": 1500, "diveNoteMax": 300, "daysMax": 16,
"divesPerDayMax": 6, "plansMax": 40, "boatSpeedMinKn": 3, "boatSpeedMaxKn": 40, "boatSpeedDefaultKn": 8,
"yearMin": 2020, "yearMax": 2100}`.

### `GET /api/v1/plan-sites`

Every site the editor can pick, by name, and the Maldives date a new plan starts on:
`{"apiVersion": 1, "today": "2026-11-17", "sites": [{"id": "kuda-haa", "name": "Kuda Haa", "atoll": "North Malé", "channel": true}]}`.
Only a `channel` dive takes a wanted way. `public, max-age=300`.

### `GET /api/v1/plans/{id}/edit`

Signed in, owner only (anyone else, or an unknown id: 404). The plan in the shape `POST` and `PUT` take, plus `id`,
`updatedAt` and `limits`:
`{"apiVersion": 1, "id", "title", "notes": null, "boatSpeedKn": 8, "days": [{"date": "2026-11-17", "stops": [{"siteId", "time": "09:00", "note": null, "want": "incoming"}]}], "updatedAt", "limits": {…}}`.

### `POST /api/v1/plans`, `PUT /api/v1/plans/{id}`, `DELETE /api/v1/plans/{id}`

Signed in. `POST` makes a plan from `{"title", "notes", "boatSpeedKn", "days": [{"date", "stops": [{"siteId", "time",
"note", "want"}]}]}` (a `null` reads as left out; days and dives are sorted on save; `want` is `incoming`, `outgoing` or
absent) and answers 201 `{"apiVersion": 1, "id"}`; the server picks the id. `PUT` replaces the owner's plan with the
same body (200, same answer); `DELETE` removes it (`{"apiVersion": 1, "id", "deleted": true}`) and its link stops
working. A body the editor refuses is 400 with its words (`"Give the plan a title"`, a full plan list), someone
else's plan 403 `forbidden` on `PUT` and 404 on `DELETE`, a deleted or unknown plan 404.

### `GET /api/v1/plans/{id}`

The plan as its page shows it (`apiPlan` in `lib/api-v1.ts`). `private, max-age=60`, since `isOwner` depends on the
token sent.

```json
{
  "apiVersion": 1, "id": "Kq7vHtmWpdNrcXfa", "title": "North Malé week", "notes": null, "boatSpeedKn": 8,
  "span": "17–23 Nov 2026", "ownerNickname": "Ann", "isOwner": false, "webPath": "/plans/Kq7vHtmWpdNrcXfa",
  "updatedAt": "2026-11-15T03:00:00.000Z", "nowWall": "2026-11-17T07:12",
  "days": [{
    "date": "2026-11-17", "label": "Tue 17 Nov", "today": true, "past": false, "toCheck": 1,
    "stops": [{
      "siteId": "kuda-haa", "name": "Kuda Haa", "lat": 4.31, "lon": 73.46, "facts": "Channel thila · North Malé · 5–30 m",
      "howToDive": null, "time": "09:00", "note": "Hook in on the corner.", "want": "Wanted: incoming",
      "status": "forecast", "message": null, "way": "Outgoing, toward W", "arrowBearing": 270, "strength": "Very strong",
      "veryStrong": true, "tone": "stop", "sea": "Sea moderate · 0.8 m", "seaRough": false, "confidence": "fairly sure",
      "confidenceLabel": "Forecast: fairly sure",
      "warnings": ["Very strong current at this time", "Running outgoing; you wanted incoming"],
      "better": "Better 13:00–15:00, best 14:00: incoming, toward E, mild.", "reportTime": null
    }]
  }]
}
```

`status` is `forecast`, `unavailable`, `beyond` (further ahead than the forecast reaches) or `past`; without a forecast
hour `message` says so. `veryStrong` and `seaRough` say when to show `strength` and `sea` in the warning colour, so a client never reads the
words. `tone` is the dive's marker colour: `incoming`, `outgoing`, `stop` (a warning) or `none`.
`reportTime` is set once the dive is over and still reportable (14 days): send it as the report's `time`. No diver id.
404 for an unknown id.

### `GET /api/v1/plans/{id}/days/{day}/legs`

The boat legs between day `day`'s dives (0-based), at the plan's boat speed with no current, as the plan page shows
them: `{"apiVersion": 1, "planId", "dayIndex", "legs": [{"from": 0, "text": "2.1 nm · about 20 min at 8 kn",
"leaveBy": "Leave by 10:35", "tight": false, "tightNote": null, "note": null, "lengthKm", "minutes", "routed",
"points": [[lat, lon], …]}]}`. `from` counts the day's dives as the plan body lists them. Each day is a separate call,
since routing takes about a tenth of a second per leg. 404 for an unknown plan or day.

## Boat navigation

### `GET /api/v1/boat-route?from=<lat>,<lon>&to=<destination>`

A boat route from the phone's position to a site (`to=<site id>`) or to a point picked on the map (`to=<lat>,<lon>`),
round the islands and reef the app knows of, with the forecast current along it: what the web's Navigate panel gets
from `getBoatRoute` (`lib/boat-route.ts`, `lib/route-current-data.ts`). Satellite outlines, not a chart.

```json
{
  "apiVersion": 1,
  "points": [[4.17, 73.51], [4.19, 73.52]],
  "lengthKm": 3.2,
  "directKm": 2.9,
  "routed": true,
  "gaps": [{ "lat": 4.18, "lon": 73.515, "widthM": 300, "shallow": false }],
  "current": {
    "stepKm": 0.25,
    "samples": [0, 0, 1, -1],
    "sources": [
      { "siteId": "banana-reef", "name": "Banana Reef",
        "hours": [{ "timeMs": 1763269200000, "eastKn": 0.57, "northKn": -0.57, "strength": "mild" }] }
    ]
  }
}
```

- `points` are `[lat, lon]` from the boat to the destination; with `routed: false` no way through the known water was
  found and they are the straight line. `gaps` are the outline gaps the route goes through, in order; `shallow` is a
  reef-flat sill (check the depth).
- `current` is null when it could not be read; the route still stands. `samples` has one entry every `stepKm` along
  the route from its start: an index into `sources`, or `-1` where no forecast covers it (inside a lagoon away from
  sites). A source is a site's forecast near the route (`siteId` set; its arrow heading at a typical speed for its band,
  `strength` the band) or the ocean model offshore (`siteId` and `strength` null). `hours` run from an hour before now
  for 12 hours; `timeMs` is Unix ms at the start of each hour, and an hour counts for 90 minutes either side.
- The app works out the steer bearing, the time-stepped ETA and the very-strong warnings itself, from these, as the web
  panel does (`lib/route-current.ts`).
- `Cache-Control: no-store`. Ask again at most every 20 seconds, and only when the boat is 300 m off the route.
- `from` and a point `to` are `<lat>,<lon>` with at most two digits before the latitude's point and three before the
  longitude's, on the globe. A `to` with a comma is always a point (no site id holds one).
- 400 `bad_request` for a missing or bad `from` or `to`, or a start or point outside the Maldives (the message says
  which). 404 only for a site id that is not on the map.

## Next (not built yet)

Ratings and reviews (with photos) and the map layers. Each comes with its own section here.
