import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowFieldView } from "./flow-wire";

// A worker's request context, R2 bucket and edge cache, faked in memory; flowField is counted, not run.
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
const flowField = vi.fn(async (time: string): Promise<FlowFieldView> => ({ time, atolls: [] }));
vi.mock("./flow-field", () => ({ flowField: (time: string) => flowField(time) }));

const { flowHourInWindow, mapFlowField } = await import("./flow-field-cache");

const HOUR = "2026-11-26T16:00";
const KEY = "flowfield/2026-11-26T16.json";
const edge = new Map<string, string>();

beforeEach(() => {
  objects.clear();
  edge.clear();
  r2Reads.length = 0;
  background.length = 0;
  flowField.mockClear();
  onWorker = true;
  vi.stubGlobal("caches", {
    default: {
      match: async (url: string) => (edge.has(url) ? new Response(edge.get(url)) : undefined),
      put: async (url: string, response: Response) => void edge.set(url, await response.text()),
    },
  });
  vi.stubEnv("APP_URL", "https://50bar.app");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const saved = (computedAt: number, marker: string) =>
  JSON.stringify({ computedAt, field: { time: HOUR, atolls: [{ wayId: marker }] } });

describe("flowHourInWindow", () => {
  it("takes hours from a day back to the end of the forecast week, and nothing else", () => {
    // 16:00 in the Maldives is 11:00 UTC.
    const now = Date.parse("2026-11-26T11:00:00Z");
    expect(flowHourInWindow(HOUR, now)).toBe(true);
    expect(flowHourInWindow("2026-11-25T14:00", now)).toBe(true);
    expect(flowHourInWindow("2026-11-25T08:00", now)).toBe(false);
    expect(flowHourInWindow("2026-12-03T16:00", now)).toBe(true);
    expect(flowHourInWindow("2026-12-05T16:00", now)).toBe(false);
    expect(flowHourInWindow("2000-01-01T00:00", now)).toBe(false);
  });
});

describe("mapFlowField", () => {
  it("copies a fresh field from R2 to the data centre, then serves it without R2", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-26T11:02:00Z") });
    objects.set(KEY, saved(Date.now(), "r2"));
    expect((await mapFlowField(HOUR)).atolls[0].wayId).toBe("r2");
    await Promise.all(background);
    r2Reads.length = 0;
    expect((await mapFlowField(HOUR)).atolls[0].wayId).toBe("r2");
    expect(r2Reads).toEqual([]);
    expect(flowField).not.toHaveBeenCalled();
  });

  it("behind an old data-centre copy, takes a newer field from R2 rather than rebuilding", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-26T11:01:00Z") });
    objects.set(KEY, saved(Date.now(), "old"));
    await mapFlowField(HOUR);
    await Promise.all(background);
    vi.setSystemTime(Date.parse("2026-11-26T11:20:00Z"));
    objects.set(KEY, saved(Date.now(), "new"));
    expect((await mapFlowField(HOUR)).atolls[0].wayId).toBe("old");
    await Promise.all(background);
    await Promise.all(background);
    expect(flowField).not.toHaveBeenCalled();
    expect((await mapFlowField(HOUR)).atolls[0].wayId).toBe("new");
  });

  it("rebuilds behind an old copy when R2 has nothing newer, once a minute at most", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-26T11:01:00Z") });
    objects.set(KEY, saved(Date.now(), "old"));
    await mapFlowField(HOUR);
    await Promise.all(background);
    vi.setSystemTime(Date.parse("2026-11-26T11:30:00Z"));
    await Promise.all([1, 2, 3].map(() => mapFlowField(HOUR)));
    await Promise.all(background);
    await Promise.all(background);
    expect(flowField).toHaveBeenCalledTimes(1);
  });

  it("on Node, keeps an hour's field for a few minutes", async () => {
    onWorker = false;
    vi.useFakeTimers({ now: Date.parse("2026-11-26T11:00:00Z") });
    await mapFlowField("2026-11-26T17:00");
    await mapFlowField("2026-11-26T17:00");
    expect(flowField).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.parse("2026-11-26T11:06:00Z"));
    await mapFlowField("2026-11-26T17:00");
    expect(flowField).toHaveBeenCalledTimes(2);
  });
});
