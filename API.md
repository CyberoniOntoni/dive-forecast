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
- **Caching.** Successful responses send `Cache-Control: public, max-age=300, stale-while-revalidate=86400`, unless
  the endpoint's section says otherwise (a diver's own data and boat routes are never kept, atoll outlines a day). The app
  should keep the last body for each site (Room) and show it with its `fetchedAt` age when it is offline.
- **Errors.** `{"error": {"code": "not_found" | "bad_request" | "unauthorized" | "forbidden" | "needs_nickname" |
  "server_error", "message": "..."}}` with the matching HTTP status and `Cache-Control: no-store`. An app must treat an unknown code
  by its HTTP status. The message can be shown to the diver. A 500 never carries the internal
  error.
- **Privacy.** No email or diver id is ever in a response. Sites added in the app show `userAdded: true`, not who added
  them.
- **Methods.** Reads are GET. Writes are POST or PUT with an `application/json` body (anything else gets 415), or
  DELETE with none. The exceptions are photos (`POST /api/v1/sites/{id}/photos` and `…/review/photos`), whose body is
  the `image/jpeg` itself. A browser cannot send any of these (that photo type included) to this site from another one
  without a CORS check, which this API never passes. The Cloudflare worker lets POST, PUT and DELETE under `/api/v1/` through to the routes
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
  "atolls": [{ "id": "north-male", "name": "North Malé", "bounds": { "south": 4.15, "west": 73.27, "north": 4.71, "east": 73.72 } }],
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
      "description": null,
      "howToDive": null,
      "howToDiveByAdder": false,
      "writtenBy": [],
      "writtenByLine": null,
      "photoUrls": ["/site-photos/<site>/<photo>.jpg"],
      "adderNickname": null
    }
  ]
}
```

`siteType` is `pass | channel-thila | corner | outer-reef | lagoon | strait-wall`, or null when the site is not
classified; `siteTypeLabel` is the same in the site page's words ("Rim pass"). `sourceUrl` is the web page a catalog site's position came from, or null for a pin added in the app and for a catalog site with no page to link. `photoUrls` are paths on this server.
`adderNickname` is who added a pin in the app (null on a catalog site, or once they deleted their account); a client
hides that site's `photoUrls`, and its `howToDive` while `howToDiveByAdder` is true, from a diver whose `blocked` list
(`GET /api/v1/me`) holds it, as the web does.
`description` and `howToDive` are the site's texts as divers wrote them together, each edit approved by a moderator
(`lib/site-wiki.ts`; edits are proposed on the web page's "About this site" card for now); `howToDiveByAdder` is true
while `howToDive` is still the adder's own text on a pin added in the app, and `writtenBy` the nicknames of the divers
whose approved edits wrote them, in the order they first did; `writtenByLine` is that credit as the web says it
("Written by Ann, Bob and Cy."), or null.
An atoll's `bounds` is the box round its outline, for saving the atoll for offline use; null when no outline is stored
(the app then pads the box round the atoll's sites).

### Imagery for saved atolls (outside `/api/v1`)

`GET /map-styles/sentinel2/<version>.json` (only the current version; others 404) is a MapLibre style holding only our Sentinel-2 imagery, for an app's offline
download of an atoll (a region definition needs a style URL). Its tiles are `GET /imagery/<version>/{z}/{x}/{y}.webp`,
zoom 8 to 14, cached for good (`public, max-age=31536000, immutable`; a new build gets a new version); a tile over
open ocean answers 204, an empty tile, cached a day (`public, max-age=86400`, so a later upload is picked up). The
app's own map style must use the same tile URL so MapLibre finds the saved tiles. Credit, as the map shows it
(`IMAGERY_ATTRIBUTION` in `lib/imagery.ts`): "Contains modified Copernicus Sentinel data 2023–2026".

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
  "modelVersion": "tide+throughflow+head+alongreef+lagoon+strait/24",
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
(`recentReportRows` in `lib/recent-reports.ts`); `ago` is from the time of the response. Kept for 60 s. With the
diver's token it also lists what only they may see (the store-review account's own reports) and is never kept; a token
the server turns down is read as none. The store-review account's reports are never in the shared answer.

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
"allRank": 7, "addedSiteIds": ["user-…"]}`: never the email or the diver's id. `addedSiteIds` are the sites the diver
added in the app, where only they can add photos (§ Adding sites). The account page's other fields are in
§ Scoreboard, divers and the account. 401 once the token no longer works, which is how the app learns it was signed
out.

