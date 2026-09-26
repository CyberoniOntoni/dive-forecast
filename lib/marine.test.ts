import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { fetchMarine, marineHoursFromApi, marineSeriesStale, seawardPoint, siteMarineHours, wrapLongitude } from "./marine";
import type { MarineHour } from "./types";

const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

function hour(time: string): MarineHour {
  return { time, seaLevelM: 0.2, currentVelocityMs: null, currentDirectionDeg: null };
}

describe("marineSeriesStale", () => {
  it("is stale when the newest hour is more than 12 hours before now", () => {
    expect(marineSeriesStale([hour("2026-09-24T04:00")], NOW)).toBe(true);
    expect(marineSeriesStale([hour("2026-09-23T16:00"), hour("2026-09-24T04:59")], NOW)).toBe(true);
  });

  it("keeps a series whose newest hour is exactly 12 hours before now", () => {
    expect(marineSeriesStale([hour("2026-09-24T05:00")], NOW)).toBe(false);
  });

  it("uses the newest hour, including one still ahead of now", () => {
    expect(marineSeriesStale([hour("2026-09-23T00:00"), hour("2026-09-24T18:00")], NOW)).toBe(false);
  });

  it("does not treat an offset or Z timestamp as Maldives wall time", () => {
    const stamped = new Date("2026-09-24T00:00:00+05:00").getTime();
    expect(marineSeriesStale([hour("2026-09-24T00:00:00+05:00")], stamped + 12 * HOUR)).toBe(false);
    expect(marineSeriesStale([hour("2026-09-24T00:00:00+05:00")], stamped + 12 * HOUR + 60 * 1000)).toBe(true);
    expect(marineSeriesStale([hour("2026-09-24T00:00:00Z")], Date.parse("2026-09-24T12:00:00Z"))).toBe(false);
  });

  it("is stale when no hour can be read", () => {
    expect(marineSeriesStale([], NOW)).toBe(true);
    expect(marineSeriesStale([hour("not-a-time")], NOW)).toBe(true);
  });
});

const DAY = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.5, 0.4, 0.3];

const marineFixture = JSON.stringify({
  hourly_units: {
    time: "iso8601",
    sea_level_height_msl: "m",
    ocean_current_velocity: "km/h",
    ocean_current_direction: "°",
  },
  hourly: {
    time: Array.from({ length: 48 }, (_, index) => wallTime(index)),
    sea_level_height_msl: Array.from({ length: 48 }, (_, index) => DAY[index % 24]),
    ocean_current_velocity: Array.from({ length: 48 }, () => 5.4),
    ocean_current_direction: Array.from({ length: 48 }, () => 270),
  },
});

describe("marine fixture", () => {
  it("parses the marine fixture and converts km/h to m/s", () => {
    const series = marineHoursFromApi(JSON.parse(marineFixture));
    if (!series) throw new Error("fixture did not parse");
    expect(series).toHaveLength(48);
    expect(series[0].currentVelocityMs).toBeCloseTo(1.5, 5);
    expect(series[0].seaLevelM).toBeCloseTo(0.2, 5);
  });
});

