import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { marineCacheDir, marineCacheName } from "./marine";
import type { SiteLoad } from "./load-site";
import type { Site } from "./types";

const loadSite = vi.fn<(...args: unknown[]) => Promise<SiteLoad>>();
vi.mock("./load-site", () => ({ loadSite: (...args: unknown[]) => loadSite(...args) }));

const { routeCurrent, samplePoints } = await import("./route-current-data");
const { currentHeading, currentKnots, STRENGTH_KNOTS } = await import("./route-current");

const NOW = Date.UTC(2026, 9, 30, 3, 0);

/** A Maldives wall-clock hour string, `offset` hours from NOW. */
function wall(offset: number): string {
  return new Date(NOW + (offset + 5) * 3_600_000).toISOString().slice(0, 16);
}

/** A route far out at sea, east of every atoll: 3°N, 75°E to 3°N, 75.05°E. */
const SEA_ROUTE: [number, number][] = [
  [3, 75],
  [3, 75.05],
];

beforeEach(() => {
  loadSite.mockReset();
});

describe("samplePoints", () => {
  it("puts a sample every step from start to end", () => {
    const { stepKm, points } = samplePoints(SEA_ROUTE);
    expect(stepKm).toBe(0.25);
    expect(points[0]).toEqual({ lat: 3, lon: 75 });
    expect(points.length).toBe(Math.floor(5.55 / 0.25) + 1);
    expect(points.every((point) => point.lat === 3 && point.lon >= 75 && point.lon <= 75.05)).toBe(true);
  });

  it("spreads samples out on a long route", () => {
    const { stepKm, points } = samplePoints([
      [3, 74],
      [3, 75],
    ]);
    expect(points.length).toBeLessThanOrEqual(200);
    expect(stepKm).toBeGreaterThan(0.25);
  });
});

describe("routeCurrent", () => {
  it("reads the ocean model's current out at sea from the cached series", async () => {
    const hours = [-2, 0, 1, 20].map((offset) => ({
      time: wall(offset),
      seaLevelM: 0,
      currentVelocityMs: 0.5,
      currentDirectionDeg: 90,
    }));
    fs.mkdirSync(marineCacheDir(), { recursive: true });
    fs.writeFileSync(path.join(marineCacheDir(), marineCacheName(3, 75)), JSON.stringify({ fetchedAt: Date.now(), hours }));

    const current = await routeCurrent(SEA_ROUTE, [], NOW);
    expect(current.sources).toHaveLength(1);
    expect(current.sources[0].siteId).toBeNull();
    // Only the hours from an hour ago to 12 h ahead.
    expect(current.sources[0].hours.map((hour) => hour.timeMs)).toEqual([NOW, NOW + 3_600_000]);
    expect(currentKnots(current.sources[0].hours[0])).toBeCloseTo(0.5 * (3600 / 1852), 6);
    expect(currentHeading(current.sources[0].hours[0])).toBeCloseTo(90, 6);
    // The far end snaps to the next grid node east, which has no cached series yet.
    expect(current.samples[0]).toBe(0);
    expect(current.samples.at(-1)).toBe(-1);
  });

  it("takes a nearby site's forecast as its arrow heading at the band's speed", async () => {
    const site = { id: "kandu", name: "Test Kandu", atollId: "none", lat: 3, lon: 75.02 } as Site;
    loadSite.mockResolvedValue({
      bearing: 270,
      bearingSource: "override",
      siteType: "pass",
      forecastRoute: "channel",
      alongHeadingDeg: null,
      hours: [
        { time: wall(0), direction: "incoming", strength: "strong", confidence: "medium", levelM: 0 },
        { time: wall(1), direction: "outgoing", strength: "too_strong", confidence: "medium", levelM: 0 },
      ],
      unavailable: false,
      stale: false,
      fetchedAt: NOW,
    });
    const far = { ...site, id: "far", lat: 3.2 } as Site;

    const current = await routeCurrent(SEA_ROUTE, [site, far], NOW);
    expect(loadSite).toHaveBeenCalledTimes(1);
    const index = current.sources.findIndex((source) => source.siteId === "kandu");
    const kandu = current.sources[index];
    expect(currentHeading(kandu.hours[0])).toBeCloseTo(270, 6);
    expect(currentKnots(kandu.hours[0])).toBeCloseTo(STRENGTH_KNOTS.strong, 6);
    expect(currentHeading(kandu.hours[1])).toBeCloseTo(90, 6);
    expect(kandu.hours[1].strength).toBe("too_strong");
    // Samples within 0.6 km of the channel pin take its forecast; the 2.2 km mark is the pin.
    const pinSample = Math.round(2.22 / 0.25);
    expect(current.samples[pinSample]).toBe(index);
    expect(current.samples[0]).not.toBe(index);
  });
});