### `POST /api/v1/sign-out-everywhere`

Signed in, body `{}`. Ends every session of the diver: this token, other phones and the web's cookies.

### Content rules, reports and blocking

Google Play's user-generated content policy, as on the web (`lib/moderation.ts`, rules at `/terms`):

- **Sign-in** (`POST /api/v1/sign-in/token`) takes `"acceptTerms": true`, the "I agree to the content rules and privacy
  policy" box. A first sign-in, or a diver who signed up before the rules, without it answers 400 `needs_terms`. A
  banned diver's sign-in answers 400 with the reason.
- `GET /api/v1/me` adds `acceptedTerms` (boolean) and `blocked` (nicknames). A diver with `acceptedTerms: false` who
  posts a review, photo, site or About me gets 400 "Agree to the content rules first…": the app asks, then calls
  **`POST /api/v1/me/terms`** (no body) → `{"apiVersion": 1, "acceptedTerms": true}`.
- **`POST /api/v1/flags`**, signed in: `{"kind": "review" | "site" | "diver" | "text", "siteId"?, "nickname"?, "reason",
  "note"?}`. A review is `siteId` + its author's `nickname`, a site added in the app is `siteId`, a diver is
  `nickname`, a site's texts written by divers (`description`, `howToDive` when `writtenBy` is not empty) are `siteId` and,
  optionally, the `nickname` of the diver who wrote the reported part (without it, the newest revision's). `reason` is one of `sexual`, `violence`, `hate`, `spam`, `privacy`, `illegal`, `other`; `note` at most
  500 characters. 201 `{"apiVersion": 1, "sent": true}`; 400 for one's own content, at 20 a day, or gone content.
  Moderators get an email and act at `/moderation` on the web.
- **`POST /api/v1/divers/{nickname}/block`** and **`DELETE`** the same, signed in → `{"apiVersion": 1, "blocked":
  true | false}`. A blocked diver's reviews and photos drop out of `GET /api/v1/sites/{id}/reviews` for the blocker,
  and `GET /api/v1/divers/{nickname}` answers `blockedByMe: true` with an empty `about`. Notes and photos on a site
  they added are hidden by the app from the site's `adderNickname` (site bodies are cached for everyone). A diver
  can block up to 500 others, so the list stays one small row.

### `DELETE /api/v1/me`

Signed in, no body. Deletes the diver's account and data, as the web's account page does (`deleteAccountRecords` in
`lib/accounts.ts`; what goes and what stays is on `/privacy`): the account, its pending codes, plans, ratings with
reviews and photos, and photos on sites it added. Dive reports stay with no name on them. Answers
`{"apiVersion": 1, "deleted": true}`; every token and cookie of the diver stops working. 401 when signed out or
already deleted. The app asks the diver to confirm first.

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
them: `{"apiVersion": 1, "planId", "dayIndex", "total": "4.2 nm by boat · about 35 min at 8 kn", "legs": [{"from": 0, "text": "2.1 nm · about 20 min at 8 kn",
"leaveBy": "Leave by 10:35", "tight": false, "tightNote": null, "note": null, "lengthKm", "minutes", "routed",
"points": [[lat, lon], …]}]}`. `from` counts the day's dives as the plan body lists them. Each day is a separate call,
since routing takes about a tenth of a second per leg. `total` is the plan page's day line (null with no legs); the app
draws `points` on the day's map, dashed where `routed` is false. 404 for an unknown plan or day.

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

## Map layers

The app's map has every web map layer. The Allen Coral Atlas overlays (reef outline, reef zones, bottom types) read the
same static tiles the web map does, `/overlays/<folder>/index.json` and its tiles (lib/atlas-overlays.ts), which are
files on the server rather than API endpoints; the depth layers come straight from OpenSeaMap's and GEBCO's WMS, as on
the web. Only the "Sheltered water" layer needs the endpoints below.

### `GET /api/v1/shelter?south=<deg>&west=<deg>&north=<deg>&east=<deg>[&time=YYYY-MM-DDTHH:00]`

The "Sheltered water" layer for a map view: each atoll's lagoon and the sea a few km round it, shaded by the felt wave
height at one hour, as the web map draws it (`getShelter`, `lib/shelter-grid.ts`, `lib/shelter-layer.ts`).

```json
{
  "apiVersion": 1,
  "time": "2026-11-16T14:00",
  "hours": ["2026-11-16T14:00", "2026-11-16T15:00"],
  "stale": false,
  "atolls": [
    { "wayId": "671807044", "layer": "coarse", "south": 3.85, "west": 73.3, "stepDeg": 0.0045, "rows": 144,
      "columns": 110, "values": "<base64>" }
  ],
  "scale": {
    "maxM": 2,
    "stops": [{ "m": 0, "color": "#26a678" }, { "m": 0.5, "color": "#e2cd40" }],
    "ticks": [{ "label": "Calm", "m": 0 }, { "label": "Moderate", "m": 0.5 }],
    "opacity": 0.85
  }
}
```

- `time` is the hour shown: the one asked for when it is in `hours`, else the current hour. `hours` are the hours that
  can be picked, from the current one for up to three days. `stale` is true when some waves come from an old series.
- Each entry of `atolls` is one atoll's grid: `rows` × `columns` cells of `stepDeg` degrees from the south-west corner
  (`south`, `west`), row 0 the southernmost. `layer` is `coarse` (500 m cells, always) or `fine` (125 m cells near the
  islands, only for a view of 0.6° or less each way, and cut to it). An atoll whose waves are not loaded yet is left out
  (its fetch starts; ask again in a moment); with no atolls at all, say so.
- `values` is base64, one byte per cell (`lib/shelter-field.ts`): the low 7 bits are the felt height in 0.02 m steps
  (0 to 123), or 124 another atoll's water (that atoll draws it), 125 water with no wave or wind data this hour (left
  clear), 126 an island, 127 past the grid (left clear, the sea fades out toward it). Bit 128 is set on water outside
  the atoll outline. The lagoon and the sea outside are drawn apart and cut along the outline from
  `/api/v1/shelter/shapes/{wayId}`, islands cut out, so the reef stays a sharp line; the app ports the web's drawing
  (`fieldPixels`: islands and the other side filled from their neighbours 3 cells deep, the sea fading out over 4 cells
  toward the grid's edge, fine cells over 2).
- `scale` is the colour scale: blend between `stops` by felt height, anything over `maxM` takes the last; `ticks` name
  points on the legend; draw the shading at `opacity`.
- 400 `bad_request` for a missing or upside-down view, one over 10° either way ("Zoom in on an atoll to see it."), or
  a malformed `time`. The web map asks from zoom 8 (MapLibre zoom 7).

### `GET /api/v1/shelter/shapes/{wayId}`

`{"apiVersion": 1, "wayId", "outline": [[lat, lon], …], "islands": [[[lat, lon], …], …]}`: an atoll's outline and
the islands in and round it, for cutting the shading. Changes only with a new build, so it is kept longer than the
other reads: `Cache-Control: public, max-age=86400, stale-while-revalidate=604800`.
404 for an unknown outline.

### `GET /api/v1/shelter/point?at=<lat>,<lon>&time=YYYY-MM-DDTHH:00`

The sea state at one tapped spot, traced on its own rather than read off the grid, as the web map's popup shows it:
`{"apiVersion": 1, "time", "inLayer": true, "seaState": {…}, "head": "Moderate · 0.7 m felt", "detail": "1.2 m swell
from SW, 11 s · 0.4 m wind chop · wind 14 kt from W. Mon 26 Oct, 21:00."}`. `seaState` is shaped as in a site's
forecast. Where the layer reaches but has no data that hour, `seaState` is null and the words say so. Where the layer
has no water to read (an island, or far from any atoll), `inLayer` is false and the rest null; the app then shows
nothing. 400 for a bad `at` or `time`.

## Ratings and reviews

A signed-in diver rates any site 1 to 5; the rating can carry a written review and up to 6 photos, all changeable or
removable, as on the web's site page (`components/SiteReviews.tsx`). Reviews never change the forecast. Writes take the
app's token (`Authorization: Bearer`), and each answers with the whole card below, `Cache-Control: private, no-store`.
A refusal is 400 with the web form's words ("Rate the site first, then write your review."), 401 when the token
stopped working, 404 for a site not on the map.

### `GET /api/v1/sites/{id}/reviews`

```json
{
  "apiVersion": 1,
  "siteId": "banana-reef",
  "summary": { "average": 4.2, "count": 5, "mine": 4 },
  "summaryLine": "4.2 from 5 divers",
  "reviews": [
    { "nickname": "Manta", "score": 5, "review": "Sharks at the corner.", "updatedAt": "2026-11-09T04:12:00.000Z",
      "date": "9 Nov 2026", "photos": [{ "id": "…", "url": "/site-photos/banana-reef/….jpg" }] }
  ],
  "mine": null,
  "ratingPoints": 3,
  "reviewMaxChars": 1500,
  "maxPhotos": 6
}
```

- `reviews` are other divers' with text or photos, newest first; `mine` is the signed-in diver's own (null signed out
  or unrated), so send the token to get it. Nicknames only, never a diver's id or email.
- Photo `url`s are paths on the site's host. `ratingPoints` is what a first rating earns (removing it takes them away;
  rating again gives them back, never anew).
