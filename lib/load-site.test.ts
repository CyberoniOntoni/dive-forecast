import { beforeEach, describe, expect, it, vi } from "vitest";
import { alongHeadingFor, loadSite, reportTideForSite } from "./load-site";
import * as Marine from "./marine";
import type { Atoll, MarineHour, Site } from "./types";

// Mock marine fetch module to ensure fast, deterministic offline execution
vi.mock("./marine", async () => {
  const actual = await vi.importActual<typeof import("./marine")>("./marine");
  return {
    ...actual,
    siteMarineHours: vi.fn(),
    marineSeriesStale: vi.fn(() => false),
  };
});

describe("loadSite", () => {
  const atoll: Atoll = {
    id: "north-male",
    name: "North Male Atoll",
    oceanLat: 4.45451,
    oceanLon: 73.7604,
    rimSourceUrl: "https://example.com/rim",
  };

  const openSite: Site = {
    id: "open-reef",
    name: "Open Reef",
    atollId: "north-male",
    lat: 4.234,
    lon: 73.533,
    sourceUrl: "https://example.com/open",
    // channel dimensions undefined
  };

  const constrictedSite: Site = {
    id: "narrow-kandu",
    name: "Narrow Kandu",
    atollId: "north-male",
    lat: 4.234,
    lon: 73.533,
    sourceUrl: "https://example.com/kandu",
    channelWidthM: 300,
    channelDepthM: 20,
    channelDepthKind: "typical",
  };

  const syntheticHours: MarineHour[] = Array.from({ length: 72 }, (_, i) => ({
    time: new Date(Date.UTC(2026, 8, 23, i)).toISOString().slice(0, 16),
    seaLevelM: 0.5 + 0.26 * Math.sin((2 * Math.PI * i) / 12),
    currentVelocityMs: 0,
    currentDirectionDeg: 0,
  }));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns unavailable when atoll is undefined", async () => {
    const result = await loadSite(openSite, [openSite], undefined, []);
    expect(result.unavailable).toBe(true);
    expect(result.bearing).toBeNull();
    expect(result.hours).toEqual([]);
    expect(result.fetchedAt).toBeNull();
  });

  it("returns unavailable when marine fetch fails (not ok)", async () => {
    vi.mocked(Marine.siteMarineHours).mockResolvedValueOnce({
      ok: false,
      unavailable: true,
    });

    const result = await loadSite(openSite, [openSite], atoll, []);
    expect(result.unavailable).toBe(true);
    expect(result.hours).toEqual([]);
  });

  it("keeps a strait wall's and a lagoon site's route when the marine fetch fails", async () => {
    for (const [siteType, route] of [
      ["strait-wall", "strait"],
      ["lagoon", "lagoon"],
      [undefined, "channel"],
    ] as const) {
      vi.mocked(Marine.siteMarineHours).mockResolvedValueOnce({ ok: false, unavailable: true });
      const result = await loadSite({ ...openSite, siteType }, [openSite], atoll, []);
      expect(result.unavailable).toBe(true);
      expect(result.forecastRoute, siteType).toBe(route);
    }
  });

  it("keeps a strait wall's axis when the marine fetch fails, as when it loads", async () => {
    const strait: Site = { ...openSite, siteType: "strait-wall" };
    vi.mocked(Marine.siteMarineHours).mockResolvedValueOnce({ ok: false, unavailable: true });
    const failed = await loadSite(strait, [strait], atoll, []);
    vi.mocked(Marine.siteMarineHours).mockResolvedValueOnce({
      ok: true,
      hours: syntheticHours,
      fetchedAt: 1,
      stale: false,
    });
    const ok = await loadSite(strait, [strait], atoll, []);
    expect(ok.forecastRoute).toBe("strait");
    expect(failed.alongHeadingDeg).not.toBeNull();
    expect(failed.alongHeadingDeg).toBe(ok.alongHeadingDeg);
    expect(failed.alongHeadingDeg).toBe(alongHeadingFor(strait, [strait], atoll));
  });

  it("loads unconstricted site with baseline forecast when channel dimensions are missing", async () => {
    vi.mocked(Marine.siteMarineHours).mockResolvedValueOnce({
      ok: true,
      hours: syntheticHours,
      fetchedAt: 1234567890,
      stale: false,
    });

    const result = await loadSite(openSite, [openSite], atoll, []);
    expect(result.unavailable).toBe(false);
    expect(result.hours.length).toBeGreaterThan(0);
    expect(result.fetchedAt).toBe(1234567890);

    // Peak rising hour at 03:00 has strength 'mild' for unconstricted site
    const peakHour = result.hours.find((h) => h.time.startsWith("2026-09-24T03:00"));
    expect(peakHour?.strength).toBe("mild");
  });

  it("forwards channelWidthM and channelDepthM to forecastHours producing amplified current rating", async () => {
    vi.mocked(Marine.siteMarineHours).mockResolvedValueOnce({
      ok: true,
      hours: syntheticHours,
      fetchedAt: 1234567890,
      stale: false,
    });

    const result = await loadSite(constrictedSite, [constrictedSite], atoll, []);
    expect(result.unavailable).toBe(false);
    expect(result.hours.length).toBeGreaterThan(0);

    // The steepest rising hour of the sine tide (it crosses zero at 00:00) is amplified to 'strong' or 'too_strong'
    const peakHour = result.hours.find((h) => h.time.startsWith("2026-09-24T00:00"));
    expect(["strong", "too_strong"]).toContain(peakHour?.strength);
  });

  it("does not size the channel from a stated maximum depth", async () => {
    const fetched = { ok: true as const, hours: syntheticHours, fetchedAt: 1234567890, stale: false };
    vi.mocked(Marine.siteMarineHours).mockResolvedValue(fetched);
    const typical = await loadSite(constrictedSite, [constrictedSite], atoll, []);
    const maximum = await loadSite({ ...constrictedSite, channelDepthKind: "max" }, [constrictedSite], atoll, []);
    const unsized = await loadSite({ ...constrictedSite, channelWidthM: undefined, channelDepthM: undefined }, [constrictedSite], atoll, []);
    vi.mocked(Marine.siteMarineHours).mockReset();

    expect(maximum.hours.map((hour) => hour.strength)).toEqual(unsized.hours.map((hour) => hour.strength));
    expect(maximum.hours.map((hour) => hour.strength)).not.toEqual(typical.hours.map((hour) => hour.strength));
  });

  it("never gives a lagoon site high confidence, where the same reports make a pass site high", async () => {
    const fetched = { ok: true as const, hours: syntheticHours, fetchedAt: 1234567890, stale: false };
    vi.mocked(Marine.siteMarineHours).mockResolvedValue(fetched);
    const plain = await loadSite(openSite, [openSite], atoll, []);
    // Five reports on the first day's rising tide, each matching the model at its own hour.
    const reports = ["2026-09-24T00:00", "2026-09-24T01:00", "2026-09-24T02:00", "2026-09-24T00:00", "2026-09-24T01:00"].map(
      (time, index) => {
        const hour = plain.hours.find((item) => item.time === time)!;
        return { id: `r${index}`, siteId: "s", time, direction: hour.direction, strength: hour.strength };
      },
    );

    const pass = await loadSite({ ...openSite, siteType: "pass" }, [openSite], atoll, reports);
    const lagoon = await loadSite({ ...openSite, siteType: "lagoon" }, [openSite], atoll, reports);
    vi.mocked(Marine.siteMarineHours).mockReset();

    expect(pass.siteType).toBe("pass");
    expect(pass.hours.some((hour) => hour.confidence === "high")).toBe(true);
    expect(lagoon.siteType).toBe("lagoon");
    expect(lagoon.hours.some((hour) => hour.confidence === "high")).toBe(false);
    // Only confidence changes: the lagoon site's directions and strengths are the pass site's.
    expect(lagoon.hours.map((hour) => [hour.direction, hour.strength])).toEqual(
      pass.hours.map((hour) => [hour.direction, hour.strength]),
    );
  });
});