describe("seaward current", () => {
  it("samples about 3 km opposite the inward bearing", () => {
    const lat = 3.9;
    const lon = 73.5;
    const west = seawardPoint(lat, lon, 90);
    expect(west.lon).toBeLessThan(lon);
    expect(west.lat).toBeCloseTo(lat, 2);
    expect(distanceKm(lat, lon, west.lat, west.lon)).toBeCloseTo(3, 2);

    const south = seawardPoint(lat, lon, 0);
    expect(south.lat).toBeLessThan(lat);
    expect(distanceKm(lat, lon, south.lat, south.lon)).toBeCloseTo(3, 2);
  });

  it("uses seaward sea level when that series exists, and the atoll series when the seaward fetch is missing or stale", async () => {
    const lat = 0.1234;
    const lon = 10.5678;
    const bearing = 90;
    const fallbackLat = 0.5;
    const fallbackLon = 11;
    const point = seawardPoint(lat, lon, bearing);
    const fresh = maldivesWall(Date.now());
    const next = maldivesWall(Date.now() + 60 * 60 * 1000);
    const stale = maldivesWall(Date.now() - 13 * 60 * 60 * 1000);
    const seawardBody = marineApiBody([fresh, next], [9, 8], [0.8, null], [200, null]);
    const atollBody = marineApiBody([fresh, next], [0.42, 0.5], [0.1, 0.2], [10, 20]);
    const staleBody = marineApiBody([stale], [9], [0.8], [200]);

    try {
      await withMarineFetch(
        (sampleLat, sampleLon) => {
          if (nearPoint(sampleLat, sampleLon, point.lat, point.lon)) return jsonResponse(seawardBody);
          if (nearPoint(sampleLat, sampleLon, fallbackLat, fallbackLon)) return jsonResponse(atollBody);
          return new Response(null, { status: 404 });
        },
        async (calls) => {
          const sampled = await siteMarineHours(lat, lon, bearing, fallbackLat, fallbackLon);
          expect(sampled.ok).toBe(true);
          if (!sampled.ok) return;
          expect(sampled.stale).toBe(false);
          expect(sampled.hours[0].seaLevelM).toBe(9);
          expect(sampled.hours[0].currentVelocityMs).toBe(0.8);
          expect(sampled.hours[0].currentDirectionDeg).toBe(200);
          expect(sampled.hours[1].seaLevelM).toBe(8);
          expect(sampled.hours[1].currentVelocityMs).toBeNull();
          expect(sampled.hours[1].currentDirectionDeg).toBeNull();
          expect(typeof sampled.fetchedAt).toBe("number");
          expect(calls.length).toBeGreaterThan(0);
          expect(calls.every((call) => nearPoint(call.lat, call.lon, point.lat, point.lon))).toBe(true);
        },
      );

      await withMarineFetch(
        (sampleLat, sampleLon) => {
          if (nearPoint(sampleLat, sampleLon, fallbackLat, fallbackLon)) return jsonResponse(atollBody);
          return new Response(null, { status: 404 });
        },
        async () => {
          const sampled = await siteMarineHours(lat, lon, bearing, fallbackLat, fallbackLon);
          expect(sampled.ok).toBe(true);
          if (!sampled.ok) return;
          expect(sampled.stale).toBe(false);
          expect(sampled.hours).toHaveLength(2);
          expect(sampled.hours[0].seaLevelM).toBe(0.42);
          expect(sampled.hours[0].currentVelocityMs).toBe(0.1);
          expect(sampled.hours[0].currentDirectionDeg).toBe(10);
          expect(sampled.hours[1].seaLevelM).toBe(0.5);
          expect(sampled.hours[1].currentVelocityMs).toBe(0.2);
          expect(sampled.hours[1].currentDirectionDeg).toBe(20);
          expect(typeof sampled.fetchedAt).toBe("number");
        },
      );

      await withMarineFetch(
        (sampleLat, sampleLon) => {
          if (nearPoint(sampleLat, sampleLon, point.lat, point.lon)) return jsonResponse(staleBody);
          if (nearPoint(sampleLat, sampleLon, fallbackLat, fallbackLon)) return jsonResponse(atollBody);
          return new Response(null, { status: 404 });
        },
        async () => {
          const sampled = await siteMarineHours(lat, lon, bearing, fallbackLat, fallbackLon);
          expect(sampled.ok).toBe(true);
          if (!sampled.ok) return;
          expect(sampled.stale).toBe(false);
          expect(sampled.hours[0].seaLevelM).toBe(0.42);
          expect(sampled.hours[0].currentVelocityMs).toBe(0.1);
          expect(sampled.hours[1].seaLevelM).toBe(0.5);
          expect(sampled.hours[1].currentDirectionDeg).toBe(20);
        },
      );
    } finally {
      forgetMarineCache(point.lat, point.lon);
      forgetMarineCache(fallbackLat, fallbackLon);
    }
  });
});

