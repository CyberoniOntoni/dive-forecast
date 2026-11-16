# JSON API (v1)

The read API the Android app (`android/`) is built against. The routes are under `app/api/v1/` and are shaped by `lib/api-v1.ts`.
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
- **Errors.** `{"error": {"code": "not_found" | "bad_request" | "server_error", "message": "..."}}` with the matching
  HTTP status and `Cache-Control: no-store`. The message can be shown to the diver. A 500 never carries the internal
  error.
- **Privacy.** No email or diver id is ever in a response. Sites added in the app show `userAdded: true`, not who added
  them.
- **Methods.** GET only for now. The Cloudflare worker turns away any non-GET request that is not a server action
  (`lib/request-guard.ts`), so the write endpoints will need an exception for `/api/v1/` there.

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
| `stale`, `fetchedAt` | `stale` is true when the hours come from a series fetched over 12 hours ago (its refreshes are failing) or the last cached one after a failed fetch; `fetchedAt` is when it was fetched. |
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

## Next (not built yet)

1. **Sign-in for the app.** The same email-code flow returns a bearer token signed like the session cookie
   (`lib/session-token.ts`). `requireSession` accepts either one, and "sign out everywhere" (`sessionsValidFrom`)
   ends both.
2. **Writes.** `POST /api/v1/reports`, plus ratings and reviews. They go through the same validation as `addReport`
   in `lib/actions.ts`, and the worker's request guard needs an exception for them.
