# Adding a dive site

Seeded sites live in `data/sites.json`. Sites a user adds in the app go to `data/store.json` and are never seeded (see the last section).

The one thing that goes wrong quietly is the inward bearing, so most of this is about that. A bad bearing does not crash anything. It points the arrow the wrong way, moves the monsoon nudge, and samples the ocean data from the wrong side of the reef.

## 1. Add the record

Append to `sites` in `data/sites.json`:

| Field | Rule |
|---|---|
| `id` | kebab-case, unique, stable. Reports are keyed by it. |
| `name` | As the dive guides print it. |
| `atollId` | An existing atoll `id`. A new atoll is step 4. |
| `lat`, `lon` | On the reef cut, thila, or wreck, not the nearest island. |
| `sourceUrl` | The page the coordinate came from. Never `"user"`, which marks an app-added pin and excludes it from atoll mates. |
| `diveTopM`, `diveMaxM`, `depthSourceUrl` | Only when a page printed them. |
| `channelWidthM`, `channelDepthM`, `channelSourceUrl` | Only for a named channel with a printed measurement. They drive the constriction factor, so a guess changes strength. |

Leave the bearing out for now.

## 2. See what the bearing resolves to

```bash
npm run bearings -- your-site-id
```

The bearing comes from the first that applies:

1. `override`: a measured `inwardBearingDeg` on the site.
2. `rim-derived`: the inward normal of the atoll outline, used only when the pin is within 0.8 km of the rim.
3. `fallback`: the old heuristic (toward the centroid of the atoll's other seeded sites, or from the atoll's ocean point). It is wrong for the first site in an atoll and for anything on a different rim from its neighbors.

Read the result as a direction:

- The bearing is the heading of water **entering** the lagoon through the pass, degrees clockwise from north. Ocean is behind it, lagoon ahead.
- The last column is the 3 km sample point, which is opposite the bearing. It must be in **open ocean**, outside the reef. If it lands in the lagoon, the bearing is inverted.

`rim-derived` on a pin that sits in a pass is usually good to about 15 degrees. `fallback` needs a check every time.

In the app, a `fallback` pin draws an outlined arrow instead of a solid one, its tooltip says "heading estimated", and its site page carries an estimate note. Getting a pin to a solid arrow means giving it an override or putting it on the rim.

## 3. Measure it when it is not rim-derived, or looks off

Use the same imagery as the live map. This URL returns a north-up image with equal degrees on both axes, so an angle read off the picture is a bearing. Centre it on the pin, about 0.02 degrees each way:

```
https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=LON-0.02,LAT-0.02,LON+0.02,LAT+0.02&bboxSR=4326&imageSR=4326&size=700,700&format=jpg&f=image
```

1. Find the pass or gap the pin sits in, and which side is open ocean and which is lagoon.
2. Read the axis from ocean to lagoon. The dark plume streaks in the water mark the flow direction better than the reef edges.
3. Round to 5 degrees and set `inwardBearingDeg`. Expect roughly ±15 degrees, and say so in the commit.
4. Re-run `npm run bearings -- your-site-id` and confirm the sample point is in open ocean.

Interior wrecks and thilas with no pass have no channel axis. Set the direction the atoll edge faces the lagoon, and record it as a low-trust estimate in `HYDRODYNAMICS_PLAN.md` (Kuda Giri is the example).

## 4. A new atoll

1. Add to `atolls`: `id`, `name`, `oceanLat`, `oceanLon` (an open-ocean point off the atoll), and `rimSourceUrl` (the OpenStreetMap way of the atoll outline).
2. Add its outline to `data/rims.json`, keyed by the way id at the end of `rimSourceUrl`:

   ```bash
   curl -s "https://api.openstreetmap.org/api/0.6/way/WAY_ID/full.json"
   ```

   Store the closed ring as `[lat, lon]` pairs, five decimals. Two atolls can share one way, as North and South Ari do.
3. The test "has a stored rim for every atoll" fails until this is done. The outline is OpenStreetMap data under ODbL.

## 5. Check

```bash
npm test
npm run lint
npm run build
```

`lib/rim.test.ts` fails if any seeded site's inward bearing, taken one kilometre along, is not inside its atoll outline. If a new pin sits on a thin or coarse part of the outline and no heading stays inside, add its id to `THIN_OUTLINE_SITES` in that test with a reason, and only after looking at the imagery.

If the site has reports in `data/benchmark-reports.json`, its seaward sample point needs a fixture in `data/benchmark-marine-cache/`, or the benchmark falls back to the atoll's ocean-point cache, which may not cover the report times, and skips them. Run `npm run benchmark` and check the report count. A moved bearing moves the point.

## 6. Commit

Say which bearings were measured, which came from the rim, and which are estimates. Keep site additions separate from logic changes.

## App-added pins

A pin added in the app is a `sourceUrl: "user"` site. It is not a mate for anyone else's fallback.

- Its atoll comes from where it sits: inside or within 5 km of a stored atoll outline. It is worked out every time sites are read, so the stored `atollId` does not matter. North and South Ari share one outline and are split by the nearer ocean point.
- A pin farther than 5 km from every outline gets `atollId: "unseeded"`. It has no forecast and draws no arrow until its atoll is seeded (step 4 above).
- Inside a seeded atoll it gets `rim-derived` if it is within 0.8 km of the outline, otherwise `fallback`. Treat `fallback` arrows on app-added pins as low-trust.
- To promote one to a seeded site, add it to `data/sites.json` with a published `sourceUrl` and the same `id`. Its reports stay attached because they are keyed by `id`.
