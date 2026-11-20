import { describe, expect, it, vi } from "vitest";

// One worker request (a fixed context object), with an R2 bucket that counts its reads; no Cache API.
const r2Reads: string[] = [];
const objects = new Map<string, string>();
const ctx = { waitUntil: () => undefined };
const env = {
  DATA: {
    get: async (key: string) => {
      r2Reads.push(key);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const text = objects.get(key);
      return text === undefined ? null : { text: async () => text, etag: "e" };
    },
    put: async (key: string, value: string) => {
      objects.set(key, value);
      return { etag: "e" };
    },
  },
};
const context = { env, ctx };
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => context }));

const { fetchMarine, marineCacheName } = await import("./marine");

describe("marine cache reads on a worker", () => {
  it("share one R2 read when many loads ask for the same point at once", async () => {
    const hours = Array.from({ length: 48 }, (_, i) => ({
      time: new Date(Date.now() + (i - 12) * 3_600_000).toISOString().slice(0, 16),
      seaLevelM: 0.1,
      currentVelocityMs: 0.2,
      currentDirectionDeg: 90,
    }));
    objects.set(`marine-cache/${marineCacheName(4.5, 73.7)}`, JSON.stringify({ fetchedAt: Date.now(), hours }));
    const results = await Promise.all(Array.from({ length: 6 }, () => fetchMarine(4.5, 73.7, { wait: false })));
    expect(results.every((result) => result.ok)).toBe(true);
    expect(r2Reads.filter((key) => key.endsWith(marineCacheName(4.5, 73.7)))).toHaveLength(1);
  });
});
