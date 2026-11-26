import { describe, expect, it } from "vitest";
import { STRIP_HEIGHT, clampHourIndex, flowNextText, nextFlowChange, shortTurnTarget, smoothPath, stripColor, tideTrend, tideTurns } from "@/components/HourSlider";
import type { HourForecast } from "@/lib/types";

describe("clampHourIndex", () => {
  it("keeps a slider index inside the hours", () => {
    // W7: Math.max(0, Math.min(index, hours.length - 1))
    expect(clampHourIndex(-1, 24)).toBe(0);
    expect(clampHourIndex(0, 24)).toBe(0);
    expect(clampHourIndex(23, 24)).toBe(23);
    expect(clampHourIndex(24, 24)).toBe(23);
    expect(clampHourIndex(99, 1)).toBe(0);
  });
});

describe("nextFlowChange", () => {
  const hour = (time: string, direction: HourForecast["direction"], strength: HourForecast["strength"] = "mild"): HourForecast => ({
    time,
    direction,
    strength,
    confidence: "medium",
    levelM: 0,
  });
  const hours = [
    hour("2026-10-06T20:00", "outgoing"),
    hour("2026-10-06T21:00", "outgoing", "strong"),
    hour("2026-10-06T22:00", "incoming", "strong"),
    hour("2026-10-06T23:00", "incoming", "strong"),
  ];

  it("counts a new strength as a change, not only a new way", () => {
    expect(nextFlowChange(hours, 0)).toBe(1);
    expect(nextFlowChange(hours, 1)).toBe(2);
  });

  it("is null when the flow holds to the end", () => {
    expect(nextFlowChange(hours, 2)).toBeNull();
    expect(nextFlowChange(hours, 3)).toBeNull();
    expect(nextFlowChange([], 0)).toBeNull();
  });
});

describe("STRIP_HEIGHT", () => {
  it("grows with strength and leaves slack a visible sliver", () => {
    expect(STRIP_HEIGHT.slack).toBeGreaterThan(0);
    expect(STRIP_HEIGHT.slack).toBeLessThan(STRIP_HEIGHT.mild);
    expect(STRIP_HEIGHT.mild).toBeLessThan(STRIP_HEIGHT.strong);
    expect(STRIP_HEIGHT.strong).toBeLessThan(STRIP_HEIGHT.too_strong);
  });
});

describe("flowNextText", () => {
  const hour = (time: string, direction: HourForecast["direction"], strength: HourForecast["strength"]): HourForecast => ({
    time,
    direction,
    strength,
    confidence: "medium",
    levelM: 0,
  });
  const hours = [
    hour("2026-10-06T20:00", "outgoing", "mild"),
    hour("2026-10-06T21:00", "outgoing", "strong"),
    hour("2026-10-07T02:00", "incoming", "slack"),
  ];
  const channelWord = (direction: HourForecast["direction"]) => (direction === "incoming" ? "Incoming" : "Outgoing");
  const compassWord = (direction: HourForecast["direction"]) => (direction === "incoming" ? "Running NE" : "Running SW");

  it("names only the strength while the way holds", () => {
    expect(flowNextText(1, hours, 0, "2026-10-06", channelWord)).toEqual({ title: "Strong", when: "at 21:00 · in 1 h" });
  });

  it("adds the way when it turns, by weekday on a later day", () => {
    expect(flowNextText(2, hours, 1, "2026-10-06", channelWord)).toEqual({ title: "Slack, incoming", when: "Wed 7 at 02:00 · in 5 h" });
    expect(flowNextText(2, hours, 1, "2026-10-06", compassWord).title).toBe("Slack, running NE");
  });

  it("counts clock hours, not series steps, across a gap in the hours", () => {
    // 21:00 to 02:00 next day is one step in the series but five hours.
    expect(flowNextText(2, hours, 1, "2026-10-06", channelWord).when).toBe("Wed 7 at 02:00 · in 5 h");
  });

  it("says the flow holds when nothing changes", () => {
    expect(flowNextText(null, hours, 2, "2026-10-06", channelWord)).toEqual({ title: "Holds", when: "to the end of the forecast" });
  });
});

describe("stripColor", () => {
  const hour = (direction: HourForecast["direction"], strength: HourForecast["strength"]): HourForecast => ({
    time: "2026-10-06T20:00",
    direction,
    strength,
    confidence: "high",
    levelM: 0,
  });

  it("uses the stop token for very strong on every route", () => {
    expect(stripColor(hour("incoming", "too_strong"), false)).toBe("var(--stop)");
    expect(stripColor(hour("outgoing", "too_strong"), true)).toBe("var(--stop)");
  });

  it("uses foam where the way is a compass heading", () => {
    expect(stripColor(hour("incoming", "strong"), true)).toBe("var(--foam)");
    expect(stripColor(hour("outgoing", "mild"), true)).toBe("var(--foam)");
  });

  it("uses the in and out colours at a channel", () => {
    expect(stripColor(hour("incoming", "strong"), false)).toBe("var(--incoming)");
    expect(stripColor(hour("outgoing", "slack"), false)).toBe("var(--outgoing)");
  });
});

describe("tide and dial helpers", () => {
  it("finds highs and lows, a flat top once, never at the ends", () => {
    expect(tideTurns([0, 0.2, 0.2, 0.1, -0.3, -0.1, 0.4])).toEqual([
      { index: 1, high: true },
      { index: 4, high: false },
    ]);
    expect(tideTurns([1, 0, 1])).toEqual([{ index: 1, high: false }]);
    expect(tideTurns([0, 1])).toEqual([]);
  });

  it("reads rising and falling from the hour before, the first hour from the one after", () => {
    const levels = [0, 0.3, 0.3, 0.1];
    expect(tideTrend(levels, 0)).toBe("rising");
    expect(tideTrend(levels, 1)).toBe("rising");
    expect(tideTrend(levels, 2)).toBeNull();
    expect(tideTrend(levels, 3)).toBe("falling");
    expect(tideTrend([0.1], 0)).toBeNull();
  });

  it("turns the arrow the short way round", () => {
    expect(shortTurnTarget(350, 10)).toBe(370);
    expect(shortTurnTarget(10, 350)).toBe(-10);
    expect(shortTurnTarget(370, 180)).toBe(540);
    // A half turn either way is as short; it goes back.
    expect(shortTurnTarget(90, 270)).toBe(-90);
  });

  it("draws a smooth path through every point", () => {
    expect(smoothPath([])).toBe("");
    expect(smoothPath([[0, 50]])).toBe("M0,50");
    const d = smoothPath([[0, 50], [1, 10], [2, 50]]);
    expect(d.startsWith("M0,50 C")).toBe(true);
    expect(d.match(/C/g)).toHaveLength(2);
    expect(d.endsWith(" 2,50")).toBe(true);
  });
});
