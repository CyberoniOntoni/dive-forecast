import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSite, slopeWindowForSite } from "./load-site";
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
    channelWidthM: 1500,
    channelDepthM: 80,
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

    // Peak rising hour is amplified to 'strong' or 'too_strong'
    const peakHour = result.hours.find((h) => h.time.startsWith("2026-09-24T03:00"));
    expect(["strong", "too_strong"]).toContain(peakHour?.strength);
  });
});

describe("slopeWindowForSite", () => {
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
    const window = await slopeWindowForSite(site, [site], undefined, "2026-09-23T10:00");
    expect(window).toBeNull();
  });

  it("returns 13-hour slope window when marine fetch succeeds", async () => {
    const syntheticHours: MarineHour[] = Array.from({ length: 72 }, (_, i) => ({
      time: new Date(Date.UTC(2026, 8, 23, i)).toISOString().slice(0, 16),
      seaLevelM: 0.1 * i,
      currentVelocityMs: 0,
      currentDirectionDeg: 0,
    }));

    vi.mocked(Marine.siteMarineHours).mockResolvedValueOnce({
      ok: true,
      hours: syntheticHours,
      fetchedAt: 1234567890,
      stale: false,
    });

    const window = await slopeWindowForSite(site, [site], atoll, "2026-09-24T12:00");
    expect(window).toHaveLength(13);
    expect(window?.every((slope) => typeof slope === "number")).toBe(true);
  });
});
