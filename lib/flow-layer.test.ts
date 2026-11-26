import { describe, expect, it } from "vitest";
import { gatesOf } from "./flow-layer";
import type { FlowAtoll } from "./flow-wire";

const atoll = (extra: Partial<FlowAtoll>): FlowAtoll => ({ wayId: "1", atollId: "a", lagoon: null, ocean: [], channels: [], walls: [], ...extra });

describe("gatesOf", () => {
  it("opens every gap at its own flow, and a gap with a catalog site at that site's forecast across the whole gap", () => {
    const gates = gatesOf(
      atoll({
        gaps: [
          { lat: 4, lon: 73.6, widthM: 900, headingDeg: 270, knots: 0.8, siteIds: ["pass"] },
          { lat: 4.05, lon: 73.6, widthM: 300, headingDeg: 90, knots: 0.32, siteIds: [] },
        ],
        channels: [
          { id: "pass", widthM: 200 },
          { id: "lone", widthM: null },
        ],
      }),
      new Map([
        // The pass's pin says strong, ebbing out a little north of east.
        ["pass", { lat: 4.001, lon: 73.601, headingDeg: 80, knots: 1.6 }],
        ["lone", { lat: 3.95, lon: 73.6, headingDeg: 270, knots: 0.8 }],
      ]),
    );
    expect(gates).toHaveLength(3);
    // The gap keeps its place, width and axis; the pin sets the speed and the way it runs.
    expect(gates[0]).toEqual({ lat: 4, lon: 73.6, headingDeg: 90, knots: 1.6, widthKm: 0.9 });
    expect(gates[1]).toEqual({ lat: 4.05, lon: 73.6, headingDeg: 90, knots: 0.32, widthKm: 0.3 });
    // A catalog channel in no gap keeps its own arrow.
    expect(gates[2]).toMatchObject({ lat: 3.95, headingDeg: 270, knots: 0.8, widthKm: 0.4 });
  });
});
