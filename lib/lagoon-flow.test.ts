import { describe, expect, it } from "vitest";
import { ringSamples, type AtollRing } from "./atoll-ring";
import { alongReportDirection } from "./forecast";
import { nowcastGlance } from "./nowcast-glance";
import {
  lagoonHours,
  lagoonSink,
  lagoonStrength,
  lagoonVelocity,
  mainAxisDeg,
  rimSources,
  type LagoonSource,
} from "./lagoon-flow";
import type { RimRing } from "./rim";
import type { MarineHour, Report } from "./types";

// A square atoll about 22 km across, centred on 4°N 73.5°E.
const RIM: RimRing = [
  [3.9, 73.4],
  [3.9, 73.6],
  [4.1, 73.6],
  [4.1, 73.4],
  [3.9, 73.4],
];
const TIME = "2026-09-01T00:00";
const centre = { lat: 4.0, lon: 73.5 };
const nearWest = { lat: 4.0, lon: 73.42 }; // about 2 km inside the west rim

/** A source at a point with one flow value at TIME. */
function source(lat: number, lon: number, q: number, weightKm = 1): LagoonSource {
  return { lat, lon, weightKm, flow: new Map([[TIME, q]]) };
}

/** Sources spaced evenly round the square rim, all with the same flow. */
function uniformRim(q: number): LagoonSource[] {
  return ringSamples(RIM).map((sample) => source(sample.on.lat, sample.on.lon, q, 7));
}

describe("lagoon flow from the rim's openings", () => {
  it("spreads the flood inward, away from the nearest rim, and draws it back on the ebb", () => {
    const sink = lagoonSink(nearWest, RIM);
    const flood = lagoonVelocity(nearWest, uniformRim(0.2), TIME, sink)!;
    const ebb = lagoonVelocity(nearWest, uniformRim(-0.2), TIME, sink)!;
    // Away from the west rim is east.
    expect(flood.east).toBeGreaterThan(0);
    expect(ebb.east).toBeLessThan(0);
  });

  it("has almost no filling flow at the centre of a symmetric lagoon", () => {
    const u = lagoonVelocity(centre, uniformRim(0.2), TIME, lagoonSink(centre, RIM))!;
    const off = lagoonVelocity(nearWest, uniformRim(0.2), TIME, lagoonSink(nearWest, RIM))!;
    expect(Math.hypot(u.east, u.north)).toBeLessThan(Math.hypot(off.east, off.north) / 3);
  });

  it("carries the water across from openings running in to openings running out", () => {
    const sources = ringSamples(RIM).map((sample) =>
      source(sample.on.lat, sample.on.lon, sample.on.lon < 73.5 ? 0.2 : sample.on.lon > 73.5 ? -0.2 : 0, 7),
    );
    const u = lagoonVelocity(centre, sources, TIME, lagoonSink(centre, RIM))!;
    expect(u.east).toBeGreaterThan(Math.abs(u.north));
  });

  it("lets a channel close by dominate", () => {
    const site = { lat: 3.92, lon: 73.5 };
    const channel = source(3.9, 73.5, 0.3, 2);
    const u = lagoonVelocity(site, [...uniformRim(0), channel], TIME, lagoonSink(site, RIM))!;
    // The channel runs in at the south rim, so the thila 2 km north of it runs north.
    expect(u.north).toBeGreaterThan(Math.abs(u.east));
  });

  it("has no hour when fewer than half the openings have it", () => {
    const sources = uniformRim(0.1).map((item, index) => (index % 3 === 0 ? item : { ...item, flow: new Map() }));
    expect(lagoonVelocity(centre, sources, TIME)).toBeNull();
  });
});

describe("rimSources", () => {
  it("puts two openings per ring sample, each standing for its share of the perimeter", () => {
    const samples = ringSamples(RIM);
    const hours: MarineHour[] = Array.from({ length: 72 }, (_, index) => ({
      time: `2026-09-${String(1 + Math.floor(index / 24)).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:00`,
      seaLevelM: 0.4 * Math.sin((2 * Math.PI * index) / 12.42),
      currentVelocityMs: 0,
      currentDirectionDeg: 0,
    }));
    const ring: AtollRing = {
      samples,
      series: samples.map(() => hours),
      level: hours.map((hour) => ({ time: hour.time, levelM: 0 })),
    };
    const sources = rimSources(ring);
    expect(sources).toHaveLength(2 * samples.length);
    const total = sources.reduce((sum, item) => sum + item.weightKm, 0);
    // The square's perimeter is about 88 km.
    expect(total).toBeGreaterThan(80);
    expect(total).toBeLessThan(95);
  });
});

