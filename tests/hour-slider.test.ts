import { describe, expect, it } from "vitest";
import { STRIP_HEIGHT, clampHourIndex, nextTurn } from "@/components/HourSlider";
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