describe("marine cache", () => {
  it("caches parsed hours and returns them without requesting or parsing again", async () => {
    const lat = 1.1111;
    const lon = 73.2222;
    const fresh = maldivesWall(Date.now());
    const body = marineApiBody([fresh], [0.42], [0.1], [10]);
    let cachedRaw: string | null = null;
    let writtenPath = "";
    let fetches = 0;
    vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      if (cachedRaw == null) throw new Error("cache miss");
      return cachedRaw;
    });
    vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined as unknown as string);
    vi.spyOn(fs, "writeFileSync").mockImplementation((file, data) => {
      writtenPath = String(file);
      cachedRaw = String(data);
    });
    vi.stubGlobal("fetch", async () => {
      fetches += 1;
      return jsonResponse(body);
    });
    try {
      const first = await fetchMarine(lat, lon);
      expect(first.ok).toBe(true);
      if (!first.ok || cachedRaw == null) return;
      const stored = JSON.parse(cachedRaw) as { fetchedAt: number; hours: MarineHour[]; body?: unknown };
      expect(stored.body).toBeUndefined();
      expect(stored.fetchedAt).toBe(first.fetchedAt);
      expect(stored.hours).toEqual(first.hours);
      expect(stored.hours).toEqual(marineHoursFromApi(body));
      const name = `${lat.toFixed(4)}_${lon.toFixed(4)}.json`.replace(/[^0-9.+_-]/g, "");
      expect(path.basename(writtenPath)).toBe(name);
      expect(fetches).toBe(1);

      const again = await fetchMarine(lat, lon);
      expect(fetches).toBe(1);
      expect(again).toEqual(first);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      forgetMarineCache(lat, lon);
    }
  });

  it("parses an older cache body once and ignores that body when hours are already stored", async () => {
    const lat = 1.5555;
    const lon = 73.6666;
    const fresh = maldivesWall(Date.now());
    const body = marineApiBody([fresh], [0.42], [0.1], [10]);
    const cachedHours = [hour(fresh)];
    let fetches = 0;
    vi.spyOn(fs, "readFileSync").mockImplementation(() => JSON.stringify({ fetchedAt: Date.now(), body }));
    vi.stubGlobal("fetch", async () => {
      fetches += 1;
      return new Response(null, { status: 404 });
    });
    try {
      const fromBody = await fetchMarine(lat, lon);
      expect(fetches).toBe(0);
      expect(fromBody.ok).toBe(true);
      if (!fromBody.ok) return;
      expect(fromBody.hours).toEqual(marineHoursFromApi(body));

      vi.mocked(fs.readFileSync).mockImplementation(() =>
        JSON.stringify({ fetchedAt: Date.now(), hours: cachedHours, body }),
      );
      const fromHours = await fetchMarine(lat, lon);
      expect(fetches).toBe(0);
      expect(fromHours.ok).toBe(true);
      if (!fromHours.ok) return;
      expect(fromHours.hours).toEqual(cachedHours);
      expect(fromHours.hours).not.toEqual(marineHoursFromApi(body));
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      forgetMarineCache(lat, lon);
    }
  });

  it("-0 and 0 share one cache key", async () => {
    const files = new Map<string, string>();
    const fresh = maldivesWall(Date.now());
    const body = marineApiBody([fresh], [0.42], [0.1], [10]);
    let fetches = 0;
    vi.spyOn(fs, "readFileSync").mockImplementation((file) => {
      const raw = files.get(path.basename(String(file)));
      if (raw == null) throw new Error("cache miss");
      return raw;
    });
    vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined as unknown as string);
    vi.spyOn(fs, "writeFileSync").mockImplementation((file, data) => {
      files.set(path.basename(String(file)), String(data));
    });
    vi.stubGlobal("fetch", async () => {
      fetches += 1;
      return jsonResponse(body);
    });
    try {
      const first = await fetchMarine(0, 0);
      const second = await fetchMarine(-0, -0);
      expect(first.ok).toBe(true);
      expect(second).toEqual(first);
      expect(fetches).toBe(1);
      expect([...files.keys()]).toEqual(["0.0000_0.0000."]);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      forgetMarineCache(0, 0);
      forgetMarineCache(-0, -0);
    }
  });
});

describe("wrapLongitude", () => {
  it("wrapLongitude(-550) is inside [-180, 180]", () => {
    expect(wrapLongitude(-550)).toBeGreaterThanOrEqual(-180);
    expect(wrapLongitude(-550)).toBeLessThanOrEqual(180);
  });
});

describe("marine fetch", () => {
  it("writeCache throw does not make a successful fetch unavailable", async () => {
    const lat = 1.0101;
    const lon = 73.0101;
    const fresh = maldivesWall(Date.now());
    const body = marineApiBody([fresh], [0.42], [0.1], [10]);
    vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("cache miss");
    });
    vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined as unknown as string);
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("disk full");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => jsonResponse(body));
    try {
      await expect(fetchMarine(lat, lon)).resolves.toMatchObject({
        ok: true,
        stale: false,
        hours: marineHoursFromApi(body),
      });
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      forgetMarineCache(lat, lon);
    }
  });

  it("first endpoint is marine-api", async () => {
    const lat = 1.0202;
    const lon = 73.0202;
    const fresh = maldivesWall(Date.now());
    const body = marineApiBody([fresh], [0.42], [0.1], [10]);
    const urls: string[] = [];
    vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("cache miss");
    });
    vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined as unknown as string);
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return jsonResponse(body);
    });
    try {
      const result = await fetchMarine(lat, lon);
      expect(result.ok).toBe(true);
      expect(urls[0].startsWith("https://marine-api.open-meteo.com/v1/marine?")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      forgetMarineCache(lat, lon);
    }
  });

  it("HTTP 429 is unavailable without throw", async () => {
    const lat = 1.0303;
    const lon = 73.0303;
    vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("cache miss");
    });
    vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined as unknown as string);
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => new Response(null, { status: 429 }));
    try {
      await expect(fetchMarine(lat, lon)).resolves.toEqual({ ok: false, unavailable: true });
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      forgetMarineCache(lat, lon);
    }
  });

  it("fetch init includes a timeout signal", async () => {
    const lat = 1.0404;
    const lon = 73.0404;
    const fresh = maldivesWall(Date.now());
    const body = marineApiBody([fresh], [0.42], [0.1], [10]);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    let init: RequestInit | undefined;
    vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("cache miss");
    });
    vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined as unknown as string);
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, options?: RequestInit) => {
      init = options;
      return jsonResponse(body);
    });
    try {
      const result = await fetchMarine(lat, lon);
      expect(result.ok).toBe(true);
      expect(timeout).toHaveBeenCalledWith(8000);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      forgetMarineCache(lat, lon);
    }
  });
});

