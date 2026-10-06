import { describe, expect, it } from "vitest";
import {
  applySpeed,
  classifyReport,
  constrictionFactor,
  forecastHours,
  residualRangeAt,
  residualSlopeWindow,
  seaLevelSlopeAt,
  throughflowAt,
  tideWindow,
  toMaldivesWall,
} from "./forecast";
import { STRENGTHS, type HourForecast, type MarineHour, type Report, type Strength } from "./types";

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

  it("follows the net flow, tide slope plus through-flow, and stays low confidence with no reports", () => {
    const forecast = forecastHours({
      hours: series,
      inwardBearingDeg: 270,
      reports: [],
    });
    expect(forecast.length).toBeGreaterThan(0);
    expect(forecast.every((hour) => hour.confidence === "low")).toBe(true);
    for (let index = 0; index < series.length; index += 1) {
      const slope = seaLevelSlopeAt(series, series[index].time);
      const through = throughflowAt(series, series[index].time, 270);
      const hour = forecast.find((item) => item.time === series[index].time);
      if (slope == null || through == null) {
        expect(hour).toBeUndefined();
        continue;
      }
      const net = slope + through;
      // C8: exact-zero slope is slack with the following run sign, not omitted.
      if (net === 0) {
        if (hour) expect(hour.strength).toBe("slack");
        continue;
      }
      expect(hour?.direction).toBe(net > 0 ? "incoming" : "outgoing");
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

  it("lets a slack report pull strength but not direction", () => {
    const plain = forecastHours({ hours: series, inwardBearingDeg: 270, reports: [] });
    // The form makes a diver pick a direction even at slack. That pick must not flip the incoming hours.
    const slack: Report = { ...outgoingReport, strength: "slack" };
    const pulled = forecastHours({ hours: series, inwardBearingDeg: 270, reports: [slack] });
    for (const time of ["2026-09-23T03:00", "2026-09-23T05:00"]) {
      const before = plain.find((hour) => hour.time === time);
      const after = pulled.find((hour) => hour.time === time);
      expect(after?.direction).toBe("incoming");
      expect(STRENGTHS.indexOf(after!.strength)).toBeLessThanOrEqual(STRENGTHS.indexOf(before!.strength));
    }
  });

  it("does not let a report from the other tide block high confidence", () => {
    // 12-hour sine: 01:00 on the second day is on the rise.
    const hours = marineFromLevels(
      "2026-07-20T00:00",
      Array.from({ length: 72 }, (_, index) => 1 + 0.6 * Math.sin((2 * Math.PI * index) / 12)),
    );
    const target = "2026-07-21T01:00";
    const agreeing: Report[] = [1, 2, 3, 4, 5].map((id) => ({
      id: `in-${id}`,
      siteId: "s",
      time: "2026-07-06T01:00",
      direction: "incoming",
      strength: "too_strong",
      slopeM: 0.08,
    }));
    const confidenceWith = (extra: Report) =>
      forecastHours({ hours, inwardBearingDeg: 90, reports: [...agreeing, extra], allowHighConfidence: true }).find(
        (hour) => hour.time === target,
      )?.confidence;
    const threeDaysBefore = "2026-07-18T01:00";

    // Outgoing on a falling tide three days ago is what the model expects, not a contradiction.
    expect(
      confidenceWith({ id: "ebb", siteId: "s", time: threeDaysBefore, direction: "outgoing", strength: "strong", slopeM: -0.08 }),
    ).toBe("high");
    // Outgoing on a rising tide is.
    expect(
      confidenceWith({ id: "odd", siteId: "s", time: threeDaysBefore, direction: "outgoing", strength: "strong", slopeM: 0.08 }),
    ).not.toBe("high");
    // Within three hours any opposite report counts: it may be the same water on a skewed clock.
    expect(
      confidenceWith({ id: "near", siteId: "s", time: "2026-07-21T03:00", direction: "outgoing", strength: "strong", slopeM: -0.08 }),
    ).not.toBe("high");
    // A slack report saw no flow, so its direction contradicts nothing.
    expect(
      confidenceWith({ id: "slack", siteId: "s", time: threeDaysBefore, direction: "outgoing", strength: "slack", slopeM: 0.08 }),
    ).toBe("high");
  });

  it("judges strength agreement at each report's own hour, not the hour being scored", () => {
    // 12-hour sine: 00:00 to 02:00 on the second day rise toward the 03:00 crest, easing off as the turn nears.
    const hours = marineFromLevels(
      "2026-07-14T00:00",
      Array.from({ length: 72 }, (_, index) => 0.8 + 0.5 * Math.sin((2 * Math.PI * index) / 12)),
    );
    const plain = forecastHours({ hours, inwardBearingDeg: 90 });
    const bandAt = (time: string) => plain.find((hour) => hour.time === time)!.strength;
    const times = ["2026-07-15T00:00", "2026-07-15T01:00", "2026-07-15T02:00", "2026-07-15T00:00", "2026-07-15T01:00"];
    const target = "2026-07-15T02:00";
    // The run peaks early and eases off, so most reports sit at a different band from the target hour.
    expect(times.filter((time) => bandAt(time) !== bandAt(target)).length).toBeGreaterThanOrEqual(3);

    const confidenceWith = (strengthFor: (time: string) => Strength) =>
      forecastHours({
        hours,
        inwardBearingDeg: 90,
        allowHighConfidence: true,
        reports: times.map((time, id) => ({
          id: `r${id}`,
          siteId: "s",
          time,
          direction: "incoming" as const,
          strength: strengthFor(time),
        })),
      }).find((hour) => hour.time === target)?.confidence;

    // Every report matched the model at its own hour: a clean track record, so high even at the easing hour.
    expect(confidenceWith(bandAt)).toBe("high");
    // Reports with the run's shape backwards (weak at the peak, strong as it eases): no speed factor fits them.
    const peak = bandAt(times[0]);
    expect(confidenceWith((time) => (bandAt(time) === peak ? "mild" : "too_strong"))).not.toBe("high");
  });

  it("applies channel narrowing to the envelope only, not again to the hourly ramp", () => {
    // A 2.2 m range is very strong with or without a narrow channel, so the two envelopes match.
    // A 13-hour period spreads the hourly slopes so some sit where the old doubled narrowing moved them a band.
    const hours = marineFromLevels(
      "2026-09-22T00:00",
      Array.from({ length: 72 }, (_, index) => 1.1 * Math.sin((2 * Math.PI * index) / 13)),
    );
    const open = forecastHours({ hours, inwardBearingDeg: 0 });
    const narrow = forecastHours({ hours, inwardBearingDeg: 0, channelWidthM: 50, channelDepthM: 10 });
    expect(constrictionFactor(50, 10)).toBe(2.5);
    expect(narrow.map((hour) => hour.strength)).toEqual(open.map((hour) => hour.strength));
    expect(new Set(open.map((hour) => hour.strength)).size).toBeGreaterThan(2);
  });

  it("grades an old report from its saved range and window instead of calling every flowing hour mild", () => {
    // 12-hour sine of amplitude 0.35 m: a 0.7 m range, so the envelope is strong and the steepest hours are strong.
    const sine = (index: number) => 0.35 * Math.sin((2 * Math.PI * index) / 12);
    const levels = Array.from({ length: 72 }, (_, index) => sine(index));
    const hours = marineFromLevels("2026-09-22T00:00", levels);
    const lastMonth = marineFromLevels("2026-08-22T00:00", levels);
    // Two dives a month ago at the steepest rising hours, reported strong, which is what the model would have said.
    const reports: Report[] = ["2026-08-23T12:00", "2026-08-24T00:00"].map((time, id) => {
      const slopeWindowM = residualSlopeWindow(lastMonth, time)!;
      return {
        id: `peak-${id}`,
        siteId: "s",
        time,
        direction: "incoming",
        strength: "strong",
        slopeM: slopeWindowM[6],
        slopeWindowM,
        rangeM: residualRangeAt(lastMonth, time),
      };
    });
    expect(reports.every((report) => report.rangeM != null && report.rangeM > 0.55)).toBe(true);

    const strengths = (list: Report[]) =>
      forecastHours({ hours, inwardBearingDeg: 0, reports: list }).map((hour) => hour.strength);
    const plain = strengths([]);
    // Agreeing reports leave the bands alone.
    expect(strengths(reports)).toEqual(plain);
    // Without the range the prior is mild, so the same reports read as "stronger than the model" and lift the series.
    const legacy = strengths(reports.map((report) => ({ ...report, rangeM: undefined })));
    expect(legacy.some((band, index) => STRENGTHS.indexOf(band) > STRENGTHS.indexOf(plain[index]))).toBe(true);
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
    // A 1 m spring tide on its own tops out strong.
    expect(strengthAt(plain, "2026-09-23T03:00")).toBe("strong");

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
    expect(strengthAt(slower, "2026-09-23T03:00")).not.toBe("strong");

    const missing = slackPrior.map((report) => ({ ...report, slopeM: null }));
    const unchanged = forecastHours({ hours, inwardBearingDeg: 0, reports: missing });
    expect(strengthAt(unchanged, "2026-09-23T00:00")).toBe("slack");
  });

  it("hourly-strength follows the slope up to the day's range envelope", () => {
    const spring = marineFromLevels("2026-09-22T00:00", [...springDay(), ...springDay(), ...springDay()]);
    const forecast = forecastHours({ hours: spring, inwardBearingDeg: 0, reports: [] });
    // The rise steepens 0.01, 0.05, 0.11, 0.2 m/hour, so the band climbs with it. A 1 m spring tops out strong.
    expect(strengthAt(forecast, "2026-09-23T00:00")).toBe("slack");
    expect(strengthAt(forecast, "2026-09-23T01:00")).toBe("mild");
    expect(strengthAt(forecast, "2026-09-23T02:00")).toBe("strong");
    expect(strengthAt(forecast, "2026-09-23T03:00")).toBe("strong");
    expect(strengthAt(forecast, "2026-09-23T04:00")).toBe("strong");
    // Through a narrow channel the same tide climbs all four bands.
    const narrow = forecastHours({ hours: spring, inwardBearingDeg: 0, reports: [], channelWidthM: 50, channelDepthM: 10 });
    expect(strengthAt(narrow, "2026-09-23T00:00")).toBe("slack");
    expect(strengthAt(narrow, "2026-09-23T01:00")).toBe("mild");
    expect(strengthAt(narrow, "2026-09-23T02:00")).toBe("strong");
    expect(strengthAt(narrow, "2026-09-23T03:00")).toBe("too_strong");

    const neap = marineFromLevels("2026-09-23T00:00", [0, 0.05, 0.1, 0.15, 0.2, 0.2]);
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

  it("a run eases in and out: strength rises to the steepest hour, then falls away with no dips", () => {
    const forecast = forecastHours({
      hours: marineFromLevels("2026-09-22T00:00", sineTide(72)),
      inwardBearingDeg: 0,
      reports: [],
    });
    const band = (strength: string) => STRENGTHS.indexOf(strength as (typeof STRENGTHS)[number]);
    // Hours 00:00 to 06:00 are one rising then falling stretch of a 12 hour sine tide.
    const stretch = forecast.filter((hour) => hour.time >= "2026-09-23T00:00" && hour.time <= "2026-09-23T06:00");
    // Within one run of a direction the band is unimodal: it never falls and then rises again.
    for (const direction of ["incoming", "outgoing"]) {
      const bands = stretch.filter((hour) => hour.direction === direction).map((hour) => band(hour.strength));
      const peak = bands.indexOf(Math.max(...bands));
      for (let index = 1; index <= peak; index += 1) expect(bands[index]).toBeGreaterThanOrEqual(bands[index - 1]);
      for (let index = peak + 1; index < bands.length; index += 1) expect(bands[index]).toBeLessThanOrEqual(bands[index - 1]);
    }
    // A 12 hour sine sampled hourly only lands in two bands; the spring-day test above covers the full climb.
    expect(new Set(stretch.map((hour) => hour.strength)).size).toBeGreaterThanOrEqual(2);
    // The steepest hour (the sine crosses zero at 00:00) carries the top band, and the crest hour is weaker.
    expect(strengthAt(forecast, "2026-09-23T00:00")).toBe("strong");
    expect(band(strengthAt(forecast, "2026-09-23T03:00")!)).toBeLessThan(band("strong"));
  });

  it("a near-zero residual is slack and does not copy the previous direction", () => {
    const hours = marineFromLevels("2026-09-23T00:00", [0, 0.4, 0.4 - 0.001]);
    const forecast = forecastHours({ hours, inwardBearingDeg: 0, reports: [] });
    expect(directionAt(forecast, "2026-09-23T00:00")).toBe("incoming");
    expect(directionAt(forecast, "2026-09-23T01:00")).toBe("outgoing");
    expect(strengthAt(forecast, "2026-09-23T01:00")).toBe("slack");
  });

  it("with a flat tide, the drift along the channel sets direction and strength", () => {
    const against = forecastHours({
      hours: marineFromLevels("2026-09-23T00:00", [0, 0.5, 0.5 + 0.001]).map((hour) => ({
        ...hour,
        currentVelocityMs: 1,
        currentDirectionDeg: 180,
      })),
      inwardBearingDeg: 0,
      reports: [],
    });
    // The tide has stopped rising; a 1 m/s drift heading out of the channel carries the water out.
    expect(directionAt(against, "2026-09-23T01:00")).toBe("outgoing");
    expect(strengthAt(against, "2026-09-23T01:00")).not.toBe("slack");
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
    expect(strengthAt(along, "2026-09-23T01:00")).not.toBe("slack");
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
    // No tide at all: the drift alone runs the channel out, all day.
    expect(flat.length).toBeGreaterThan(0);
    expect(flat.every((hour) => hour.direction === "outgoing" && hour.strength !== "slack")).toBe(true);
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

  it("a null slope inside the series still pulls the next hours and blocks high confidence", () => {
    const hours = repeatingHours();
    // Four old reports that agree with the model at every rising hour make those hours high.
    const agreeing: Report[] = [0, 1, 2, 3].map((id) => ({
      id: `c${id}`,
      siteId: "s",
      time: `2026-08-02T0${id}:00`,
      direction: "incoming" as const,
      strength: "mild" as const,
      slopeM: 0.08,
    }));
    const confident = forecastHours({ hours, inwardBearingDeg: 0, reports: agreeing });
    const at = "2026-09-23T02:00";
    expect(directionAt(confident, at)).toBe("incoming");
    const confidenceAt = (forecast: HourForecast[]) => forecast.find((hour) => hour.time.startsWith(at))?.confidence;
    expect(confidenceAt(confident)).toBe("high");

    const opposite: Report = {
      id: "live",
      siteId: "s",
      time: "2026-09-23T01:00",
      direction: "outgoing",
      strength: "mild",
      slopeM: null,
    };
    const contradicted = forecastHours({ hours, inwardBearingDeg: 0, reports: [...agreeing, opposite] });
    expect(confidenceAt(contradicted)).not.toBe("high");
    const alone = forecastHours({ hours, inwardBearingDeg: 0, reports: [opposite] });
    expect(directionAt(alone, at)).toBe("outgoing");
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
    expect(strengthAt(control, hour)).toBe("strong");
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
    // The flood peaks either side of midnight and tapers after: the bands follow one tide, not the calendar day.
    expect(strengthAt(forecast, "2026-09-23T23:00")).toBe("strong");
    expect(strengthAt(forecast, "2026-09-24T00:00")).toBe("strong");
    expect(strengthAt(forecast, "2026-09-24T01:00")).toBe("mild");
  });

  it("a report is judged against the model's band at its own hour: agreeing changes nothing, stronger raises later hours", () => {
    const slopes = [0.03, 0.11, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08];
    const levels = [0];
    for (const slope of slopes) levels.push(levels[levels.length - 1] + slope);
    const hours = marineFromLevels("2026-09-23T00:00", levels);
    const shoulder = "2026-09-23T00:00";
    const peak = "2026-09-23T01:00";
    const later = "2026-09-23T08:00";
    const plain = forecastHours({ hours, inwardBearingDeg: 0, reports: [] });
    const reportsAt = (strength: "mild" | "strong") =>
      [1, 2].map((id) => ({
        id: `${strength}-${id}`,
        siteId: "s",
        time: shoulder,
        direction: "incoming" as const,
        strength,
      }));
    const agreeing = forecastHours({ hours, inwardBearingDeg: 0, reports: reportsAt("mild") });
    const stronger = forecastHours({ hours, inwardBearingDeg: 0, reports: reportsAt("strong") });
    // The shoulder hour is on the slow edge of the rise, so the model calls it mild and the peak strong.
    expect(strengthAt(plain, shoulder)).toBe("mild");
    expect(strengthAt(plain, peak)).toBe("strong");
    expect(strengthAt(plain, later)).toBe("strong");
    // A report that matches the model's mild at that hour leaves everything alone.
    expect(strengthAt(agreeing, shoulder)).toBe("mild");
    expect(strengthAt(agreeing, later)).toBe("strong");
    // A report of strong there says the model runs weak, so later hours rise.
    expect(STRENGTHS.indexOf(strengthAt(stronger, later) as (typeof STRENGTHS)[number])).toBeGreaterThan(
      STRENGTHS.indexOf("strong"),
    );
  });

  it("a non-zero offset whose lagged time is past the series produces no forecast hour at that clock time", () => {
    const hours = marineFromLevels("2026-09-23T00:00", lagLevels);
    const edge = hours[hours.length - 1].time;
    const plain = forecastHours({ hours, inwardBearingDeg: 0, reports: [] });
    const lagged = forecastHours({
      hours,
      inwardBearingDeg: 0,
      reports: [outsideWindow("a", outgoingAtLag(2)), outsideWindow("b", outgoingAtLag(2))],
    });
    expect(plain.find((hour) => hour.time === edge)).toBeDefined();
    expect(lagged.find((hour) => hour.time === edge)).toBeUndefined();
  });

  describe("through-flow", () => {
    /** 72 hours of a semidiurnal tide with a steady drift. */
    const tideWithDrift = (amplitudeM: number, driftMs: number, driftDeg: number) =>
      marineFromLevels(
        "2026-01-10T00:00",
        Array.from({ length: 72 }, (_, index) => amplitudeM * Math.sin((2 * Math.PI * index) / 12.42)),
      ).map((hour) => ({ ...hour, currentVelocityMs: driftMs, currentDirectionDeg: driftDeg }));
    const shareIn = (hours: MarineHour[], inwardBearingDeg: number) => {
      const shown = forecastHours({ hours, inwardBearingDeg, reports: [] });
      return shown.filter((hour) => hour.direction === "incoming").length / shown.length;
    };
    // An east-rim channel's water enters heading west (270°); a west-rim channel's heading east (90°).
    const EAST_RIM = 270;
    const WEST_RIM = 90;

    it("follows the monsoon side: NE runs the east side in and the west out, SW the reverse", () => {
      const ne = tideWithDrift(0.4, 0.2, 270); // NE monsoon: the drift heads west
      const sw = tideWithDrift(0.4, 0.2, 90); // SW monsoon: the drift heads east
      expect(shareIn(ne, EAST_RIM)).toBeGreaterThan(0.6);
      expect(shareIn(ne, WEST_RIM)).toBeLessThan(0.4);
      expect(shareIn(sw, WEST_RIM)).toBeGreaterThan(0.6);
      expect(shareIn(sw, EAST_RIM)).toBeLessThan(0.4);
    });

    it("holds the facing side in all day at neap, while spring tides still reverse it near the turns", () => {
      const neap = shareIn(tideWithDrift(0.15, 0.2, 270), EAST_RIM);
      const spring = shareIn(tideWithDrift(0.5, 0.2, 270), EAST_RIM);
      expect(neap).toBe(1);
      expect(spring).toBeGreaterThan(0.5);
      expect(spring).toBeLessThan(1);
    });

    it("with no drift, gives exactly the tide's own directions on every rim", () => {
      const calm = tideWithDrift(0.4, 0, 0);
      const east = forecastHours({ hours: calm, inwardBearingDeg: EAST_RIM, reports: [] });
      const west = forecastHours({ hours: calm, inwardBearingDeg: WEST_RIM, reports: [] });
      expect(east.map((hour) => hour.direction)).toEqual(west.map((hour) => hour.direction));
      for (const hour of east) {
        const slope = seaLevelSlopeAt(calm, hour.time)!;
        if (slope !== 0) expect(hour.direction).toBe(slope > 0 ? "incoming" : "outgoing");
      }
    });
  });

  it("an exact-zero residual hour is present with slack and the following run sign", () => {
    const levels = Array.from({ length: 48 }, (_, hour) => 0.125 * hour);
    levels[19] = levels[18];
    levels[31] = levels[6];
    const hours = marineFromLevels("2026-09-23T00:00", levels);
    const zeroHour = "2026-09-23T18:00";
    expect(seaLevelSlopeAt(hours, zeroHour)).toBe(0);
    const forecast = forecastHours({ hours, inwardBearingDeg: 0, reports: [] });
    const slack = forecast.find((hour) => hour.time.startsWith(zeroHour));
    const later = forecast.find((hour) => hour.time > zeroHour);
    expect(slack?.strength).toBe("slack");
    expect(slack?.direction).toBe(later?.direction);
    expect(slack?.direction === "incoming" || slack?.direction === "outgoing").toBe(true);
  });

  it("applySpeed slack times 2 stays slack", () => {
    expect(applySpeed("slack", 2)).toBe("slack");
  });

  it("malformed hour time cannot yield strength outside STRENGTHS", () => {
    const hours = [
      ...marineFromLevels(
        "2026-09-23T00:00",
        Array.from({ length: 14 }, (_, index) => 0.05 * index),
      ),
      { time: "not-a-clock", seaLevelM: 0.8, currentVelocityMs: 0, currentDirectionDeg: 0 },
    ];
    const forecast = forecastHours({
      hours,
      inwardBearingDeg: 0,
      reports: [{ id: "r", siteId: "s", time: "2026-09-23T03:00", direction: "incoming", strength: "mild" }],
    });
    expect(forecast.length).toBeGreaterThan(0);
    expect(forecast.every((hour) => (STRENGTHS as readonly string[]).includes(hour.strength))).toBe(true);
  });

  it("a 25-hour window with only 2 finite residuals has no range", () => {
    const hours = marineFromLevels(
      "2026-09-23T00:00",
      Array.from({ length: 25 }, () => 0.4),
    );
    const residual = hours.map((_, index) => (index === 12 || index === 13 ? 0.1 : null));
    expect(tideWindow(hours, residual, 12).range).toBeNull();
  });

  it("a null slope inside the series is marked failed even when its window has one off-centre slope", () => {
    const slopeWindowM = Array<number | null>(13).fill(null);
    slopeWindowM[0] = 0.08;
    const item = classifyReport(
      {
        id: "w14",
        siteId: "s",
        time: "2026-09-23T03:00",
        direction: "outgoing",
        strength: "mild",
        slopeM: null,
        slopeWindowM,
      },
      repeatingHours(),
    );
    expect(item.kind).toBe("in-series");
    expect(item.failed).toBe(true);
  });

  it("a window whose only finite slope is at index 0 is not single-slope with that slope", () => {
    const slopeWindowM = Array<number | null>(13).fill(null);
    slopeWindowM[0] = 0.08;
    const item = classifyReport(
      {
        id: "w13",
        siteId: "s",
        time: "2026-08-01T00:00",
        direction: "outgoing",
        strength: "mild",
        slopeM: null,
        slopeWindowM,
      },
      [],
    );
    expect(item.kind === "single-slope" && item.slope === 0.08).toBe(false);
  });

  it("toMaldivesWall of 2026-09-23 10:00 equals 2026-09-23T10:00", () => {
    expect(toMaldivesWall("2026-09-23 10:00")).toBe("2026-09-23T10:00");
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

describe("M1: Hydrodynamic Channel Constriction & Tidal Range Modeling", () => {
  describe("constrictionFactor calculation & boundaries", () => {
    it("returns 1.0 for undefined or missing dimensions", () => {
      expect(constrictionFactor(undefined, undefined)).toBe(1.0);
      expect(constrictionFactor(1500, undefined)).toBe(1.0);
      expect(constrictionFactor(undefined, 80)).toBe(1.0);
    });

    it("returns 1.0 for non-positive or non-finite dimensions", () => {
      expect(constrictionFactor(0, 80)).toBe(1.0);
      expect(constrictionFactor(1500, 0)).toBe(1.0);
      expect(constrictionFactor(-500, 40)).toBe(1.0);
      expect(constrictionFactor(500, -30)).toBe(1.0);
      expect(constrictionFactor(Number.NaN, 40)).toBe(1.0);
      expect(constrictionFactor(500, Number.POSITIVE_INFINITY)).toBe(1.0);
    });

    it("computes exact reference channel constriction as 1.0", () => {
      // Reference channel: a typical pass, 210m x 150m = 31,500 m^2
      expect(constrictionFactor(210, 150)).toBe(1.0);
    });

    it("computes realistic intermediate constriction (a narrower dive-site pass)", () => {
      // 500m x 30m = 15,000 m^2 -> (31,500 / 15,000)^0.35 ≈ 1.297
      const factor = constrictionFactor(500, 30);
      expect(factor).toBeGreaterThan(1.29);
      expect(factor).toBeLessThan(1.30);
    });

    it("clamps wide channels to minimum C_min = 1.0", () => {
      // Vaadhoo Kandu is 5000m x 400m, far wider than a pass, and 10,000m x 1,000m is wider still.
      expect(constrictionFactor(5000, 400)).toBe(1.0);
      expect(constrictionFactor(10000, 1000)).toBe(1.0);
    });

    it("clamps very narrow cuts to maximum C_max = 2.5", () => {
      // 100m x 10m = 1,000 m^2 -> (31,500 / 1,000)^0.35 ≈ 3.35 -> clamped to 2.5
      expect(constrictionFactor(100, 10)).toBe(2.5);
    });

    it("does not pin measured dive-site passes at the maximum", () => {
      // The published dive-site channels are 500 to 1500 m wide and 30 to 55 m deep.
      for (const [width, depth] of [[500, 30], [600, 40], [700, 40], [800, 40], [900, 35], [1200, 55], [1500, 45]]) {
        expect(constrictionFactor(width, depth)).toBeLessThan(1.5);
      }
    });
  });

  // Moderate tidal cycle: amplitude 0.26m -> range 0.52m (open water baseline is 'mild')
  function moderateTidalSeries(count = 72): MarineHour[] {
    const origin = Date.UTC(2026, 8, 23, 0, 0);
    return Array.from({ length: count }, (_, hour) => ({
      time: new Date(origin + hour * 3600 * 1000).toISOString().slice(0, 16),
      seaLevelM: 0.5 + 0.26 * Math.sin((2 * Math.PI * hour) / 12),
      currentVelocityMs: 0,
      currentDirectionDeg: 0,
    }));
  }

  it("Acceptance Criterion: constricted channel produces strictly stronger current rating at peak tidal flow than unconstricted open site under identical sea-level slopes", () => {
    const series = moderateTidalSeries(72);
    const peakHourTime = "2026-09-24T00:00"; // Steepest rising slope of the sine tide (maximum tidal flow)

    // Baseline: Unconstricted open water site (dimensions omitted)
    const openForecast = forecastHours({
      hours: series,
      inwardBearingDeg: 0,
      reports: [],
    });

    // Constricted pass site: e.g. 300m width, 20m depth (Ac = 6,000 m^2 -> C_constrict ≈ 1.79)
    const constrictedForecast = forecastHours({
      hours: series,
      inwardBearingDeg: 0,
      reports: [],
      channelWidthM: 300,
      channelDepthM: 20,
    });

    const openPeak = openForecast.find((h) => h.time.startsWith(peakHourTime));
    const constrictedPeak = constrictedForecast.find((h) => h.time.startsWith(peakHourTime));

    expect(openPeak).toBeDefined();
    expect(constrictedPeak).toBeDefined();

    // Baseline open water is 'mild' under moderate 0.52m range
    expect(openPeak?.strength).toBe("mild");

    // Constricted pass is amplified to 'strong' or 'too_strong'
    expect(["strong", "too_strong"]).toContain(constrictedPeak?.strength);

    // Explicit rank comparison: constricted must be strictly greater than open
    const openRank = STRENGTHS.indexOf(openPeak!.strength);
    const constrictedRank = STRENGTHS.indexOf(constrictedPeak!.strength);
    expect(constrictedRank).toBeGreaterThan(openRank);
  });

  it("produces progressive amplification for narrow vs wide channels under identical conditions", () => {
    const series = moderateTidalSeries(72);
    const peakHourTime = "2026-09-24T00:00"; // Steepest rising slope

    // Wide pass: Vaadhoo Kandu (5000m x 400m = 2,000,000 m^2, C = 1.0)
    const wideForecast = forecastHours({
      hours: series,
      inwardBearingDeg: 0,
      reports: [],
      channelWidthM: 5000,
      channelDepthM: 400,
    });

    // Moderate pass: (500m x 30m = 15,000 m^2, C ≈ 1.30)
    const moderateForecast = forecastHours({
      hours: series,
      inwardBearingDeg: 0,
      reports: [],
      channelWidthM: 500,
      channelDepthM: 30,
    });

    // Narrow cut: (300m x 20m = 6,000 m^2, C ≈ 1.79)
    const narrowForecast = forecastHours({
      hours: series,
      inwardBearingDeg: 0,
      reports: [],
      channelWidthM: 300,
      channelDepthM: 20,
    });

    const wideStrength = wideForecast.find((h) => h.time.startsWith(peakHourTime))?.strength;
    const moderateStrength = moderateForecast.find((h) => h.time.startsWith(peakHourTime))?.strength;
    const narrowStrength = narrowForecast.find((h) => h.time.startsWith(peakHourTime))?.strength;

    expect(STRENGTHS.indexOf(wideStrength!)).toBeLessThanOrEqual(STRENGTHS.indexOf(moderateStrength!));
    expect(STRENGTHS.indexOf(moderateStrength!)).toBeLessThanOrEqual(STRENGTHS.indexOf(narrowStrength!));
    expect(STRENGTHS.indexOf(narrowStrength!)).toBeGreaterThan(STRENGTHS.indexOf(wideStrength!));
  });

  describe("Boundary & Edge Cases", () => {
    const series = moderateTidalSeries(72);

    it("treats undefined and partial dimensions as unconstricted baseline", () => {
      const omitted = forecastHours({ hours: series, inwardBearingDeg: 0 });
      const bothUndefined = forecastHours({
        hours: series,
        inwardBearingDeg: 0,
        channelWidthM: undefined,
        channelDepthM: undefined,
      });
      const widthOnly = forecastHours({
        hours: series,
        inwardBearingDeg: 0,
        channelWidthM: 1500,
        channelDepthM: undefined,
      });
      const depthOnly = forecastHours({
        hours: series,
        inwardBearingDeg: 0,
        channelWidthM: undefined,
        channelDepthM: 80,
      });

      expect(bothUndefined).toEqual(omitted);
      expect(widthOnly).toEqual(omitted);
      expect(depthOnly).toEqual(omitted);
    });

    it("handles zero, negative, and NaN dimensions safely", () => {
      const omitted = forecastHours({ hours: series, inwardBearingDeg: 0 });
      const zeroInput = forecastHours({
        hours: series,
        inwardBearingDeg: 0,
        channelWidthM: 0,
        channelDepthM: 0,
      });
      const negativeInput = forecastHours({
        hours: series,
        inwardBearingDeg: 0,
        channelWidthM: -500,
        channelDepthM: 40,
      });
      const nanInput = forecastHours({
        hours: series,
        inwardBearingDeg: 0,
        channelWidthM: Number.NaN,
        channelDepthM: 40,
      });

      expect(zeroInput).toEqual(omitted);
      expect(negativeInput).toEqual(omitted);
      expect(nanInput).toEqual(omitted);
    });

    it("preserves slack water at turn-of-tide crests even in heavily constricted channels", () => {
      const crestSeries = Array.from({ length: 48 }, (_, i) => ({
        time: new Date(Date.UTC(2026, 8, 23, i)).toISOString().slice(0, 16),
        seaLevelM: 0.5 + 0.1 * Math.sin((2 * Math.PI * i) / 12),
        currentVelocityMs: 0,
        currentDirectionDeg: 0,
      }));

      const unconstricted = forecastHours({ hours: crestSeries, inwardBearingDeg: 0 });
      const constricted = forecastHours({
        hours: crestSeries,
        inwardBearingDeg: 0,
        channelWidthM: 500,
        channelDepthM: 20,
      });

      const crestHour = "2026-09-23T15:00";
      const unconstrictedCrest = unconstricted.find((h) => h.time.startsWith(crestHour));
      const constrictedCrest = constricted.find((h) => h.time.startsWith(crestHour));

      expect(unconstrictedCrest?.strength).toBe("slack");
      expect(constrictedCrest?.strength).toBe("slack");
    });

    it("dead flat tides produce slack conditions across all hours regardless of constriction", () => {
      const flatSeries = Array.from({ length: 48 }, (_, i) => ({
        time: new Date(Date.UTC(2026, 8, 23, i)).toISOString().slice(0, 16),
        seaLevelM: 0.4,
        currentVelocityMs: 0,
        currentDirectionDeg: 0,
      }));

      const constricted = forecastHours({
        hours: flatSeries,
        inwardBearingDeg: 0,
        channelWidthM: 300,
        channelDepthM: 20,
      });

      for (const h of constricted) {
        expect(h.strength).toBe("slack");
      }
    });

    it("never inverts or modifies tidal direction due to channel constriction", () => {
      const open = forecastHours({ hours: series, inwardBearingDeg: 0 });
      const constricted = forecastHours({
        hours: series,
        inwardBearingDeg: 0,
        channelWidthM: 1000,
        channelDepthM: 50,
      });

      expect(constricted.length).toBe(open.length);
      for (let i = 0; i < open.length; i++) {
        expect(constricted[i].direction).toBe(open[i].direction);
      }
    });
  });
});

