import { describe, expect, it } from "vitest";
import { ringSamples, type AtollRing } from "./atoll-ring";
import { blendHours, gapFlows, reefFlows } from "./flow-gaps";
import type { ReefOpening } from "./openings";
import type { RimRing } from "./rim";
import type { MarineHour, Site } from "./types";

// A square atoll about 22 km across round 4°N 73.5°E.
const RIM: RimRing = [
  [3.9, 73.4],
  [3.9, 73.6],
  [4.1, 73.6],
  [4.1, 73.4],
  [3.9, 73.4],
];

/** Four days of hours: a semi-diurnal tide and a steady current heading `currentDeg` at `currentMs`. */
function week(currentDeg: number, currentMs: number): MarineHour[] {
  return Array.from({ length: 96 }, (_, index) => {
    const day = 1 + Math.floor(index / 24);
    return {
      time: `2026-09-0${day}T${String(index % 24).padStart(2, "0")}:00`,
      seaLevelM: 0.4 * Math.sin((2 * Math.PI * index) / 12.42),
      currentVelocityMs: currentMs,
      currentDirectionDeg: currentDeg,
    };
  });
}

function ring(series: MarineHour[]): AtollRing {
  const samples = ringSamples(RIM);
  return { samples, series: samples.map(() => series), level: [] };
}

const EAST_GAP: ReefOpening = { lat: 4.0, lon: 73.6, widthM: 400, wayId: "1", atollIds: ["square"] };

describe("blendHours", () => {
  it("blends sea level as a mean and the current as a vector", () => {
    const a = [{ time: "t", seaLevelM: 1, currentVelocityMs: 1, currentDirectionDeg: 90 }];
    const b = [{ time: "t", seaLevelM: 0, currentVelocityMs: 1, currentDirectionDeg: 0 }];
    const [hour] = blendHours(a, b, 0.5);
    expect(hour.seaLevelM).toBeCloseTo(0.5, 9);
    expect(hour.currentDirectionDeg).toBeCloseTo(45, 6);
    expect(hour.currentVelocityMs).toBeCloseTo(Math.SQRT1_2, 6);
  });
});

describe("gapFlows", () => {
  it("floods every gap along its inward normal or ebbs out along it, and names the catalog sites in it", () => {
    const series = week(0, 0);
    const site = { id: "east-pass", lat: 4.002, lon: 73.601 } as Site;
    const far = { id: "far", lat: 4.05, lon: 73.6 } as Site;
    const hours = series.slice(24, 72).map((hour) => hour.time);
    const headings = new Set<number>();
    for (const time of hours) {
      const [gap] = gapFlows([EAST_GAP], RIM, ring(series), [site, far], time);
      if (!gap) continue;
      headings.add(gap.headingDeg);
      expect(gap.siteIds).toEqual(["east-pass"]);
      expect(gap.widthM).toBe(400);
    }
    // West into the lagoon on the flood, east out on the ebb.
    expect([...headings].sort((a, b) => a - b)).toEqual([90, 270]);
  });

  it("names a pin on the side of a wide gap with that gap, and each pin with its nearest gap only", () => {
    const series = week(0, 0);
    const time = series[40].time;
    const wide = { ...EAST_GAP, widthM: 2000 };
    const north = { ...EAST_GAP, lat: 4.05, widthM: 200 };
    // 1.3 km from the wide gap's point, 0.3 km past its edge; 4.2 km from the narrow one.
    const side = { id: "side", lat: 4.0 + 1.3 / 110.57, lon: 73.601 } as Site;
    const [first, second] = gapFlows([wide, north], RIM, ring(series), [side], time);
    expect(first.siteIds).toEqual(["side"]);
    expect(second.siteIds).toEqual([]);
  });

  it("gives a gap a reef flat bridges less than an open one", () => {
    const series = week(270, 0.6);
    const time = series[40].time;
    const [open] = gapFlows([EAST_GAP], RIM, ring(series), [], time);
    const [bridged] = gapFlows([{ ...EAST_GAP, reefFlatBridges: true }], RIM, ring(series), [], time);
    expect(open.knots).toBeGreaterThan(0);
    expect(bridged.knots).toBeLessThan(open.knots);
  });

  it("runs with no head across the atoll when told to, as on a flow-only outline", () => {
    const series = week(0, 0);
    // A lagoon level lagging the sea by about a quarter tide: a strong head through the gap.
    const lagged: AtollRing = {
      ...ring(series),
      level: series.map((hour, index) => ({ time: hour.time, levelM: 0.4 * Math.sin((2 * Math.PI * (index - 3)) / 12.42) })),
    };
    const times = series.slice(24, 72).map((hour) => hour.time);
    const flows = (from: AtollRing, head: boolean) => times.map((time) => gapFlows([EAST_GAP], RIM, from, [], time, head)[0]);
    expect(flows(lagged, false)).toEqual(flows(ring(series), true));
    expect(flows(lagged, true)).not.toEqual(flows(lagged, false));
  });

  it("leaves out a gap with no series near it", () => {
    const samples = ringSamples(RIM);
    const empty: AtollRing = { samples, series: samples.map(() => null), level: [] };
    expect(gapFlows([EAST_GAP], RIM, empty, [], "2026-09-02T10:00")).toEqual([]);
  });
});

describe("reefFlows", () => {
  it("signs each ring point's along-reef current by which way round the atoll it runs", () => {
    // A steady 1 m/s current heading north: on the east rim that is the inward normal (west) turned clockwise.
    const north = reefFlows(ring(week(0, 1)), "2026-09-02T10:00");
    const south = reefFlows(ring(week(180, 1)), "2026-09-02T10:00");
    const samples = ringSamples(RIM);
    const eastIndex = samples.findIndex((sample) => sample.on.lon > 73.599 && Math.abs(sample.on.lat - 4) < 0.06);
    expect(eastIndex).toBeGreaterThanOrEqual(0);
    const east = (list: typeof north) => list.find((point) => point.lat === Math.round(samples[eastIndex].on.lat * 1e5) / 1e5)!;
    expect(east(north).knots).toBeGreaterThan(0);
    expect(east(south).knots).toBeLessThan(0);
  });
});