describe("stale marine cache", () => {
  it("returns a cache older than 6 hours when the network fails", async () => {
    const lat = 2.2222;
    const lon = 73.4444;
    const bearing = 90;
    const fallbackLat = 2.8;
    const fallbackLon = 74.1;
    const point = seawardPoint(lat, lon, bearing);
    const cachedHours = [
      { time: maldivesWall(Date.now()), seaLevelM: 0.77, currentVelocityMs: 0.3, currentDirectionDeg: 40 },
    ];
    const fetchedAt = Date.now() - 7 * HOUR;
    const seawardName = `${point.lat.toFixed(4)}_${point.lon.toFixed(4)}.json`.replace(/[^0-9.+_-]/g, "");
    let fetches = 0;
    vi.spyOn(fs, "readFileSync").mockImplementation((file) => {
      if (path.basename(String(file)) === seawardName) return JSON.stringify({ fetchedAt, hours: cachedHours });
      throw new Error("cache miss");
    });
    vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined as unknown as string);
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", async () => {
      fetches += 1;
      return new Response(null, { status: 404 });
    });
    try {
      const sampled = await siteMarineHours(lat, lon, bearing, fallbackLat, fallbackLon);
      expect(fetches).toBeGreaterThan(0);
      expect(sampled).toEqual({ ok: true, hours: cachedHours, fetchedAt, stale: true });
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      forgetMarineCache(point.lat, point.lon);
      forgetMarineCache(fallbackLat, fallbackLon);
    }
  });

  it("stays unavailable when no cache file exists and the network fails", async () => {
    const lat = 2.3333;
    const lon = 73.5555;
    const bearing = 90;
    const fallbackLat = 2.9;
    const fallbackLon = 74.2;
    const point = seawardPoint(lat, lon, bearing);
    let fetches = 0;
    vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("cache miss");
    });
    vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined as unknown as string);
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", async () => {
      fetches += 1;
      return new Response(null, { status: 404 });
    });
    try {
      const sampled = await siteMarineHours(lat, lon, bearing, fallbackLat, fallbackLon);
      expect(fetches).toBeGreaterThan(0);
      expect(sampled).toEqual({ ok: false, unavailable: true });
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      forgetMarineCache(point.lat, point.lon);
      forgetMarineCache(fallbackLat, fallbackLon);
    }
  });
});

function wallTime(index: number): string {
  const day = index < 24 ? "2026-09-23" : "2026-09-24";
  const hour = String(index % 24).padStart(2, "0");
  return `${day}T${hour}:00`;
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function maldivesWall(utcMs: number): string {
  return new Date(utcMs + 5 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

function marineApiBody(
  times: string[],
  levels: number[],
  velocities: (number | null)[],
  directions: (number | null)[],
) {
  return {
    hourly_units: { ocean_current_velocity: "m/s" },
    hourly: {
      time: times,
      sea_level_height_msl: levels,
      ocean_current_velocity: velocities,
      ocean_current_direction: directions,
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function nearPoint(lat: number, lon: number, otherLat: number, otherLon: number): boolean {
  return Math.abs(lat - otherLat) < 1e-5 && Math.abs(lon - otherLon) < 1e-5;
}

function forgetMarineCache(lat: number, lon: number) {
  const name = `${(lat === 0 ? 0 : lat).toFixed(4)}_${(lon === 0 ? 0 : lon).toFixed(4)}.json`.replace(/[^0-9.+_-]/g, "");
  fs.rmSync(path.join(process.cwd(), "data", "marine-cache", name), { force: true });
}

async function withMarineFetch(
  handler: (lat: number, lon: number) => Response,
  run: (calls: { lat: number; lon: number }[]) => Promise<void>,
): Promise<void> {
  const calls: { lat: number; lon: number }[] = [];
  vi.spyOn(fs, "readFileSync").mockImplementation(() => {
    throw new Error("cache miss");
  });
  vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined as unknown as string);
  vi.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const params = new URL(String(input)).searchParams;
    const lat = Number(params.get("latitude"));
    const lon = Number(params.get("longitude"));
    calls.push({ lat, lon });
    return handler(lat, lon);
  });
  try {
    await run(calls);
  } finally {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
}
