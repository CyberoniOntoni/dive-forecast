# Running on Cloudflare Workers

The app also runs on Cloudflare Workers through [OpenNext](https://opennext.js.org/cloudflare). The Docker image
(`Dockerfile`, `docker-compose.yml`) still works unchanged; the code picks its storage at run time.

## What lives where

| Data | Docker / `next dev` | Worker |
| --- | --- | --- |
| Read-only data (`sites.json`, `rims.json`, `openings.json`, `islands.json`, `shoals.json`, `shelter-grid.json`, `seaward-floor.json`, `replay.json`) | `data/` | Static assets under `/_data/`, copied by `scripts/cf-assets.ts`, fetched once per isolate (`lib/data-files.ts`) |
| Reports, ratings, added pins | `data/store.json` | `store.json` in the R2 bucket `dive-current-data`, read once per request and written with an etag check (create-only for the first write) and retry (`lib/store.ts`) |
| Open-Meteo cache | `data/marine-cache/` | `marine-cache/…` in the same bucket, plus an in-memory copy per isolate (`lib/marine.ts`) |
| Map nowcasts | computed per load | `nowcast/<hour>.json` in the same bucket: served at once for the same Maldives hour and site list, rebuilt in the background when older than 5 minutes (`lib/nowcast-cache.ts`) |

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

## Commands

```bash
npm run replay        # writes data/replay.json, which the build ships
npm run cf:build      # OpenNext build + data files into .open-next/assets/_data
npm run cf:preview    # cf:build, then wrangler dev on http://localhost:8787 with a local R2 bucket (.wrangler/state)
npm run cf:deploy     # cf:build, then deploys to the account wrangler is logged in to
```

## First deploy (Cloudflare dashboard)

1. **R2:** R2 Object Storage → Create bucket → name `dive-current-data`. R2 asks for a payment method even on
   the free allowance.
2. **Existing reports (optional):** in that bucket, upload an existing `data/store.json` as `store.json`. Without it
   the worker starts with no reports, ratings or added pins. (Or: `npx wrangler r2 object put dive-current-data/store.json --file data/store.json --remote`.)
3. **Worker from GitHub:** Workers & Pages → Create → Import a repository → `CyberoniOntoni/dive-forecast` (the worker is named `dive-forecast`, matching `wrangler.jsonc`).
   - Build command: `npm run replay && npm run cf:build`
   - Deploy command: `npx wrangler deploy`
   - Non-production branch deploy command: `npx wrangler versions upload` (each branch gets a preview URL)
   - Production branch: `main`
4. The worker is then live at `dive-forecast.<your-subdomain>.workers.dev`. To use your domain, open the worker →
   Settings → Domains & Routes → Add → Custom domain (the live site is `50bar.app`). The domain's DNS must be on
   Cloudflare.

## Sign-in (accounts)

Reporting the current, rating a site and adding a site need a signed-in diver; reading stays open to everyone.
Sign-in is by email code (no passwords): the diver types an email, gets a 6-digit code and a link, and picks a
nickname the first time. Only the nickname is ever shown. `APP_URL` and `MAILGUN_DOMAIN` are in `wrangler.jsonc`
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

Mailgun's domain needs its DNS records (SPF TXT, DKIM TXT, MX and the tracking CNAME it lists) added in Cloudflare
DNS for 50bar.app. Without `AUTH_SECRET` and the Mailgun settings, production says signing in is not set up; `next dev`
needs none of them and prints the code to its own log instead. Users, pending codes (hashed) and ratings per diver live
in `store.json`; points and badges are worked out from the reports (`lib/points.ts`), nothing extra is stored.

## Cost

Workers Paid ($5/month) is needed: a map load spends about 2-4 s of CPU working out every site's nowcast, far over
the free plan's 10 ms. `limits.cpu_ms` in `wrangler.jsonc` is 30 s. Paid includes 30M CPU-ms a month, about
10,000 map loads; beyond that it is $0.02 per million CPU-ms (about $0.00005 per map load). R2 (under 20 MB stored, a few
thousand writes a day) stays inside its free allowance.

## Moving reports back

Download `store.json` from the bucket and put it in `data/` on the Docker host.
