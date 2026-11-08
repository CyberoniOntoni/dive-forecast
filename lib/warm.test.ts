import { afterEach, describe, expect, it, vi } from "vitest";

const built: { wall: string; options: unknown }[] = [];
let saved = true;
vi.mock("./nowcast-cache", () => ({
  buildMapNowcasts: async (_sites: unknown, _atolls: unknown, wall: string, options: unknown) => {
    built.push({ wall, options });
    return { nowcasts: [], saved };
  },
}));
const offshore: unknown[] = [];
vi.mock("./sea-state", () => ({
  loadOffshore: async (_atoll: unknown, options: unknown) => {
    offshore.push(options);
    throw new Error("waves down");
  },
}));

const { isWarmRequest, warmCaches, WARM_REFRESH_MS } = await import("./warm");
const { WARM_HEADER, isWarmPath } = await import("./warm-path");

afterEach(() => {
  built.length = 0;
  offshore.length = 0;
  vi.unstubAllEnvs();
});

describe("warmCaches", () => {
  it("refreshes due series while building this hour's map, and one atoll's failed waves stop nothing", async () => {
    // 10:20 UTC is 15:20 in the Maldives: too early for the next hour.
    const result = await warmCaches(Date.parse("2026-11-05T10:20:00Z"));
    expect(built).toEqual([{ wall: "2026-11-05T15:20", options: { refreshOlderThanMs: WARM_REFRESH_MS } }]);
    expect(offshore.length).toBeGreaterThan(0);
    expect(offshore.every((options) => JSON.stringify(options) === JSON.stringify({ refreshOlderThanMs: WARM_REFRESH_MS }))).toBe(true);
    expect(result.hour).toBe("2026-11-05T15");
    // Every atoll with an outline lost its waves, and the run says so.
    expect(result.offshoreFailed).toBe(offshore.length);
    expect(result.saved).toBe(true);
  });

  it("reports a map list R2 refused", async () => {
    saved = false;
    try {
      expect((await warmCaches(Date.parse("2026-11-05T10:20:00Z"))).saved).toBe(false);
    } finally {
      saved = true;
    }
  });

  it("builds only the next hour's map from minute 40, refreshing as it goes", async () => {
    const result = await warmCaches(Date.parse("2026-11-05T10:50:00Z"));
    expect(built).toEqual([{ wall: "2026-11-05T16:00", options: { refreshOlderThanMs: WARM_REFRESH_MS } }]);
    expect(result.hour).toBe("2026-11-05T16");
  });

  it("refreshes before the TTL even with a whole hour between runs", () => {
    expect(WARM_REFRESH_MS + 60 * 60 * 1000).toBeLessThan(6 * 60 * 60 * 1000);
  });
});

describe("isWarmRequest", () => {
  const request = (token?: string) =>
    new Request("https://50bar.app/api/warm", { method: "POST", headers: token ? { [WARM_HEADER]: token } : {} });

  it("needs AUTH_SECRET set and the same token", () => {
    vi.stubEnv("AUTH_SECRET", "");
    expect(isWarmRequest(request(""))).toBe(false);
    vi.stubEnv("AUTH_SECRET", "s3cret-value");
    expect(isWarmRequest(request())).toBe(false);
    expect(isWarmRequest(request("s3cret-valuX"))).toBe(false);
    expect(isWarmRequest(request("s3cret"))).toBe(false);
    expect(isWarmRequest(request("s3cret-value"))).toBe(true);
  });
});

describe("isWarmPath", () => {
  it("matches the route however it is spelled, and nothing else", () => {
    for (const path of ["/api/warm", "/api/warm/", "//api//warm", "/api/%77arm", "/API/Warm", "/api%2Fwarm"]) {
      expect(isWarmPath(path)).toBe(true);
    }
    for (const path of ["/api/warmer", "/api", "/", "/sites/warm", "/api/%E0%A4%A"]) expect(isWarmPath(path)).toBe(false);
  });
});
