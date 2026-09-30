import { describe, expect, it } from "vitest";
import { deriveSiteType } from "./site-type";
import type { RimRing } from "./rim";

// A square atoll about 22 km across, centred on 4°N 73.5°E: rim at 3.9 and 4.1, 73.4 and 73.6.
const RING: RimRing = [
  [3.9, 73.4],
  [3.9, 73.6],
  [4.1, 73.6],
  [4.1, 73.4],
  [3.9, 73.4],
];
const onRim = { lat: 4.0, lon: 73.598 }; // about 0.2 km inside the east rim
const outsideRim = { lat: 4.0, lon: 73.603 }; // about 0.3 km outside it
const deepInside = { lat: 4.0, lon: 73.5 }; // 11 km from any rim

describe("deriveSiteType", () => {
  it("has no type without an atoll outline", () => {
    expect(deriveSiteType({ name: "Somewhere", ...onRim }, null)).toBeNull();
  });

  it("puts anything well inside the outline in the lagoon, whatever its name", () => {
    expect(deriveSiteType({ name: "Fish Head Thila", ...deepInside }, RING)).toBe("lagoon");
    expect(deriveSiteType({ name: "Old Kandu", ...deepInside }, RING)).toBe("lagoon");
  });

  it("reads the name on the rim when there are no reef zones", () => {
    expect(deriveSiteType({ name: "Miyaru Kandu", ...outsideRim }, RING)).toBe("pass");
    expect(deriveSiteType({ name: "Kuredu Express", ...onRim }, RING)).toBe("pass");
    expect(deriveSiteType({ name: "Kandooma Thila", ...onRim }, RING)).toBe("channel-thila");
    expect(deriveSiteType({ name: "Kuda Giri", ...onRim }, RING)).toBe("channel-thila");
    expect(deriveSiteType({ name: "HP Reef", ...onRim }, RING)).toBe("outer-reef");
  });

  it("does not take an island called Kandooma for a kandu", () => {
    expect(deriveSiteType({ name: "Kandooma Reef", ...onRim }, RING)).toBe("outer-reef");
  });
});
