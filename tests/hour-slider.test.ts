import { describe, expect, it } from "vitest";
import { STRIP_HEIGHT, clampHourIndex, nextTurn, stripColor, turnText } from "@/components/HourSlider";
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

describe("nextTurn", () => {
  const hour = (time: string, direction: HourForecast["direction"]): HourForecast => ({
    time,
    direction,
    strength: "mild",
    confidence: "medium",
    levelM: 0,
  });
  const hours = [
    hour("2026-10-06T20:00", "outgoing"),
    hour("2026-10-06T21:00", "outgoing"),
    hour("2026-10-06T22:00", "incoming"),
    hour("2026-10-06T23:00", "incoming"),
  ];

  it("finds the first later hour that runs the other way", () => {
    expect(nextTurn(hours, 0)).toBe(2);
    expect(nextTurn(hours, 1)).toBe(2);
  });

  it("is null when the series never turns after the hour", () => {
    expect(nextTurn(hours, 2)).toBeNull();
    expect(nextTurn(hours, 3)).toBeNull();
    expect(nextTurn([], 0)).toBeNull();
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

describe("turnText", () => {
  const hour = (time: string, direction: HourForecast["direction"]): HourForecast => ({
    time,
    direction,
    strength: "mild",
    confidence: "medium",
    levelM: 0,
  });
  const hours = [hour("2026-10-06T20:00", "outgoing"), hour("2026-10-06T22:00", "incoming"), hour("2026-10-07T02:00", "outgoing")];
  const channelWord = (direction: HourForecast["direction"]) => (direction === "incoming" ? "Incoming" : "Outgoing");
  const compassWord = (direction: HourForecast["direction"]) => (direction === "incoming" ? "Running NE" : "Running SW");

  it("says a channel turn by its time today and by weekday later", () => {
    expect(turnText(1, hours, "2026-10-06", channelWord)).toBe("Turns incoming at 22:00");
    expect(turnText(2, hours, "2026-10-06", channelWord)).toBe("Turns outgoing Wed 7 at 02:00");
  });

  it("says a compass turn as 'to run' and a heading", () => {
    expect(turnText(2, hours, "2026-10-06", compassWord)).toBe("Turns to run SW Wed 7 at 02:00");
  });

  it("says so when the series never turns", () => {
    expect(turnText(null, hours, "2026-10-06", channelWord)).toBe("No turn in the rest of the forecast.");
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
