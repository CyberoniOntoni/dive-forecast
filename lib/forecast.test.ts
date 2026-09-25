import { describe, expect, it } from "vitest";
import { forecastHours, residualSlopeWindow, seaLevelSlopeAt } from "./forecast";
import type { MarineHour, Report } from "./types";

const DAY = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.5, 0.4, 0.3];

const series: MarineHour[] = marineFromLevels(
  "2026-09-22T00:00",
  Array.from({ length: 72 }, (_, index) => DAY[index % 24]),
).map((hour) => ({
  ...hour,
  currentVelocityMs: 5.4 / 3.6,
  currentDirectionDeg: 270,
}));

const outgoingReport: Report = {
  id: "r1",
  siteId: "banana-reef",
  time: "2026-09-23T02:00",
  direction: "outgoing",
  strength: "mild",
};

const lagLevels = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0];

describe("forecastHours", () => {
  it("gives different directions at the same hour for two out-of-phase series", () => {
    const rising = marineFromLevels("2026-09-23T00:00", [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9]);
    const falling = marineFromLevels("2026-09-23T00:00", [0.9, 0.75, 0.6, 0.45, 0.3, 0.15, 0]);
    const flood = forecastHours({ hours: rising, inwardBearingDeg: 90, reports: [] });
    const ebb = forecastHours({ hours: falling, inwardBearingDeg: 90, reports: [] });
    expect(directionAt(flood, "2026-09-23T02:00")).toBe("incoming");
    expect(directionAt(ebb, "2026-09-23T02:00")).toBe("outgoing");
  });

  it("does not keep reports from one call in a later call that omits them", () => {
    const hours = marineFromLevels("2026-09-23T00:00", [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9]);
    const report: Report = {
      id: "once",
      siteId: "west-pass",
      time: "2026-09-23T01:00",
      direction: "outgoing",
      strength: "mild",
    };
    const pulled = forecastHours({ hours, inwardBearingDeg: 90, reports: [report] });
    const omitted = forecastHours({ hours, inwardBearingDeg: 90 });
    expect(directionAt(pulled, "2026-09-23T02:00")).toBe("outgoing");
    expect(directionAt(omitted, "2026-09-23T02:00")).toBe("incoming");
    expect(omitted).toEqual(forecastHours({ hours, inwardBearingDeg: 90, reports: [] }));
  });

  it("follows the residual sea-level slope and stays low confidence with no reports", () => {
    const forecast = forecastHours({
      hours: series,
      inwardBearingDeg: 270,
      reports: [],
    });
    expect(forecast.length).toBeGreaterThan(0);
    expect(forecast.every((hour) => hour.confidence === "low")).toBe(true);
    for (let index = 0; index < series.length; index += 1) {
      const slope = seaLevelSlopeAt(series, series[index].time);
      const hour = forecast.find((item) => item.time === series[index].time);
      if (slope == null || slope === 0) {
        expect(hour).toBeUndefined();
        continue;
      }
      expect(hour?.direction).toBe(slope > 0 ? "incoming" : "outgoing");
    }
  });

  it("moves the next hours toward a fresh report and leaves tomorrow on the tide", () => {
    const plain = forecastHours({ hours: series, inwardBearingDeg: 270, reports: [] });
    const pulled = forecastHours({ hours: series, inwardBearingDeg: 270, reports: [outgoingReport] });
    expect(directionAt(plain, "2026-09-23T03:00")).toBe("incoming");
    expect(directionAt(plain, "2026-09-23T05:00")).toBe("incoming");
    expect(directionAt(pulled, "2026-09-23T03:00")).toBe("outgoing");
    expect(directionAt(pulled, "2026-09-23T05:00")).toBe("outgoing");
    expect(directionAt(pulled, "2026-09-24T02:00")).toBe("incoming");
    expect(directionAt(plain, "2026-09-24T02:00")).toBe("incoming");
  });

  it("uses a learned phase offset on the next day instead of the fresh-report pull", () => {
    const custom = repeatingHours();
    const reports: Report[] = [
      { id: "a", siteId: "s", time: "2026-09-23T03:00", direction: "outgoing", strength: "mild" },
      { id: "b", siteId: "s", time: "2026-09-23T04:00", direction: "outgoing", strength: "mild" },
    ];
    const learned = forecastHours({ hours: custom, inwardBearingDeg: 270, reports });
    const prior = forecastHours({ hours: custom, inwardBearingDeg: 270, reports: [] });
    expect(directionAt(prior, "2026-09-24T04:00")).toBe("incoming");
    expect(directionAt(learned, "2026-09-24T04:00")).toBe("outgoing");
  });

  it("historical-report slopeM moves the phase offset off 0 and a null slope does not train", () => {
    const hours = marineFromLevels("2026-09-22T00:00", semidiurnalLevels(72));
    const contradicting: Report[] = [
      { id: "h1", siteId: "s", time: "2026-08-01T03:00", direction: "outgoing", strength: "mild", slopeM: 0.08 },
      { id: "h2", siteId: "s", time: "2026-08-01T09:00", direction: "outgoing", strength: "mild", slopeM: 0.04 },
    ];
    const prior = forecastHours({ hours, inwardBearingDeg: 0, reports: [] });
    const learned = forecastHours({ hours, inwardBearingDeg: 0, reports: contradicting });
    expect(directionAt(prior, "2026-09-23T06:00")).toBe("incoming");
    expect(directionAt(prior, "2026-09-23T15:00")).toBe("outgoing");
    const morning = directionAt(learned, "2026-09-23T06:00");
    const afternoon = directionAt(learned, "2026-09-23T15:00");
    const moved =
      (morning === "outgoing" && afternoon === "outgoing") ||
      (morning === "incoming" && afternoon === "incoming");
    expect(moved).toBe(true);

    const blank = contradicting.map((report) => ({ ...report, slopeM: null }));
    const ignored = forecastHours({ hours, inwardBearingDeg: 0, reports: blank });
    expect(directionAt(ignored, "2026-09-23T06:00")).toBe("incoming");
    expect(directionAt(ignored, "2026-09-23T15:00")).toBe("outgoing");
    expect(ignored.every((hour) => hour.confidence === "low")).toBe(true);

    const remembered: Report[] = [0, 1, 2, 3].map((id) => ({
      id: `c${id}`,
      siteId: "s",
      time: `2026-08-02T0${id}:00`,
      direction: "incoming" as const,
      strength: "strong" as const,
      slopeM: 0.08,
    }));
    const confident = forecastHours({ hours, inwardBearingDeg: 0, reports: remembered });
    expect(confident.find((hour) => hour.time.startsWith("2026-09-23T06:00"))?.confidence).not.toBe("low");
  });

  it("historical-report speed factor compares abs(slopeM) with the slack threshold", () => {
    const hours = marineFromLevels("2026-09-22T00:00", [...springDay(), ...springDay(), ...springDay()]);
    const plain = forecastHours({ hours, inwardBearingDeg: 0, reports: [] });
    expect(strengthAt(plain, "2026-09-23T00:00")).toBe("slack");
    expect(strengthAt(plain, "2026-09-23T01:00")).toBe("too_strong");

    const slackPrior: Report[] = [
      { id: "s1", siteId: "s", time: "2026-07-01T00:00", direction: "incoming", strength: "too_strong", slopeM: 0.01 },
      { id: "s2", siteId: "s", time: "2026-07-01T06:00", direction: "incoming", strength: "too_strong", slopeM: 0.015 },
    ];
    const faster = forecastHours({ hours, inwardBearingDeg: 0, reports: slackPrior });
    expect(strengthAt(faster, "2026-09-23T00:00")).toBe("slack");

    const steepPrior: Report[] = [
      { id: "t1", siteId: "s", time: "2026-07-02T00:00", direction: "incoming", strength: "slack", slopeM: 0.05 },
      { id: "t2", siteId: "s", time: "2026-07-02T06:00", direction: "outgoing", strength: "slack", slopeM: -0.08 },
    ];
    const slower = forecastHours({ hours, inwardBearingDeg: 0, reports: steepPrior });
    expect(strengthAt(slower, "2026-09-23T01:00")).not.toBe("too_strong");

    const missing = slackPrior.map((report) => ({ ...report, slopeM: null }));
    const unchanged = forecastHours({ hours, inwardBearingDeg: 0, reports: missing });
    expect(strengthAt(unchanged, "2026-09-23T00:00")).toBe("slack");
  });

  it("hourly-strength follows the slope up to the day's range envelope", () => {
    const spring = marineFromLevels("2026-09-22T00:00", [...springDay(), ...springDay(), ...springDay()]);
    const forecast = forecastHours({ hours: spring, inwardBearingDeg: 0, reports: [] });
    expect(strengthAt(forecast, "2026-09-23T00:00")).toBe("slack");
    expect(strengthAt(forecast, "2026-09-23T01:00")).toBe("too_strong");
    expect(strengthAt(forecast, "2026-09-23T02:00")).toBe("too_strong");
    expect(strengthAt(forecast, "2026-09-23T03:00")).toBe("too_strong");

    const neap = marineFromLevels("2026-09-23T00:00", [0, 0.08, 0.16, 0.24, 0.3, 0.3]);
    const neapForecast = forecastHours({ hours: neap, inwardBearingDeg: 0, reports: [] });
    expect(neapForecast.length).toBeGreaterThan(0);
    expect(neapForecast.every((hour) => hour.strength === "slack")).toBe(true);
    expect(directionAt(neapForecast, "2026-09-23T03:00")).toBe("incoming");
    expect(neapForecast.find((hour) => hour.time.startsWith("2026-09-23T04:00"))).toBeUndefined();
  });

  it("turn-of-tide pull crosses midnight, fades after six hours, and does not force a flipped slope", () => {
    const hours = marineFromLevels("2026-09-23T20:00", [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 0.8, 0.7, 0.8]);
    const against: Report = {
      id: "p1",
      siteId: "s",
      time: "2026-09-23T22:00",
      direction: "outgoing",
      strength: "mild",
    };
    const plain = forecastHours({ hours, inwardBearingDeg: 0, reports: [] });
    const pulled = forecastHours({ hours, inwardBearingDeg: 0, reports: [against] });
    expect(directionAt(plain, "2026-09-23T23:00")).toBe("incoming");
    expect(directionAt(pulled, "2026-09-23T23:00")).toBe("outgoing");
    expect(directionAt(pulled, "2026-09-24T00:00")).toBe("outgoing");
    expect(directionAt(pulled, "2026-09-24T04:00")).toBe("incoming");

    const agreed: Report = { ...against, id: "p2", direction: "incoming" };
    const held = forecastHours({ hours, inwardBearingDeg: 0, reports: [agreed] });
    expect(directionAt(plain, "2026-09-24T02:00")).toBe("outgoing");
    expect(directionAt(held, "2026-09-24T02:00")).toBe("outgoing");
    expect(directionAt(held, "2026-09-24T03:00")).toBe("outgoing");
  });

  it("a rising residual is incoming after a slow upward drift is removed", () => {
    const levels = Array.from({ length: 48 }, (_, hour) => {
      const tide = 0.3 * Math.sin((2 * Math.PI * hour) / 12);
      return tide + 0.2 * hour;
    });
    const hours = marineFromLevels("2026-09-23T00:00", levels);
    const forecast = forecastHours({ hours, inwardBearingDeg: 0, reports: [] });
    expect(levels[25] - levels[24]).toBeGreaterThan(0);
    expect(levels[31] - levels[30]).toBeGreaterThan(0);
    expect(seaLevelSlopeAt(hours, "2026-09-24T00:00")).toBeGreaterThan(0);
    expect(seaLevelSlopeAt(hours, "2026-09-24T06:00")).toBeLessThan(0);
    expect(directionAt(forecast, "2026-09-24T00:00")).toBe("incoming");
    expect(directionAt(forecast, "2026-09-24T06:00")).toBe("outgoing");
  });

  it("holds one strength for an incoming run instead of a new band every hour", () => {
    const forecast = forecastHours({
      hours: marineFromLevels("2026-09-23T00:00", semidiurnalLevels(24)),
      inwardBearingDeg: 0,
      reports: [],
    });
    const directions = forecast.map((hour) => hour.direction);
    let changes = 0;
    for (let index = 1; index < directions.length; index += 1) {
      if (directions[index] !== directions[index - 1]) changes += 1;
    }
    expect(changes).toBeLessThanOrEqual(4);
    const incoming = forecast.filter((hour) => hour.direction === "incoming" && hour.strength !== "slack");
    expect(new Set(incoming.map((hour) => hour.strength)).size).toBe(1);
  });

  it("a near-zero residual is slack and does not copy the previous direction", () => {
    const hours = marineFromLevels("2026-09-23T00:00", [0, 0.4, 0.4 - 0.001]);
    const forecast = forecastHours({ hours, inwardBearingDeg: 0, reports: [] });
    expect(directionAt(forecast, "2026-09-23T00:00")).toBe("incoming");
    expect(directionAt(forecast, "2026-09-23T01:00")).toBe("outgoing");
    expect(strengthAt(forecast, "2026-09-23T01:00")).toBe("slack");
  });

  it("a strong seaward current does not set direction when the residual is flat", () => {
    const against = forecastHours({
      hours: marineFromLevels("2026-09-23T00:00", [0, 0.5, 0.5 + 0.001]).map((hour) => ({
        ...hour,
        currentVelocityMs: 1,
        currentDirectionDeg: 180,
      })),
      inwardBearingDeg: 0,
      reports: [],
    });
    expect(directionAt(against, "2026-09-23T01:00")).toBe("incoming");
    expect(strengthAt(against, "2026-09-23T01:00")).toBe("slack");
    expect(against.every((hour) => hour.confidence === "low")).toBe(true);

    const along = forecastHours({
      hours: marineFromLevels("2026-09-23T00:00", [0, 0.5, 0.5 + 0.001]).map((hour) => ({
        ...hour,
        currentVelocityMs: 1,
        currentDirectionDeg: 0,
      })),
      inwardBearingDeg: 0,
      reports: [],
    });
    expect(directionAt(along, "2026-09-23T01:00")).toBe("incoming");
    expect(strengthAt(along, "2026-09-23T01:00")).toBe("slack");
    expect(along.every((hour) => hour.confidence === "low")).toBe(true);

    const flat = forecastHours({
      hours: marineFromLevels("2026-09-23T00:00", [1, 1, 1, 1]).map((hour) => ({
        ...hour,
        currentVelocityMs: 1,
        currentDirectionDeg: 180,
      })),
      inwardBearingDeg: 0,
      reports: [],
    });
    expect(flat).toEqual([]);
  });

  it("reads residual slopes from six hours before through six hours after", () => {
    const hours = marineFromLevels("2026-09-23T00:00", lagLevels);
    const window = residualSlopeWindow(hours, "2026-09-23T06:00");
    expect(window).toHaveLength(13);
    expect(window?.[6]).toBeCloseTo(-0.1);
    expect(window?.[0]).toBeCloseTo(0.1);
    const gapped = residualSlopeWindow(
      hours.filter((hour) => !hour.time.endsWith("T03:00")),
      "2026-09-23T06:00",
    );
    expect(gapped?.[3]).toBeNull();
    expect(gapped?.[6]).toBeCloseTo(-0.1);
  });

  it("two stored slope windows pick a non-zero lag when both match it", () => {
    const hours = marineFromLevels("2026-09-23T00:00", lagLevels);
    const prior = forecastHours({ hours, inwardBearingDeg: 0, reports: [] });
    expect(directionAt(prior, "2026-09-23T00:00")).toBe("incoming");
    expect(directionAt(prior, "2026-09-23T04:00")).toBe("incoming");
    expect(directionAt(prior, "2026-09-23T06:00")).toBe("outgoing");

    const lag2 = Array<number | null>(13).fill(null);
    lag2[4] = 0.05;
    lag2[6] = 0.08;
    lag2[8] = -0.08;
    const learned = forecastHours({
      hours,
      inwardBearingDeg: 0,
      reports: [outsideWindow("a", lag2), outsideWindow("b", lag2)],
    });
    expect(directionAt(learned, "2026-09-23T00:00")).toBe("incoming");
    expect(directionAt(learned, "2026-09-23T04:00")).toBe("outgoing");
  });

  it("one stored slope window does not pick a non-zero lag", () => {
    const hours = marineFromLevels("2026-09-23T00:00", lagLevels);
    const lag2 = Array<number | null>(13).fill(null);
    lag2[4] = 0.05;
    lag2[6] = 0.08;
    lag2[8] = -0.08;
    const alone = forecastHours({ hours, inwardBearingDeg: 0, reports: [outsideWindow("a", lag2)] });
    expect(directionAt(alone, "2026-09-23T04:00")).toBe("incoming");
  });

  it("two stored slope windows that agree at lag zero stay on the unshifted tide", () => {
    const hours = marineFromLevels("2026-09-23T00:00", lagLevels);
    const agrees = Array<number | null>(13).fill(null);
    agrees[4] = -0.05;
    agrees[6] = -0.08;
    agrees[8] = 0.08;
    const held = forecastHours({
      hours,
      inwardBearingDeg: 0,
      reports: [outsideWindow("a", agrees), outsideWindow("b", agrees)],
    });
    expect(directionAt(held, "2026-09-23T04:00")).toBe("incoming");
  });

  it("a single stored slope does not support an intermediate lag", () => {
    const hours = marineFromLevels("2026-09-23T00:00", lagLevels);
    const loneSlot = Array<number | null>(13).fill(null);
    loneSlot[8] = -0.08;
    const notMeasured = forecastHours({
      hours,
      inwardBearingDeg: 0,
      reports: [outsideWindow("a", loneSlot), outsideWindow("b", loneSlot)],
    });
    expect(directionAt(notMeasured, "2026-09-23T04:00")).toBe("incoming");
  });

  it("one single stored slope does not flip the tide", () => {
    const hours = marineFromLevels("2026-09-23T00:00", lagLevels);
    const prior = forecastHours({ hours, inwardBearingDeg: 0, reports: [] });
    const flip = Array<number | null>(13).fill(null);
    flip[6] = 0.08;
    const singleFlip = forecastHours({ hours, inwardBearingDeg: 0, reports: [outsideWindow("a", flip)] });
    expect(singleFlip.map((hour) => hour.direction)).toEqual(prior.map((hour) => hour.direction));
  });

  it("two single stored slopes pick a six-hour flip", () => {
    const hours = marineFromLevels("2026-09-23T00:00", lagLevels);
    const prior = forecastHours({ hours, inwardBearingDeg: 0, reports: [] });
    const flip = Array<number | null>(13).fill(null);
    flip[6] = 0.08;
    const flipped = forecastHours({
      hours,
      inwardBearingDeg: 0,
      reports: [outsideWindow("a", flip), outsideWindow("b", flip)],
    });
    expect(flipped.map((hour) => hour.direction)).not.toEqual(prior.map((hour) => hour.direction));
  });

  it("a null slope inside the series does not train", () => {
    const blocked = forecastHours({
      hours: repeatingHours(),
      inwardBearingDeg: 0,
      reports: [
        { id: "f1", siteId: "s", time: "2026-09-23T03:00", direction: "outgoing", strength: "mild", slopeM: null },
        { id: "f2", siteId: "s", time: "2026-09-23T04:00", direction: "outgoing", strength: "mild", slopeM: null },
      ],
    });
    const open = forecastHours({ hours: repeatingHours(), inwardBearingDeg: 0, reports: [] });
    expect(directionAt(open, "2026-09-24T04:00")).toBe("incoming");
    expect(directionAt(blocked, "2026-09-24T04:00")).toBe("incoming");
  });

  it("does not let a missing in-series lag break a tie and move the phase offset", () => {
    const hours = marineFromLevels("2026-09-23T00:00", lagLevels);
    const flip = Array<number | null>(13).fill(null);
    flip[6] = 0.08;
    const edges: Report[] = [
      { id: "e1", siteId: "s", time: "2026-09-23T00:00", direction: "incoming", strength: "mild" },
      { id: "e2", siteId: "s", time: "2026-09-23T01:00", direction: "incoming", strength: "mild" },
    ];
    const edgesOnly = forecastHours({ hours, inwardBearingDeg: 0, reports: edges });
    const tied = forecastHours({
      hours,
      inwardBearingDeg: 0,
      reports: [outsideWindow("a", flip), outsideWindow("b", flip), ...edges],
    });
    expect(tied.map((hour) => hour.direction)).toEqual(edgesOnly.map((hour) => hour.direction));
  });

  it("matches a clear levelM step to incoming or outgoing", () => {
    const levels = Array.from({ length: 48 }, (_, hour) => {
      const tide = 0.3 * Math.sin((2 * Math.PI * hour) / 12);
      return tide + 0.2 * hour;
    });
    const hours = marineFromLevels("2026-09-23T00:00", levels);
    const forecast = forecastHours({ hours, inwardBearingDeg: 0, reports: [] });
    let rising = 0;
    let falling = 0;
    for (let index = 0; index < forecast.length - 1; index += 1) {
      const step = forecast[index + 1].levelM - forecast[index].levelM;
      if (step > 0.02) {
        expect(forecast[index].direction).toBe("incoming");
        rising += 1;
      } else if (step < -0.02) {
        expect(forecast[index].direction).toBe("outgoing");
        falling += 1;
      }
    }
    expect(rising).toBeGreaterThan(0);
    expect(falling).toBeGreaterThan(0);
  });

  it("caps every hour at medium when allowHighConfidence is false", () => {
    const hours = Array.from({ length: 72 }, (_, index) => ({
      time: new Date(Date.UTC(2026, 8, 22) + index * 60 * 60 * 1000).toISOString().slice(0, 16),
      seaLevelM: 0.25 + 0.22 * Math.sin((2 * Math.PI * index) / 12),
      currentVelocityMs: 0,
      currentDirectionDeg: 0,
    }));
    const reports: Report[] = [0, 1, 2, 3].map((id) => ({
      id: `cap-${id}`,
      siteId: "s",
      time: `2026-08-02T0${id}:00`,
      direction: "incoming" as const,
      strength: "strong" as const,
      slopeM: 0.08,
    }));
    const capped = forecastHours({ hours, inwardBearingDeg: 0, reports, allowHighConfidence: false });
    expect(capped.some((hour) => hour.confidence === "high")).toBe(false);
  });

  it("non-zero offset keeps levelM on the clock hour and direction on the lagged slope", () => {
    const hours = marineFromLevels("2026-09-23T00:00", sineTide(72));
    const plain = forecastHours({ hours, inwardBearingDeg: 0, reports: [] });
    const lagged = forecastHours({
      hours,
      inwardBearingDeg: 0,
      reports: [outsideWindow("a", outgoingAtLag(2)), outsideWindow("b", outgoingAtLag(2))],
    });
    const clock = "2026-09-23T19:00";
    const later = "2026-09-23T21:00";
    const clockLevel = levelAt(plain, clock);
    const laterLevel = levelAt(plain, later);
    expect(directionAt(plain, clock)).toBe("outgoing");
    expect(directionAt(lagged, clock)).toBe("incoming");
    expect(clockLevel).toEqual(expect.any(Number));
    expect(laterLevel).toEqual(expect.any(Number));
    expect(levelAt(lagged, clock)).toBe(clockLevel);
    expect(clockLevel).not.toBeCloseTo(laterLevel as number);
  });

  it("a report of outgoing does not hold after the lagged slope has turned even if the unshifted slope has not", () => {
    const hours = marineFromLevels("2026-09-23T00:00", sineTide(72));
    const windows = [outsideWindow("a", outgoingAtLag(2)), outsideWindow("b", outgoingAtLag(2))];
    const clock = forecastHours({ hours, inwardBearingDeg: 0, reports: [] });
    const lagged = forecastHours({ hours, inwardBearingDeg: 0, reports: windows });
    const pulled = forecastHours({
      hours,
      inwardBearingDeg: 0,
      reports: [
        ...windows,
        { id: "live", siteId: "s", time: "2026-09-23T15:00", direction: "outgoing", strength: "mild" },
      ],
    });
    const hour = "2026-09-23T20:00";
    expect(directionAt(clock, hour)).toBe("outgoing");
    expect(directionAt(lagged, hour)).toBe("incoming");
    expect(directionAt(pulled, hour)).toBe("incoming");
  });

  it("two reports that match the lagged band leave the speed factor at 1", () => {
    const hours = marineFromLevels("2026-09-23T00:00", sineTide(72));
    const windows = [outsideWindow("a", outgoingAtLag(2)), outsideWindow("b", outgoingAtLag(2))];
    const control = forecastHours({ hours, inwardBearingDeg: 0, reports: windows });
    const fitted = forecastHours({
      hours,
      inwardBearingDeg: 0,
      reports: [
        ...windows,
        { id: "m1", siteId: "s", time: "2026-09-23T18:00", direction: "outgoing", strength: "mild" },
        { id: "m2", siteId: "s", time: "2026-09-24T06:00", direction: "outgoing", strength: "mild" },
      ],
    });
    const hour = "2026-09-24T16:00";
    expect(directionAt(fitted, hour)).toBe(directionAt(control, hour));
    expect(strengthAt(control, hour)).toBe("too_strong");
    expect(strengthAt(fitted, hour)).toBe(strengthAt(control, hour));
  });

  it("drops the first and last hours of a long series and keeps an interior hour", () => {
    const hours = marineFromLevels("2026-09-23T00:00", sineTide(48));
    const forecast = forecastHours({ hours, inwardBearingDeg: 0, reports: [] });
    expect(forecast.find((hour) => hour.time === hours[0].time)).toBeUndefined();
    expect(forecast.find((hour) => hour.time === hours[hours.length - 1].time)).toBeUndefined();
    expect(forecast.find((hour) => hour.time === hours[24].time)).toBeDefined();
  });

  it("keeps an outgoing report when only the unshifted slope has turned, then drops it once the lagged slope turns", () => {
    const hours = marineFromLevels("2026-09-23T00:00", sineTide(72));
    const windows = [outsideWindow("a", outgoingAtLag(2)), outsideWindow("b", outgoingAtLag(2))];
    const clock = forecastHours({ hours, inwardBearingDeg: 0, reports: [] });
    const lagged = forecastHours({ hours, inwardBearingDeg: 0, reports: windows });
    const pulled = forecastHours({
      hours,
      inwardBearingDeg: 0,
      reports: [
        ...windows,
        { id: "live", siteId: "s", time: "2026-09-23T14:00", direction: "outgoing", strength: "mild", slopeM: null },
      ],
    });
    const still = "2026-09-23T14:00";
    const dropped = "2026-09-23T19:00";
    expect(directionAt(clock, still)).toBe("incoming");
    expect(directionAt(lagged, still)).toBe("outgoing");
    expect(directionAt(pulled, still)).toBe("outgoing");
    expect(directionAt(lagged, dropped)).toBe("incoming");
    expect(directionAt(pulled, dropped)).toBe("incoming");
  });

  it("keeps a midnight flood on the surrounding tide instead of a three-hour calendar fragment", () => {
    const levels = Array.from({ length: 72 }, (_, hour) => {
      if (hour < 23) return 0.2;
      if (hour === 23) return 0.45;
      if (hour === 24) return 0.7;
      if (hour === 25) return 0.9;
      return 1;
    });
    const forecast = forecastHours({
      hours: marineFromLevels("2026-09-23T00:00", levels),
      inwardBearingDeg: 0,
      reports: [],
    });
    expect(directionAt(forecast, "2026-09-24T01:00")).toBe("incoming");
    expect(strengthAt(forecast, "2026-09-23T23:00")).toBe("strong");
    expect(strengthAt(forecast, "2026-09-24T01:00")).toBe("strong");
  });
});

