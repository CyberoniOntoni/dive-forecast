import { describe, expect, it } from "vitest";
import { forecastHours } from "./forecast";
import type { MarineHour } from "./types";

const M2_HOURS = 12.4206012;
const HOURS = 72;

/** Semidiurnal tide with an optional current: a tidal part along `axisDeg` plus a steady drift heading `driftDeg`. */
function series(opts: { tideCurrent?: number; driftMs?: number; driftDeg?: number; axisDeg?: number } = {}): MarineHour[] {
  const { tideCurrent = 0, driftMs = 0, driftDeg = 90, axisDeg = 90 } = opts;
  const origin = Date.UTC(2026, 8, 1, 0, 0);
  return Array.from({ length: HOURS }, (_, index) => {
    const phase = (2 * Math.PI * index) / M2_HOURS;
    const along = tideCurrent * Math.sin(phase - 1);
    const east = along * Math.sin((axisDeg * Math.PI) / 180) + driftMs * Math.sin((driftDeg * Math.PI) / 180);
    const north = along * Math.cos((axisDeg * Math.PI) / 180) + driftMs * Math.cos((driftDeg * Math.PI) / 180);
    return {
      time: new Date(origin + index * 3600_000).toISOString().slice(0, 16),
      seaLevelM: 0.5 + 0.4 * Math.sin(phase),
      currentVelocityMs: Math.hypot(east, north),
      currentDirectionDeg: (((Math.atan2(east, north) * 180) / Math.PI) % 360 + 360) % 360,
    };
  });
}

const strengths = (hours: MarineHour[], bearing = 90) =>
  forecastHours({ hours, inwardBearingDeg: bearing, reports: [] }).map((hour) => `${hour.time}:${hour.direction}:${hour.strength}`);

describe("through-flow uses the drift, not the tidal current", () => {
  const calm = series();

  it("a purely tidal current along the pass axis changes nothing", () => {
    // A 0.4 m/s tidal stream along the axis has no mean. With the hourly current it would shift most runs.
    expect(strengths(series({ tideCurrent: 0.4 }))).toEqual(strengths(calm));
  });

  it("keeps the same result at the ends of the series as in the middle", () => {
    const withTide = forecastHours({ hours: series({ tideCurrent: 0.4 }), inwardBearingDeg: 90, reports: [] });
    const plain = forecastHours({ hours: calm, inwardBearingDeg: 90, reports: [] });
    for (const index of [0, 1, 5, withTide.length - 6, withTide.length - 1]) {
      expect(withTide[index].strength).toBe(plain[index].strength);
    }
  });

  it("a steady drift along the inward axis lengthens the flood and shortens the ebb", () => {
    const drifted = forecastHours({ hours: series({ driftMs: 0.2, driftDeg: 90 }), inwardBearingDeg: 90, reports: [] });
    const plain = forecastHours({ hours: calm, inwardBearingDeg: 90, reports: [] });
    const count = (list: typeof plain, direction: string) => list.filter((hour) => hour.direction === direction).length;
    expect(drifted).toHaveLength(plain.length);
    expect(count(drifted, "incoming")).toBeGreaterThan(count(plain, "incoming"));
    expect(count(drifted, "outgoing")).toBeLessThan(count(plain, "outgoing"));
    // At 0.2 m/s the tide still turns it: some hours still run out.
    expect(count(drifted, "outgoing")).toBeGreaterThan(0);
  });

  it("a tide plus a drift gives the same strengths as the drift alone", () => {
    const driftOnly = strengths(series({ driftMs: 0.35, driftDeg: 90 }));
    const both = strengths(series({ tideCurrent: 0.4, driftMs: 0.35, driftDeg: 90 }));
    expect(both).toEqual(driftOnly);
  });

  it("a drift across the pass axis changes nothing", () => {
    expect(strengths(series({ driftMs: 0.4, driftDeg: 0 }))).toEqual(strengths(calm));
  });

  it("an hour with no usable current in a full series falls back rather than throwing", () => {
    const hours = series({ driftMs: 0.4 }).map((hour, index) =>
      index % 2 === 0 ? { ...hour, currentVelocityMs: null, currentDirectionDeg: null } : hour,
    );
    expect(() => forecastHours({ hours, inwardBearingDeg: 90, reports: [] })).not.toThrow();
  });
});
