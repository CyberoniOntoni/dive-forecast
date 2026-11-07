import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteNowcast } from "./nowcast";
import type { Site } from "./types";

// A worker's request context and R2 bucket, faked in memory; nowcastSites is counted, not run.
const objects = new Map<string, string>();
const r2Reads: string[] = [];
const background: Promise<unknown>[] = [];
let onWorker = true;
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    if (!onWorker) throw new Error("no Cloudflare context");
    return {
      env: {
        DATA: {
          get: async (key: string) => {
            r2Reads.push(key);
            const text = objects.get(key);
            return text === undefined ? null : { text: async () => text, etag: "e" };
          },
          put: async (key: string, value: string) => {
            objects.set(key, value);
            return { etag: "e" };
          },
        },
      },
      ctx: { waitUntil: (promise: Promise<unknown>) => background.push(promise) },
    };
  },
}));
const nowcastSites = vi.fn(async (sites: readonly Site[]) => sites.map((site) => ({ siteId: site.id }) as SiteNowcast));
vi.mock("./nowcast", () => ({ nowcastSites: (...args: [readonly Site[]]) => nowcastSites(...args) }));

const { buildMapNowcasts, mapNowcasts, siteIdsKey } = await import("./nowcast-cache");

const sites = [{ id: "a" }, { id: "b" }] as Site[];
const WALL = "2026-10-30T16:20";

beforeEach(() => {
  objects.clear();
  r2Reads.length = 0;
  background.length = 0;
  nowcastSites.mockClear();
  onWorker = true;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("mapNowcasts", () => {
  it("serves a saved list for the same hour and sites without recomputing", async () => {
    await mapNowcasts(sites, [], WALL);
    expect(nowcastSites).toHaveBeenCalledTimes(1);
    const again = await mapNowcasts(sites, [], "2026-10-30T16:55");
    expect(again.map((item) => item.siteId)).toEqual(["a", "b"]);
    expect(nowcastSites).toHaveBeenCalledTimes(1);
    expect(background).toHaveLength(0);
  });

  it("serves an old list from the same hour at once and rebuilds it in the background", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-10-30T11:00:00Z") });
    await mapNowcasts(sites, [], WALL);
    vi.setSystemTime(Date.parse("2026-10-30T11:06:00Z"));
    await mapNowcasts(sites, [], WALL);
    expect(background).toHaveLength(1);
    await Promise.all(background);
    expect(nowcastSites).toHaveBeenCalledTimes(2);
    expect(JSON.parse(objects.get("nowcast/2026-10-30T16.json")!).computedAt).toBe(Date.parse("2026-10-30T11:06:00Z"));
  });

  it("recomputes for a new hour or a changed site list", async () => {
    await mapNowcasts(sites, [], WALL);
    await mapNowcasts(sites, [], "2026-10-30T17:00");
    await mapNowcasts([...sites, { id: "c" } as Site], [], "2026-10-30T17:00");
    expect(nowcastSites).toHaveBeenCalledTimes(3);
    expect(siteIdsKey(sites)).not.toBe(siteIdsKey([{ id: "ab" }] as Site[]));
  });

  it("keeps a copy in the data centre, serves it without R2, and checks R2 behind an old one", async () => {
    const entries = new Map<string, string>();
    vi.stubGlobal("caches", {
      default: {
        match: async (url: string) => (entries.has(url) ? new Response(entries.get(url)) : undefined),
        put: async (url: string, response: Response) => void entries.set(url, await response.text()),
      },
    });
    vi.stubEnv("APP_URL", "https://50bar.app");
    try {
      vi.useFakeTimers({ now: Date.parse("2026-10-30T11:00:00Z") });
      // The warm-up saves the hour's list ahead of it.
      await buildMapNowcasts(sites, [], WALL);
      await Promise.all(background);
      expect(entries.size).toBe(1);
      r2Reads.length = 0;
      await mapNowcasts(sites, [], WALL);
      expect(r2Reads).toEqual([]);
      expect(nowcastSites).toHaveBeenCalledTimes(1);

      // Another data centre's rebuild put a newer list in R2: an old edge copy is served, then replaced from R2.
      vi.setSystemTime(Date.parse("2026-10-30T11:08:00Z"));
      const newer = { computedAt: Date.now(), sitesKey: siteIdsKey(sites), nowcasts: [{ siteId: "a" }] };
      objects.set("nowcast/2026-10-30T16.json", JSON.stringify(newer));
      expect((await mapNowcasts(sites, [], WALL)).map((item) => item.siteId)).toEqual(["a", "b"]);
      // The R2 check puts the newer copy in the background too.
      await Promise.all(background);
      await Promise.all(background);
      expect(r2Reads).toEqual(["nowcast/2026-10-30T16.json"]);
      expect(nowcastSites).toHaveBeenCalledTimes(1);
      expect((await mapNowcasts(sites, [], WALL)).map((item) => item.siteId)).toEqual(["a"]);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("counts a list the warm-up built before its hour as new when the hour starts", async () => {
    // 15:50 in the Maldives: the warm-up builds the 16:00 list.
    vi.useFakeTimers({ now: Date.parse("2026-11-01T10:50:00Z") });
    await buildMapNowcasts(sites, [], "2026-11-01T16:00");
    vi.setSystemTime(Date.parse("2026-11-01T11:03:00Z"));
    await mapNowcasts(sites, [], "2026-11-01T16:03");
    expect(background).toHaveLength(0);
    // Past FRESH_MS into the hour it is rebuilt behind the response as usual.
    vi.setSystemTime(Date.parse("2026-11-01T11:06:00Z"));
    await mapNowcasts(sites, [], "2026-11-01T16:06");
    expect(background).toHaveLength(1);
  });

  it("starts one rebuild for a burst of loads that find an old list in R2", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-01T11:00:00Z") });
    await mapNowcasts(sites, [], "2026-11-01T16:00");
    vi.setSystemTime(Date.parse("2026-11-01T11:30:00Z"));
    await Promise.all([1, 2, 3].map(() => mapNowcasts(sites, [], "2026-11-01T16:30")));
    await Promise.all(background);
    expect(nowcastSites).toHaveBeenCalledTimes(2);
  });

  it("always computes on Node", async () => {
    onWorker = false;
    await mapNowcasts(sites, [], WALL);
    await mapNowcasts(sites, [], WALL);
    expect(nowcastSites).toHaveBeenCalledTimes(2);
    expect(objects.size).toBe(0);
  });
});
