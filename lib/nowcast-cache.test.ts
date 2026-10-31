import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteNowcast } from "./nowcast";
import type { Site } from "./types";

// A worker's request context and R2 bucket, faked in memory; nowcastSites is counted, not run.
const objects = new Map<string, string>();
const background: Promise<unknown>[] = [];
let onWorker = true;
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    if (!onWorker) throw new Error("no Cloudflare context");
    return {
      env: {
        DATA: {
          get: async (key: string) => {
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

const { mapNowcasts, siteIdsKey } = await import("./nowcast-cache");

const sites = [{ id: "a" }, { id: "b" }] as Site[];
const WALL = "2026-10-30T16:20";

beforeEach(() => {
  objects.clear();
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

  it("serves the data centre's fresh copy without reading R2, and keeps it in step with each save", async () => {
    const edge = new Map<string, string>();
    vi.stubGlobal("caches", {
      default: {
        match: async (url: string) => (edge.has(url) ? new Response(edge.get(url)) : undefined),
        put: async (url: string, response: Response) => void edge.set(url, await response.text()),
      },
    });
    try {
      vi.useFakeTimers({ now: Date.parse("2026-10-30T11:00:00Z") });
      await mapNowcasts(sites, [], WALL);
      await Promise.all(background);
      expect(edge.size).toBe(1);
      // R2 loses the list: the edge copy still answers within FRESH_MS.
      objects.clear();
      vi.setSystemTime(Date.parse("2026-10-30T11:04:00Z"));
      expect((await mapNowcasts(sites, [], WALL)).map((item) => item.siteId)).toEqual(["a", "b"]);
      expect(nowcastSites).toHaveBeenCalledTimes(1);
      // Past FRESH_MS with nothing newer in R2, the old copy is served and rebuilt in the background.
      vi.setSystemTime(Date.parse("2026-10-30T11:06:00Z"));
      expect((await mapNowcasts(sites, [], WALL)).map((item) => item.siteId)).toEqual(["a", "b"]);
      await Promise.all(background);
      // The save's own edge copy is queued while the rebuild runs.
      await Promise.all(background);
      expect(nowcastSites).toHaveBeenCalledTimes(2);
      expect(JSON.parse([...edge.values()][0]).computedAt).toBe(Date.parse("2026-10-30T11:06:00Z"));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("always computes on Node", async () => {
    onWorker = false;
    await mapNowcasts(sites, [], WALL);
    await mapNowcasts(sites, [], WALL);
    expect(nowcastSites).toHaveBeenCalledTimes(2);
    expect(objects.size).toBe(0);
  });
});