- Without a token the answer is the same for everyone (the web's cookie is ignored here, so `mine` is null), with
  `Cache-Control: private, max-age=60`. With one, `private, no-store`; a token the server turns down (expired, or
  "Sign out everywhere") answers 401, so the app drops it and asks again without.

### `PUT /api/v1/sites/{id}/rating`, `DELETE /api/v1/sites/{id}/rating`

PUT `{"score": 4}` rates the site or changes the rating. DELETE removes the rating with its review and photos.

### `PUT /api/v1/sites/{id}/review`

`{"text": "…"}` writes or changes the review (at most `reviewMaxChars` characters, cleaned like the web's); empty text
clears it. The site is rated first.

### `POST /api/v1/sites/{id}/review/photos`, `DELETE /api/v1/sites/{id}/review/photos/{photoId}`

POST adds one photo to the diver's review: the body is the JPEG itself, `Content-Type: image/jpeg`, at most 1.5 MB.
The app shrinks it first as the web does (`lib/photo-shrink.ts`: long edge 1600 px, quality 0.82, turned upright,
since the server strips camera data, rotation included). Answers 201. 413 for a larger body, 415 for another type, 400
past 6 photos on the review or 24 review photos a day. DELETE takes one of the diver's own photos off and deletes it.

## Adding sites

A signed-in diver adds a dive site at a pin, as with the web map's "Add a site" form (`components/AddSiteForm.tsx`).
The pin's position (or, on the rim, the kind the diver picks) chooses the forecast model, as on the web
(FORECAST_MODEL.md § Pins added in the app). Depths and notes are only shown, never read by the forecast. At most 10
sites a day per diver. Writes take the app's token, and answers carry `Cache-Control: private, no-store`.

### `POST /api/v1/sites`

```json
{ "name": "Test Thila", "lat": 4.25, "lon": 73.45, "diverSiteType": "lagoon", "diveTopM": 8, "diveMaxM": 25,
  "howToDive": "Drop on the east side…", "rating": 4 }
```

Only `name` (1 to 80 characters), `lat` and `lon` (inside the Maldives) are needed. `diverSiteType` is one of `pass`
(channel), `corner` (channel corner), `lagoon` (inside the lagoon) or `outer-reef` (wall outside the atoll); leave it
out for "Not sure". Depths are metres, 0 to 100, shallowest first; `howToDive` at most 1500
characters; `rating` 1 to 5 is the adder's own (§ Ratings and reviews). Answers 201 `{"apiVersion": 1, "site": {…}}`
with the site as `GET /api/v1/sites/{id}` gives it. A refusal is 400 with the web form's words ("Site name is
required").

### `POST /api/v1/sites/{id}/photos`

The body is one JPEG (`Content-Type: image/jpeg`, at most 1.5 MB, shrunk on the phone to 1600 px as the web does).
Only the diver who added the site adds photos, up to 6; camera data is stripped before it is saved. Answers 201 with
the site, as above, its new photo last in `photoUrls`. 403 on a catalog site or another diver's, 404 for a site not on
the map, 413 for a larger body, 415 for another type, 400 for a file that is not a JPEG or a site that is full.

## Scoreboard, divers and the account

The web's scoreboard, divers' public pages and account page (`app/scoreboard`, `app/divers`, `app/account`), with
their words made on the server (`lib/profile-words.ts`). Nicknames only: a diver's page is found by nickname, so no
diver id reaches the app. The public reads mark the asker's own row only from the app's token: without one the web's
cookie is ignored and the answer is the same for everyone (`Cache-Control: private, max-age=60`); with one,
`private, no-store`, and a token the server turns down answers 401.

### `GET /api/v1/scoreboard?board=month|all|sites`

`month` (the default) and `all` rank current reporters by points; `sites` ranks divers by the sites they added and
lists the newest sites.

```json
{
  "apiVersion": 1,
  "board": "sites",
  "title": "Site scouts",
  "note": "Divers who added dive sites to the map, and how many of those other divers have since reported at.",
  "empty": "No sites added yet. …",
  "rows": [{ "rank": 1, "nickname": "Manta", "detail": "2 reported by other divers", "score": 3, "unit": "sites", "isMe": false }],
  "newest": [{ "siteId": "user-…", "name": "Test Thila", "nickname": "Manta" }]
}
```

On the reporters' boards `detail` reads "12 reports · 5 sites · 3 ratings · 2 ★", `score` is points and `unit` null;
`newest` is empty. At most 50 rows.

### `GET /api/v1/divers/{nickname}`

Any case. `{"apiVersion": 1, "nickname": "Manta", "about": "…", "sinceLine": "Diving with us since Oct 2026 · #3 all
time", "points": 40, "reports": 2, "reportSites": 2, "ratings": 1, "siteEdits": 0, "sitesAdded": 0, "allRank": 3, "badges": [{"id":
"first-report", "label": "First report", "detail": "Filed a first current report"}], "isMe": false}`: earned badges
only, never the email. 404 for a nickname nobody has (a renamed diver's old one included).

### `PUT /api/v1/me/about`, `PUT /api/v1/me/nickname`

Signed in. `{"about": "…"}` saves About me (at most `aboutMaxChars`, 300; cleaned as on the web; empty clears it) and
answers `{"apiVersion": 1, "about": "…"}`. `{"nickname": "…"}` renames the diver (2 to 20 letters, numbers, spaces,
dots, dashes or underscores, not taken in any case) and answers `{"apiVersion": 1, "nickname": "…"}`; the token keeps
working, and no web cookie is set. A refusal is 400 with the web form's words ("That nickname is taken.").

`GET /api/v1/me` also carries what the web's account page shows: `about`, `ratings`, `siteEdits` (approved site edits
that earned points), `reportSites`, `atolls`, every
badge with `earned`, `pointsRules` (the "How points work" lines) and `aboutMaxChars`.

## Next

With each plan day on its own map (from the legs' `points`) and the site list's atoll picker, nothing from the web is
missing from the app now. New web features come with their own section here.
