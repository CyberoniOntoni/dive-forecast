import { describe, expect, it } from "vitest";
import { clampHourIndex } from "@/components/HourSlider";

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
