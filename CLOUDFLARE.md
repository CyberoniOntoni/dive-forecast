# Running on Cloudflare Workers

The app also runs on Cloudflare Workers through [OpenNext](https://opennext.js.org/cloudflare). The Docker image
(`Dockerfile`, `docker-compose.yml`) still works unchanged; the code picks its storage at run time.

## What lives where

| Data | Docker / `next dev` | Worker |
| --- | --- | --- |
| Read-only data (`sites.json`, `rims.json`, `openings.json`, `islands.json`, `shoals.json`, `shelter-grid.json`, `seaward-floor.json`, `replay.json`) | `data/` | Static assets under `/_data/`, copied by `scripts/cf-assets.ts`, fetched once per isolate (`lib/data-files.ts`) |
| Reports, ratings, added pins | `data/store.json` | `store.json` in the R2 bucket `dive-current-data`, read once per request and written with an etag check (`lib/store.ts`) |
| Open-Meteo cache | `data/marine-cache/` | `marine-cache/…` in the same bucket, plus an in-memory copy per isolate (`lib/marine.ts`) |

`lib/cloudflare.ts` tells the two apart: OpenNext's request context exists only on a worker. Two rules come from
the Workers runtime:

- Every server action calls `ready()` first (`lib/actions.ts`), which preloads the data files and reads the store.
  The data loaders stay synchronous and read from that preload.
- A request must not wait on a promise that another request's I/O settles, or the runtime cancels it as hung. State
  that holds in-flight promises goes through `perRequest` (marine fetches in flight and request slots, atoll rings,
  lagoon openings, the store's write queue, the data preload). Memos of plain data stay shared.

Background cache refreshes run under `waitUntil` (`runInBackground`).

## Commands

```bash
npm run replay        # writes data/replay.json, which the build ships
npm run cf:build      # OpenNext build + data files into .open-next/assets/_data
npm run cf:preview    # wrangler dev on http://localhost:8787 with a local R2 bucket (.wrangler/state)
npm run cf:deploy     # deploys to the account wrangler is logged in to
```

## First deploy (Cloudflare dashboard)

1. **R2:** R2 Object Storage → Create bucket → name `dive-current-data`. R2 asks for a payment method even on
   the free allowance.
2. **Your current reports:** in that bucket, upload the LXC's `data/store.json` as `store.json`. Without it the worker
   starts with no reports, ratings or added pins. (Or: `npx wrangler r2 object put dive-current-data/store.json --file data/store.json --remote`.)
3. **Worker from GitHub:** Workers & Pages → Create → Import a repository → `CyberoniOntoni/dive-forecast`.
   - Build command: `npm run replay && npm run cf:build`
   - Deploy command: `npx wrangler deploy`
   - Non-production branch deploy command: `npx wrangler versions upload` (each branch gets a preview URL)
   - Production branch: `main`
4. The worker is then live at `dive-current.<your-subdomain>.workers.dev`. To use your domain, open the worker →
   Settings → Domains & Routes → Add → Custom domain (for example `cf.50bar.app` to try it, later
   `current.50bar.app`). The domain's DNS must be on Cloudflare.

## Cost

Workers Paid ($5/month) is needed: a map load spends about 2-4 s of CPU working out every site's nowcast, far over
the free plan's 10 ms. `limits.cpu_ms` in `wrangler.jsonc` is 30 s. Paid includes 30M CPU-ms a month, about
10,000 map loads; beyond that it is $0.02 per million CPU-ms (about $0.00005 per map load). R2 (under 20 MB stored, a few
thousand writes a day) stays inside its free allowance.

## Moving reports back

Download `store.json` from the bucket and put it in `data/` on the Docker host.
