# Running on Cloudflare Workers

The app also runs on Cloudflare Workers through [OpenNext](https://opennext.js.org/cloudflare). The Docker image
(`Dockerfile`, `docker-compose.yml`) still works unchanged; the code picks its storage at run time.

## What lives where

| Data | Docker / `next dev` | Worker |
| --- | --- | --- |
| Read-only data (`sites.json`, `rims.json`, `openings.json`, `islands.json`, `shoals.json`, `shelter-grid.json`, `seaward-floor.json`, `replay.json`) | `data/` | Static assets under `/_data/`, copied by `scripts/cf-assets.ts`, fetched once per isolate (`lib/data-files.ts`); `shelter-grid.json` (8.5 MB) only by the sheltered-water actions, the rest by every action |
| Reports, ratings, added pins, accounts, sign-in codes | `data/store.json` | D1 database `dive-forecast` (binding `DB`): one table per list, read once per request; a change writes only the rows it touched, in one transaction (`lib/store.ts`, `lib/store-d1.ts`). The app creates the tables itself. On its first request it copied the old `store.json` from the R2 bucket into D1 (all or nothing, once); that R2 object is left as a backup |
| Open-Meteo cache | `data/marine-cache/` | `marine-cache/…` in the R2 bucket `dive-current-cache` (binding `CACHE`, created with the Asia-Pacific location hint; `lib/cache-bucket.ts`), plus a copy in the serving data centre's Cache API kept 24 hours (`lib/edge-cache.ts`): a copy past the 6-hour TTL is served at once and checked against R2 behind the response and an in-memory copy per isolate (`lib/marine.ts`). A key `CACHE` lacks is read from `DATA` (eastern North America, where the caches lived before) and copied across once; without a `CACHE` binding everything stays in `DATA` |
| Site photos added by divers | `data/photos/` | `site-photos/<site>/<photo>.jpg` in the `DATA` bucket `dive-current-data` (previews use the preview bucket), JPEG only, at most 1.5 MB each after the browser shrinks them (`lib/site-photos.ts`) |
| Map nowcasts | computed per load | `nowcast/<hour>.json` in the `CACHE` bucket, with a copy in the serving data centre's Cache API: served at once for the same Maldives hour and site list, checked against R2 or rebuilt in the background when older than 5 minutes (`lib/nowcast-cache.ts`) |

`lib/cloudflare.ts` tells the two apart: OpenNext's request context exists only on a worker. Two rules come from
the Workers runtime:

- Every server action calls `ready()` first (`lib/actions.ts`), which preloads the data files and reads the store.
  The data loaders stay synchronous and read from that preload.
- A request must not wait on a promise that another request's I/O settles, or the runtime cancels it as hung. State
  that holds in-flight promises goes through `perRequest` (marine fetches in flight and request slots, atoll rings,
  lagoon openings, the store's write queue, the data preload), and so does the store snapshot a request reads. Memos
  of plain data stay shared.

Background cache refreshes run under `waitUntil` (`runInBackground`).

The worker's entry is `cloudflare-worker.js`, which wraps OpenNext's `.open-next/worker.js`: it answers 405 to
anything but GET, HEAD and server-action POSTs (`lib/request-guard.ts`), so bot probes such as WordPress's
`POST /?rest_route=/batch/v1` never render the map.

### Cache warm-up (cron)

Pages only ever refresh a series behind the response, so without help the first visitor after a quiet spell reads
every series from R2 and the first map of each hour builds every site's nowcast. A cron trigger
(`triggers.crons` in `wrangler.jsonc`, hourly at :50) runs `scheduled()` in `cloudflare-worker.js`, which asks
`POST /api/warm` through Next with `AUTH_SECRET` in a header (`lib/warm.ts`; the worker answers 404 to that path from
outside, and the route does without the token). It builds and saves the next hour's map nowcasts, and on the way
refreshes every series 4.5 hours old or more (each site's own, ring points, lagoon openings, offshore waves and wind),
so with an hour between runs none passes the 6-hour TTL; offshore waves and wind come after the map, so a down wave host cannot hold it up. A missed run changes nothing but speed. A run whose map list R2 refused fails (Trigger events show it); `offshoreFailed` in the log counts atolls that got no waves or wind. Its edge copies land in the cron's own data centre only: visitors' data centres copy from R2, which is why the caches sit in an Asia-Pacific bucket. Each run's result is
in the worker's logs (`Cache warm-up: {...}`); past runs are under the worker's Settings → Trigger events. No
`AUTH_SECRET`, no warm-up. Preview builds run no cron.

## Commands

```bash
npm run replay        # writes data/replay.json, which the build ships
npm run cf:build      # OpenNext build + data files into .open-next/assets/_data
npm run cf:preview    # cf:build, then wrangler dev on http://localhost:8787 with a local R2 bucket and D1 database (.wrangler/state)
npm run cf:deploy     # cf:build, then deploys to the account wrangler is logged in to
npm run d1:export     # the live D1 store as data/store.json (for verify, replay --store or a Docker host)
```

## First deploy (Cloudflare dashboard)

1. **R2:** R2 Object Storage → Create bucket → name `dive-current-data`. R2 asks for a payment method even on
   the free allowance. Then a second bucket for the caches: name `dive-current-cache`, Location → Provide a location
   hint → Asia-Pacific (APAC). The hint is only taken at creation; a bucket cannot be moved later.
2. **D1:** Storage & Databases → D1 → Create → name `dive-forecast` (location Asia-Pacific); put its id in
   `wrangler.jsonc` under `d1_databases`. Existing reports (optional): before the first request, upload an existing
   `data/store.json` to the R2 bucket as `store.json` (`npx wrangler r2 object put dive-current-data/store.json --file data/store.json --remote`);
   the worker copies it into D1 once. Without it the worker starts with no reports, ratings or added pins.
3. **Worker from GitHub:** Workers & Pages → Create → Import a repository → `CyberoniOntoni/dive-forecast` (the worker is named `dive-forecast`, matching `wrangler.jsonc`).
   - Build command: `npm run replay && npm run cf:build`
   - Deploy command: `npx wrangler deploy`
   - Non-production branch deploy command: `npx wrangler preview` (each PR branch gets a preview URL). It reads only
     the `previews` block in `wrangler.jsonc`, which points at a separate D1 database `dive-forecast-preview` and R2
     bucket `dive-current-data-preview`, so previews start empty and never write to the live data. Without that block
     the command fails at the end of every PR build. A binding added at the top level needs a preview copy there too.
   - Production branch: `main`
4. The worker is then live at `dive-forecast.<your-subdomain>.workers.dev`. To use your domain, open the worker →
   Settings → Domains & Routes → Add → Custom domain (the live site is `50bar.app`). The domain's DNS must be on
   Cloudflare.

## Sign-in (accounts)

Reporting the current, rating a site and adding a site need a signed-in diver; reading stays open to everyone.
Sign-in is by email code (no passwords): the diver types an email, gets a 6-digit code and a link, and picks a
nickname the first time. Only the nickname is ever shown. `APP_URL`, `EMAIL_FROM` and `MAILGUN_DOMAIN` are in `wrangler.jsonc`
`vars` (a deploy replaces variables typed into the dashboard with that file's). The two secrets go in Workers & Pages →
`dive-forecast` → Settings → Variables and Secrets, as type Secret, which deploys keep. For Docker, all of them go in a
`.env` next to `docker-compose.yml`:

| Name | What | Example |
| --- | --- | --- |
| `AUTH_SECRET` (secret) | Signs the session cookie and code hashes. Any long random string, e.g. `openssl rand -base64 48`. Changing it signs everyone out. | |
| `MAILGUN_API_KEY` (secret) | Mailgun → Account → API Security → a sending or private API key. | |
| `MAILGUN_DOMAIN` | The verified Mailgun sending domain. | `mailgun.50bar.app` |
| `MAILGUN_FROM` | Optional sender. Defaults to `Dive current <login@MAILGUN_DOMAIN>`. | `Dive current <login@mailgun.50bar.app>` |
| `MAILGUN_REGION` | `eu` for an EU Mailgun account; otherwise leave unset. | |
| `APP_URL` | The site's address, for the link in the email. Without it the email has the code only. | `https://50bar.app` |
| `EMAIL_FROM` | Sender for Cloudflare Email Sending (worker only, with the `EMAIL` binding). Without it the worker uses Mailgun alone. | `login@50bar.app` |

On the worker the email goes out through Cloudflare Email Sending first (the `EMAIL` `send_email` binding in
`wrangler.jsonc`, `lib/email.ts`), and through Mailgun when Cloudflare refuses or fails, for example while the domain
is not onboarded or the beta's daily quota is used up. Docker and `next dev` have no binding and use Mailgun alone.
To turn on Cloudflare sending, onboard the domain once: Compute → Email Service → Email Sending → Onboard Domain →
`50bar.app`. Cloudflare adds the SPF, DKIM and bounce MX records on `cf-bounce.50bar.app` and a DMARC record on
`_dmarc.50bar.app` itself. Sends show up under Email Sending → Activity; refused ones in the worker log as
"Sign-in email via cloudflare failed". Sending to any address needs Workers Paid: 3,000 emails a month are included,
then $0.35 per 1,000.

Mailgun's domain needs its DNS records (SPF TXT, DKIM TXT, MX and the tracking CNAME it lists) added in Cloudflare
DNS for 50bar.app. Without `AUTH_SECRET` and at least one way to send (Cloudflare or Mailgun), production says signing in is not set up; `next dev`
needs none of them and prints the code to its own log instead. Users, pending codes (hashed) and ratings per diver live
in the store (D1 on the worker); points and badges are worked out from the reports (`lib/points.ts`), nothing extra is stored.

## Cost

Workers Paid ($5/month) is needed: a map load spends about 2-4 s of CPU working out every site's nowcast, far over
the free plan's 10 ms. `limits.cpu_ms` in `wrangler.jsonc` is 30 s. Paid includes 30M CPU-ms a month, about
10,000 map loads; beyond that it is $0.02 per million CPU-ms (about $0.00005 per map load). The warm-up builds the map
once an hour, roughly 2-3M CPU-ms a month, and asks Open-Meteo for every point about every 5 hours (a few thousand
requests a day, inside its free 10,000). R2 (under 20 MB stored, a few
thousand writes a day) stays inside its free allowance. D1 on Workers Paid includes 25 billion rows read and 50 million
rows written a month and 5 GB stored; every request reads every store row, which is far inside that for now.

## Moving reports back

Run `npm run d1:export` (wrangler signed in) and put the `data/store.json` it writes on the Docker host. D1 also keeps
30 days of point-in-time restore (Time Travel: `npx wrangler d1 time-travel restore dive-forecast --timestamp=…`).
