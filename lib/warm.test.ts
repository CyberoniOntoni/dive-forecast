import { afterEach, describe, expect, it, vi } from "vitest";

const built: { wall: string; options: unknown }[] = [];
vi.mock("./nowcast-cache", () => ({
  buildMapNowcasts: async (_sites: unknown, _atolls: unknown, wall: string, options: unknown) => {
    built.push({ wall, options });
    return [];
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
const { WARM_HEADER } = await import("./warm-path");

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
    expect(result.hours).toEqual(["2026-11-05T15"]);
  });

  it("builds the next hour's map too from minute 40", async () => {
    const result = await warmCaches(Date.parse("2026-11-05T10:45:00Z"));
    expect(built.map((item) => item.wall)).toEqual(["2026-11-05T15:45", "2026-11-05T16:00"]);
    expect(built[1].options).toEqual({ wait: false });
    expect(result.hours).toEqual(["2026-11-05T15", "2026-11-05T16"]);
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
