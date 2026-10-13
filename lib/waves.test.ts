import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWaves, waveHoursFromApi } from "./waves";

const BODY = {
  hourly: {
    time: ["2026-10-13T00:00", "2026-10-13T01:00"],
    swell_wave_height: [1.2, null],
    swell_wave_direction: [180, 185],
    swell_wave_period: [11, 11.5],
    secondary_swell_wave_height: [0.3, 0.3],
    secondary_swell_wave_direction: [90, 90],
    secondary_swell_wave_period: [null, 7],
    wind_wave_height: [0.4, 0.5],
    wind_wave_direction: [60, 65],
    wind_wave_period: [3.5, 3.6],
  },
};

describe("waveHoursFromApi", () => {
  it("reads each component, leaving out ones with no height", () => {
    const hours = waveHoursFromApi(BODY);
    expect(hours).toHaveLength(2);
    expect(hours?.[0].swell).toEqual({ heightM: 1.2, fromDeg: 180, periodS: 11 });
    expect(hours?.[0].secondarySwell).toEqual({ heightM: 0.3, fromDeg: 90, periodS: null });
    expect(hours?.[1].swell).toBeNull();
    expect(hours?.[1].windWave?.heightM).toBe(0.5);
  });

  it("rejects an error body", () => {
    expect(waveHoursFromApi({ error: true, reason: "nope" })).toBeNull();
    expect(waveHoursFromApi(null)).toBeNull();
  });
});

describe("fetchWaves", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("fetches once, then serves the cache", async () => {
    const stub = vi.fn(async () => new Response(JSON.stringify(BODY), { status: 200 }));
    globalThis.fetch = stub as unknown as typeof fetch;
    const first = await fetchWaves(4.25, 73.75);
    const second = await fetchWaves(4.25, 73.75);
    expect(first.ok && second.ok).toBe(true);
    expect(stub).toHaveBeenCalledTimes(1);
    expect(String((stub.mock.calls[0] as unknown[])[0])).toContain("swell_wave_height");
  });

  it("is pending, not failed, on a first fetch it does not wait for", async () => {
    globalThis.fetch = (() => new Promise(() => {})) as typeof fetch;
    const result = await fetchWaves(4.5, 73.5, { wait: false });
    expect(result).toEqual({ ok: false, unavailable: true, pending: true });
  });
});