describe("lagoonHours", () => {
  it("projects on the flow's main axis and turns with the tide", () => {
    const times = Array.from({ length: 48 }, (_, index) => `2026-09-0${1 + Math.floor(index / 24)}T${String(index % 24).padStart(2, "0")}:00`);
    const flood = (index: number) => 0.2 * Math.sin((2 * Math.PI * index) / 12.42);
    const sources = ringSamples(RIM).map((sample) => ({
      lat: sample.on.lat,
      lon: sample.on.lon,
      weightKm: 7,
      flow: new Map(times.map((time, index) => [time, flood(index)])),
    }));
    const levels = times.map((time) => ({ time, levelM: 0 }));
    const result = lagoonHours(nearWest, sources, levels, lagoonSink(nearWest, RIM));
    expect(result.axisDeg).not.toBeNull();
    expect(result.axisDeg!).toBeGreaterThanOrEqual(0);
    expect(result.axisDeg!).toBeLessThan(180);
    // The flood spreads east from the west rim: the axis runs east-west.
    expect(Math.abs(result.axisDeg! - 90)).toBeLessThan(20);
    const directions = result.hours.map((hour) => hour.direction);
    expect(new Set(directions).size).toBe(2);
    expect(result.hours.every((hour) => hour.confidence === "low")).toBe(true);
  });
});

describe("mainAxisDeg and lagoonStrength", () => {
  it("finds the axis of back-and-forth vectors, in [0, 180)", () => {
    expect(mainAxisDeg([{ east: 0, north: 1 }, { east: 0, north: -1 }])).toBeCloseTo(0, 6);
    expect(mainAxisDeg([{ east: 1, north: 0 }, { east: -1, north: 0 }])).toBeCloseTo(90, 6);
    expect(mainAxisDeg([{ east: 1, north: 1 }, { east: -1, north: -1 }])).toBeCloseTo(45, 6);
  });

  it("bands the lagoon flow index", () => {
    expect(lagoonStrength(0.01)).toBe("slack");
    expect(lagoonStrength(0.1)).toBe("mild");
    expect(lagoonStrength(0.18)).toBe("mild");
    expect(lagoonStrength(0.3)).toBe("strong");
    expect(lagoonStrength(0.6)).toBe("too_strong");
  });
});

describe("lagoon reports", () => {
  const base: Report = { id: "r", siteId: "thila", time: "2026-09-02T10:00", direction: "incoming", strength: "mild" };

  it("reads a report by its saved heading", () => {
    expect(alongReportDirection({ ...base, alongHeadingDeg: 10 }, 10, "lagoon")).toBe("incoming");
    expect(alongReportDirection({ ...base, alongHeadingDeg: 10 }, 170, "lagoon")).toBe("outgoing");
  });

  it("has no reading without one, even from an along-reef model's prediction", () => {
    const predicted: Report["predicted"] = {
      modelVersion: "tide+throughflow+head+alongreef/11",
      nudge: "drift",
      issuedAt: null,
      stale: false,
      bearingDeg: 270,
      bearingSource: "fallback",
      shown: { direction: "incoming", strength: "mild", confidence: "low" },
      modelOnly: null,
    };
    expect(alongReportDirection({ ...base, predicted }, 0, "lagoon")).toBeNull();
    expect(alongReportDirection({ ...base, predicted }, 0, "wall")).toBe("incoming");
  });
});

describe("lagoon glance", () => {
  it("says which way a lagoon site runs, without calling it a reef", () => {
    const glance = nowcastGlance(
      "Thila",
      {
        siteId: "thila",
        atollId: "a",
        inwardBearingDeg: 270,
        alongHeadingDeg: 90,
        lagoon: true,
        unavailable: false,
        hour: { time: TIME, direction: "incoming", strength: "mild", confidence: "low", levelM: 0 },
      },
      true,
    );
    expect(glance.spoken).toBe("Thila, running E, mild, low");
    expect(glance.arrowBearing).toBe(90);
  });
});
