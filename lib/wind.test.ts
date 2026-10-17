import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWind, windHoursFromApi } from "./wind";

const BODY = {
  hourly: {
    time: ["2026-10-17T00:00", "2026-10-17T01:00", "2026-10-17T02:00"],
    wind_speed_10m: [5.2, null, 7.1],
    wind_direction_10m: [250, 255, 260],
  },
};

describe("windHoursFromApi", () => {
  it("reads speed and direction, leaving out hours missing either", () => {
    expect(windHoursFromApi(BODY)).toEqual([
      { time: "2026-10-17T00:00", speedMs: 5.2, fromDeg: 250 },
      { time: "2026-10-17T02:00", speedMs: 7.1, fromDeg: 260 },
    ]);
  });

  it("rejects an error body", () => {
    expect(windHoursFromApi({ error: true, reason: "nope" })).toBeNull();
    expect(windHoursFromApi(null)).toBeNull();
  });
});

describe("fetchWind", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("asks for 10 m wind in m/s, then serves the cache", async () => {
    const stub = vi.fn(async () => new Response(JSON.stringify(BODY), { status: 200 }));
    globalThis.fetch = stub as unknown as typeof fetch;
    const first = await fetchWind(4.25, 73.5);
    const second = await fetchWind(4.25, 73.5);
    expect(first.ok && second.ok).toBe(true);
    expect(stub).toHaveBeenCalledTimes(1);
    const url = String((stub.mock.calls[0] as unknown[])[0]);
    expect(url).toContain("api.open-meteo.com");
    expect(url).toContain("wind_speed_unit=ms");
  });
});