function outgoingAtLag(lag: number): (number | null)[] {
  const slopes = Array<number | null>(13).fill(null);
  slopes[6] = 0.08;
  slopes[6 + lag] = -0.08;
  return slopes;
}

function levelAt(forecast: { time: string; levelM: number }[], time: string): number | undefined {
  return forecast.find((hour) => hour.time.startsWith(time))?.levelM;
}

function sineTide(count: number): number[] {
  return Array.from({ length: count }, (_, hour) => 0.55 * Math.sin((2 * Math.PI * hour) / 12));
}

function outsideWindow(id: string, slopeWindowM: (number | null)[]): Report {
  return {
    id,
    siteId: "s",
    time: id === "a" ? "2026-08-01T00:00" : "2026-08-02T00:00",
    direction: "outgoing",
    strength: "mild",
    slopeM: slopeWindowM[6],
    slopeWindowM,
  };
}

function directionAt(forecast: { time: string; direction: string }[], time: string): string | undefined {
  return forecast.find((hour) => hour.time.startsWith(time))?.direction;
}

function repeatingHours(): MarineHour[] {
  const cycle = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.4, 0.3, 0.2, 0.1, 0, 0.1];
  return marineFromLevels(
    "2026-09-22T00:00",
    Array.from({ length: 72 }, (_, index) => cycle[index % 12]),
  );
}