describe("reportTideForSite", () => {
  const atoll: Atoll = {
    id: "north-male",
    name: "North Male Atoll",
    oceanLat: 4.45451,
    oceanLon: 73.7604,
    rimSourceUrl: "https://example.com/rim",
  };

  const site: Site = {
    id: "test-site",
    name: "Test Site",
    atollId: "north-male",
    lat: 4.234,
    lon: 73.533,
    sourceUrl: "https://example.com/site",
  };

  it("returns null when atoll is missing", async () => {
    const tide = await reportTideForSite(site, [site], undefined, "2026-09-23T10:00");
    expect(tide).toBeNull();
  });

  it("returns the 13-hour slope window and the day's residual range when marine fetch succeeds", async () => {
    // 12-hour sine of amplitude 0.4 m on a rising mean: the 25-hour residual range is about 0.8 m.
    const syntheticHours: MarineHour[] = Array.from({ length: 72 }, (_, i) => ({
      time: new Date(Date.UTC(2026, 8, 23, i)).toISOString().slice(0, 16),
      seaLevelM: 0.01 * i + 0.4 * Math.sin((2 * Math.PI * i) / 12),
      currentVelocityMs: 0,
      currentDirectionDeg: 0,
    }));

    vi.mocked(Marine.siteMarineHours).mockResolvedValueOnce({
      ok: true,
      hours: syntheticHours,
      fetchedAt: 1234567890,
      stale: false,
    });

    const tide = await reportTideForSite(site, [site], atoll, "2026-09-24T12:00");
    expect(tide?.slopeWindowM).toHaveLength(13);
    expect(tide?.slopeWindowM.every((slope) => typeof slope === "number")).toBe(true);
    expect(tide?.rangeM).toBeCloseTo(0.8, 1);
  });
});
