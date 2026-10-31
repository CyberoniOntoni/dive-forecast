import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { R2Bucket, WorkerEnv } from "./cloudflare";
import { fakeD1 } from "../tests/fake-d1";
import type { Report, User } from "./types";

// The worker paths, with OpenNext's request context, the R2 bucket and the static assets faked in memory, and D1 on
// Node's SQLite.
type Context = { env: WorkerEnv; ctx: { waitUntil: (promise: Promise<unknown>) => void } };
let current: Context | null = null;
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    if (!current) throw new Error("no Cloudflare context");
    return current;
  },
}));

type FakeBucket = R2Bucket & { objects: Map<string, { text: string }> };

function fakeBucket(): FakeBucket {
  const objects = new Map<string, { text: string }>();
  return {
    objects,
    async get(key) {
      const object = objects.get(key);
      return object ? { text: async () => object.text } : null;
    },
    async put(key, value) {
      objects.set(key, { text: value });
      return {};
    },
  };
}

function fakeAssets(files: Record<string, string>): WorkerEnv["ASSETS"] {
  return {
    fetch: async (url) => {
      const name = new URL(url).pathname.replace("/_data/", "");
      return name in files ? new Response(files[name]) : new Response("not found", { status: 404 });
    },
  };
}

/** The Workers Cache API, in memory: text by key URL. */
function fakeEdgeCache() {
  const entries = new Map<string, string>();
  return {
    entries,
    async match(url: string) {
      const text = entries.get(url);
      return text === undefined ? undefined : new Response(text);
    },
    async put(url: string, response: Response) {
      entries.set(url, await response.text());
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

function user(id: string, email: string, nickname: string): User {
  return { id, email, nickname, createdAt: "2026-10-30T00:00:00Z" };
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
    newRequest({ ASSETS: fakeAssets({ "sites.json": realSites }), DATA: fakeBucket(), DB: fakeD1() });
    expect(() => readDataFile("sites.json")).toThrow(/before preloadDataFiles/);
    await preloadDataFiles();
    expect(readDataFile("sites.json")).toBe(realSites);
    expect(() => readDataFile("rims.json")).toThrow(expect.objectContaining({ code: "ENOENT" }));
  });

  it("copies store.json from R2 into D1 once, and keeps the R2 object", async () => {
    const bucket = fakeBucket();
    const legacy = { reports: [report("old")], users: [user("u1", "a@x.mv", "Ali")], ratings: [], sites: [], logins: [] };
    await bucket.put("store.json", JSON.stringify(legacy));
    const db = fakeD1();
    const env = { ASSETS: fakeAssets({}), DATA: bucket, DB: db };
    const store = await import("./store");
    newRequest(env);
    await store.refreshStore();
    expect(store.readStore().reports.map((item) => item.id)).toEqual(["old"]);
    expect(store.readStore().users.map((item) => item.nickname)).toEqual(["Ali"]);
    expect(bucket.objects.get("store.json")!.text).toBe(JSON.stringify(legacy));

    // A later change to the R2 copy is not imported again, by this isolate or a new one.
    await bucket.put("store.json", JSON.stringify({ reports: [report("old"), report("late")] }));
    vi.resetModules();
    const fresh = await import("./store");
    newRequest(env);
    await fresh.refreshStore();
    expect(fresh.readStore().reports.map((item) => item.id)).toEqual(["old"]);
  });

  it("stops on a corrupt store.json in R2 without importing anything, and tries again next time", async () => {
    const bucket = fakeBucket();
    await bucket.put("store.json", "{not json");
    const db = fakeD1();
    const env = { ASSETS: fakeAssets({}), DATA: bucket, DB: db };
    const store = await import("./store");
    newRequest(env);
    await expect(store.refreshStore()).rejects.toThrow(/not valid JSON/);
    expect(db.sqlite.prepare("SELECT count(*) AS n FROM meta WHERE key = 'imported_r2_store'").all()[0].n).toBe(0);

    await bucket.put("store.json", JSON.stringify({ reports: [report("fixed")] }));
    newRequest(env);
    await store.refreshStore();
    expect(store.readStore().reports.map((item) => item.id)).toEqual(["fixed"]);
  });

  it("keeps the store in D1 and sees another isolate's write on the next request", async () => {
    const env = { ASSETS: fakeAssets({}), DATA: fakeBucket(), DB: fakeD1() };
    const store = await import("./store");
    newRequest(env);
    await store.refreshStore();
    expect(store.readStore().reports).toEqual([]);
    await store.addReport(report("first"));
    expect(store.readStore().reports.map((item) => item.id)).toEqual(["first"]);

    vi.resetModules();
    const other = await import("./store");
    newRequest(env);
    await other.addReport(report("elsewhere"));

    newRequest(env);
    await store.refreshStore();
    expect(store.readStore().reports.map((item) => item.id)).toEqual(["first", "elsewhere"]);
  });

  it("writes only the records a change touched, so a write from an older read keeps newer records", async () => {
    const { storeChanges, loadD1Store } = await import("./store-d1");
    const env = { ASSETS: fakeAssets({}), DATA: fakeBucket(), DB: fakeD1() };
    const store = await import("./store");
    newRequest(env);
    await store.addReport(report("a"));
    await store.saveRating({ siteId: "banana-reef", score: 3, updatedAt: "2026-10-30T00:00:00Z", userId: "u1" });

    // This isolate read the store, then another wrote a report before this one's batch ran.
    const before = await loadD1Store(env.DB);
    await store.addReport(report("b"));
    const after = structuredClone(before);
    after.ratings[0].score = 5;
    after.reports = [];
    await env.DB.batch(storeChanges(env.DB, before, after));

    const saved = await loadD1Store(env.DB);
    expect(saved.reports.map((item) => item.id)).toEqual(["b"]);
    expect(saved.ratings.map((item) => item.score)).toEqual([5]);
  });

  it("keeps a changed record in its place and drops a removed one", async () => {
    const env = { ASSETS: fakeAssets({}), DATA: fakeBucket(), DB: fakeD1() };
    const store = await import("./store");
    newRequest(env);
    for (const id of ["u1", "u2", "u3"]) {
      await store.saveRating({ siteId: "banana-reef", score: 1, updatedAt: "2026-10-30T00:00:00Z", userId: id });
    }
    await store.saveRating({ siteId: "banana-reef", score: 4, updatedAt: "2026-10-31T00:00:00Z", userId: "u2" });
    await store.mutateStore((data) => {
      data.ratings = data.ratings.filter((item) => item.userId !== "u1");
    });
    newRequest(env);
    await store.refreshStore();
    expect(store.readStore().ratings.map((item) => [item.userId, item.score])).toEqual([
      ["u2", 4],
      ["u3", 1],
    ]);
  });

  it("turns a second account for the same email into a retry message, keeping the first", async () => {
    const env = { ASSETS: fakeAssets({}), DATA: fakeBucket(), DB: fakeD1() };
    const store = await import("./store");
    newRequest(env);
    await store.mutateStore((data) => void data.users.push(user("u1", "a@x.mv", "Ali")));
    await expect(store.mutateStore((data) => void data.users.push(user("u2", "a@x.mv", "Ali2")))).rejects.toThrow(
      /just created/,
    );
    newRequest(env);
    await store.refreshStore();
    expect(store.readStore().users.map((item) => item.id)).toEqual(["u1"]);
  });

  it("writes nothing when a batch fails", async () => {
    const db = fakeD1();
    const env = { ASSETS: fakeAssets({}), DATA: fakeBucket(), DB: db };
    const store = await import("./store");
    newRequest(env);
    await store.refreshStore();
    db.failNextBatch = new Error("D1 down");
    await expect(store.addReport(report("lost"))).rejects.toThrow("D1 down");
    newRequest(env);
    await store.refreshStore();
    expect(store.readStore().reports).toEqual([]);
  });

  it("keeps each request's store snapshot when another request refreshes", async () => {
    const env = { ASSETS: fakeAssets({}), DATA: fakeBucket(), DB: fakeD1() };
    const store = await import("./store");
    const first = newRequest(env);
    await store.refreshStore();
    newRequest(env);
    await store.addReport(report("later"));
    await store.refreshStore();
    expect(store.readStore().reports.map((item) => item.id)).toEqual(["later"]);
    current = first;
    expect(store.readStore().reports).toEqual([]);
  });

  it("caches Open-Meteo series in R2 and refreshes a stale one in the background", async () => {
    const { fetchMarine, marineCacheName } = await import("./marine");
    const bucket = fakeBucket();
    const env = { ASSETS: fakeAssets({}), DATA: bucket, DB: fakeD1() };
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

  it("preloads every data file but the shelter grid, which loads only for the actions that name it", async () => {
    const { preloadDataFiles, readDataFile, CORE_DATA_FILES } = await import("./data-files");
    const asked: string[] = [];
    const assets = fakeAssets({ "sites.json": realSites, "shelter-grid.json": "{}" });
    const env = { ASSETS: { fetch: (url: string) => (asked.push(new URL(url).pathname), assets.fetch(url)) }, DATA: fakeBucket(), DB: fakeD1() };
    newRequest(env);
    await preloadDataFiles();
    expect(asked).not.toContain("/_data/shelter-grid.json");
    expect(asked).toHaveLength(CORE_DATA_FILES.length);
    expect(() => readDataFile("shelter-grid.json")).toThrow(/before preloadDataFiles/);
    await preloadDataFiles([...CORE_DATA_FILES, "shelter-grid.json"]);
    expect(readDataFile("shelter-grid.json")).toBe("{}");
    // Files already loaded are not fetched again.
    expect(asked).toHaveLength(CORE_DATA_FILES.length + 1);
  });

  it("reads Open-Meteo series from the data centre's copy before R2, and R2 once that copy is past the TTL", async () => {
    const edge = fakeEdgeCache();
    vi.stubGlobal("caches", { default: edge });
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    try {
      const bucket = fakeBucket();
      const reads: string[] = [];
      const get = bucket.get.bind(bucket);
      bucket.get = (key) => (reads.push(key), get(key));
      const env = { ASSETS: fakeAssets({}), DATA: bucket, DB: fakeD1(), APP_URL: "https://50bar.app" };
      const hours = [{ time: "2026-10-30T10:00", seaLevelM: 0.4, currentVelocityMs: 0.2, currentDirectionDeg: 90 }];
      const { marineCacheName } = await import("./marine");
      const key = `marine-cache/${marineCacheName(4, 73)}`;
      const recent = Date.now() - 60 * 60 * 1000;
      await bucket.put(key, JSON.stringify({ fetchedAt: recent, hours }));

      // A worker that does not know its domain keeps no edge copy (appSetting falls back to the process env).
      vi.stubEnv("APP_URL", "");
      newRequest({ ...env, APP_URL: undefined } as unknown as WorkerEnv);
      expect(await (await import("./marine")).fetchMarine(4, 73)).toMatchObject({ ok: true, fetchedAt: recent });
      await Promise.all(background);
      expect(edge.entries.size).toBe(0);
      reads.length = 0;
      vi.resetModules();

      newRequest(env);
      expect(await (await import("./marine")).fetchMarine(4, 73)).toMatchObject({ ok: true, fetchedAt: recent });
      expect(reads).toEqual([key]);
      await Promise.all(background);
      expect([...edge.entries.keys()]).toEqual([`https://50bar.app/__r2-copy/marine-cache/${encodeURIComponent(marineCacheName(4, 73))}`]);

      // A fresh isolate in the same data centre: the edge copy answers, R2 is not read.
      vi.resetModules();
      newRequest(env);
      expect(await (await import("./marine")).fetchMarine(4, 73)).toMatchObject({ ok: true, fetchedAt: recent });
      expect(reads).toEqual([key]);

      // An edge copy past the TTL: R2 is read again and its newer series wins.
      const old = Date.now() - 7 * 60 * 60 * 1000;
      for (const url of edge.entries.keys()) edge.entries.set(url, JSON.stringify({ fetchedAt: old, hours }));
      vi.resetModules();
      newRequest(env);
      expect(await (await import("./marine")).fetchMarine(4, 73)).toMatchObject({ ok: true, fetchedAt: recent });
      expect(reads).toEqual([key, key]);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("does not share in-flight promises between requests", async () => {
    const { perRequest } = await import("./cloudflare");
    const env = { ASSETS: fakeAssets({}), DATA: fakeBucket(), DB: fakeD1() };
    const state = perRequest(() => new Map<string, number>());
    newRequest(env);
    const first = state();
    expect(state()).toBe(first);
    newRequest(env);
    expect(state()).not.toBe(first);
  });
});