function strengthAt(forecast: { time: string; strength: string }[], time: string): string | undefined {
  return forecast.find((hour) => hour.time.startsWith(time))?.strength;
}

function marineFromLevels(start: string, levels: number[]): MarineHour[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(start);
  if (!match) throw new Error("bad start");
  const origin = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]);
  return levels.map((seaLevelM, index) => ({
    time: new Date(origin + index * 60 * 60 * 1000).toISOString().slice(0, 16),
    seaLevelM,
    currentVelocityMs: 0,
    currentDirectionDeg: 0,
  }));
}

function semidiurnalLevels(count: number): number[] {
  return Array.from({ length: count }, (_, index) => {
    const hour = index % 24;
    if (hour <= 12) return 0.2 + hour * 0.05;
    return 0.2 + (24 - hour) * 0.05;
  });
}

function springDay(): number[] {
  const slopes = [0.01, 0.05, 0.11, 0.2, 0.2, 0.16, 0.16];
  const levels = [0];
  for (const slope of slopes) levels.push(levels[levels.length - 1] + slope);
  const peak = levels[levels.length - 1];
  const remaining = 24 - levels.length;
  for (let step = 1; step <= remaining; step += 1) {
    levels.push(peak - (peak * step) / remaining);
  }
  return levels;
}
