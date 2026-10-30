import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { R2Bucket, WorkerEnv } from "./cloudflare";
import type { Report } from "./types";

// The worker paths, with OpenNext's request context, the R2 bucket and the static assets faked in memory.
type Context = { env: WorkerEnv; ctx: { waitUntil: (promise: Promise<unknown>) => void } };
let current: Context | null = null;
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    if (!current) throw new Error("no Cloudflare context");
    return current;
  },
}));

type FakeBucket = R2Bucket & { objects: Map<string, { text: string; etag: string }>; beforePut?: () => void };

function fakeBucket(): FakeBucket {
  const objects = new Map<string, { text: string; etag: string }>();
  let version = 0;
  const bucket: FakeBucket = {
    objects,
    async get(key) {
      const object = objects.get(key);
      return object ? { text: async () => object.text, etag: object.etag } : null;
    },
    async put(key, value, options) {
      bucket.beforePut?.();
      const etagMatches = options?.onlyIf?.etagMatches;
      if (etagMatches !== undefined && objects.get(key)?.etag !== etagMatches) return null;
      // R2's create-only write: "*" matches any existing object.
      if (options?.onlyIf?.etagDoesNotMatch === "*" && objects.has(key)) return null;
      version += 1;
      const etag = `v${version}`;
      objects.set(key, { text: value, etag });
      return { etag };
    },
  };
  return bucket;
}

function fakeAssets(files: Record<string, string>): WorkerEnv["ASSETS"] {
  return {
    fetch: async (url) => {
      const name = new URL(url).pathname.replace("/_data/", "");
      return name in files ? new Response(files[name]) : new Response("not found", { status: 404 });
    },
  };
}

const background: Promise<unknown>[] = [];

function newRequest(env: WorkerEnv): Context {
  current = { env, ctx: { waitUntil: (promise) => background.push(promise) } };
  return current;
}

function report(id: string): Report {
  return { id, siteId: "banana-reef", time: "2026-09-23T10:00", direction: "incoming", strength: "mild" };
}

const realSites = fs.readFileSync(path.join(process.cwd(), "data", "sites.json"), "utf8");

beforeEach(() => {
  vi.resetModules();
  background.length = 0;
});

afterEach(() => {
  current = null;
});

describe("on a Cloudflare worker", () => {
  it("reads data files from the static assets once preloaded, and a missing one as ENOENT", async () => {
    const { preloadDataFiles, readDataFile } = await import("./data-files");
    newRequest({ ASSETS: fakeAssets({ "sites.json": realSites }), DATA: fakeBucket() });
    expect(() => readDataFile("sites.json")).toThrow(/before preloadDataFiles/);
    await preloadDataFiles();
    expect(readDataFile("sites.json")).toBe(realSites);
    expect(() => readDataFile("rims.json")).toThrow(expect.objectContaining({ code: "ENOENT" }));
  });

  it("keeps the store in R2 and sees another isolate's write on the next request", async () => {
    const store = await import("./store");
    const bucket = fakeBucket();
    const env = { ASSETS: fakeAssets({ "sites.json": realSites }), DATA: bucket };
    newRequest(env);
    await store.refreshStore();
    expect(store.readStore().reports).toEqual([]);
    await store.addReport(report("first"));
    expect(JSON.parse(bucket.objects.get("store.json")!.text).reports.map((item: Report) => item.id)).toEqual(["first"]);

    // Another isolate writes; this isolate's next request reads it.
    const other = JSON.parse(bucket.objects.get("store.json")!.text);
    other.reports.push(report("elsewhere"));
    await bucket.put("store.json", JSON.stringify(other));
    newRequest(env);
    await store.refreshStore();
    expect(store.readStore().reports.map((item) => item.id)).toEqual(["first", "elsewhere"]);
  });

  it("starts a store write over when another isolate wrote in between", async () => {
    const store = await import("./store");
    const bucket = fakeBucket();
    newRequest({ ASSETS: fakeAssets({}), DATA: bucket });
    await store.addReport(report("first"));
    let raced = false;
    bucket.beforePut = () => {
      if (raced) return;
      raced = true;
      const object = bucket.objects.get("store.json")!;
      const other = JSON.parse(object.text);
      other.reports.push(report("racing"));
      bucket.objects.set("store.json", { text: JSON.stringify(other), etag: "raced" });
    };
    await store.addReport(report("second"));
    const saved = JSON.parse(bucket.objects.get("store.json")!.text);
    expect(saved.reports.map((item: Report) => item.id)).toEqual(["first", "racing", "second"]);
  });

  it("does not let the very first write overwrite another isolate's first write", async () => {
    const store = await import("./store");
    const bucket = fakeBucket();
    newRequest({ ASSETS: fakeAssets({}), DATA: bucket });
    let raced = false;
    bucket.beforePut = () => {
      if (raced) return;
      raced = true;
      bucket.objects.set("store.json", { text: JSON.stringify({ reports: [report("other")] }), etag: "other" });
    };
    await store.addReport(report("mine"));
    const saved = JSON.parse(bucket.objects.get("store.json")!.text);
    expect(saved.reports.map((item: Report) => item.id)).toEqual(["other", "mine"]);
  });

  it("keeps each request's store snapshot when another request refreshes", async () => {
    const store = await import("./store");
    const bucket = fakeBucket();
    const env = { ASSETS: fakeAssets({}), DATA: bucket };
    const first = newRequest(env);
    await store.refreshStore();
    await bucket.put("store.json", JSON.stringify({ reports: [report("later")] }));
    newRequest(env);
    await store.refreshStore();
    expect(store.readStore().reports.map((item) => item.id)).toEqual(["later"]);
    current = first;
    expect(store.readStore().reports).toEqual([]);
  });

  it("copies a corrupt store aside and reads it as empty", async () => {
    const store = await import("./store");
    const bucket = fakeBucket();
    await bucket.put("store.json", "{not json");
    newRequest({ ASSETS: fakeAssets({}), DATA: bucket });
    await store.refreshStore();
    expect(store.readStore()).toEqual({ reports: [], ratings: [], sites: [], users: [], logins: [] });
    expect([...bucket.objects.keys()].some((key) => key.startsWith("store.json.corrupt."))).toBe(true);
  });

  it("caches Open-Meteo series in R2 and refreshes a stale one in the background", async () => {
    const { fetchMarine, marineCacheName } = await import("./marine");
    const bucket = fakeBucket();
    const env = { ASSETS: fakeAssets({}), DATA: bucket };
    const hours = [{ time: "2026-10-30T10:00", seaLevelM: 0.4, currentVelocityMs: 0.2, currentDirectionDeg: 90 }];
    const old = Date.now() - 7 * 60 * 60 * 1000;
    await bucket.put(`marine-cache/${marineCacheName(4, 73)}`, JSON.stringify({ fetchedAt: old, hours }));
    const fetchSpy = vi.fn(() => Promise.reject(new Error("offline")));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      newRequest(env);
      const result = await fetchMarine(4, 73);
      expect(result).toMatchObject({ ok: true, fetchedAt: old });
      // Past the 6-hour TTL: the refresh runs under waitUntil so the worker keeps it alive after the response.
      expect(background).toHaveLength(1);
      await Promise.all(background);
      expect(fetchSpy).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not share in-flight promises between requests", async () => {
    const { perRequest } = await import("./cloudflare");
    const env = { ASSETS: fakeAssets({}), DATA: fakeBucket() };
    const state = perRequest(() => new Map<string, number>());
    newRequest(env);
    const first = state();
    expect(state()).toBe(first);
    newRequest(env);
    expect(state()).not.toBe(first);
  });
});
