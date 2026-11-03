import { describe, expect, it } from "vitest";
import { CHANNEL_FUNNEL_KM, CHANNEL_GAP_MARGIN_KM, deriveSiteType, onRimBand } from "./site-type";
import { RIM_NEAR_KM, rimEdgeKm } from "./rim";
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
    expect(deriveSiteType({ name: "HP Reef", ...onRim }, RING)).toBe("outer-reef");
  });

  it("takes a thila or giri on the rim for a channel thila only near a known pass", () => {
    // Thila is an underwater pinnacle and giri an underwater shoal: neither says the site is in a channel.
    expect(deriveSiteType({ name: "Kandooma Thila", ...onRim }, RING)).toBe("outer-reef");
    expect(deriveSiteType({ name: "Kuda Giri", ...onRim }, RING)).toBe("outer-reef");
    const pass = { lat: 4.004, lon: 73.6 }; // about 0.5 km north
    expect(deriveSiteType({ name: "Kandooma Thila", ...onRim }, RING, [pass])).toBe("channel-thila");
    expect(deriveSiteType({ name: "Kuda Giri", ...onRim }, RING, [{ lat: 4.02, lon: 73.6 }])).toBe("outer-reef");
  });

  it("takes a rim pin in an open reef gap for a pass, whatever its name", () => {
    const gap = { lat: 4.0, lon: 73.6, widthM: 400 };
    expect(deriveSiteType({ name: "New spot", ...onRim }, RING, [], [gap])).toBe("pass");
    expect(deriveSiteType({ name: "New spot", ...onRim }, RING, [], [{ ...gap, lat: 4.02 }])).toBe("outer-reef");
    expect(deriveSiteType({ name: "New spot", ...deepInside }, RING, [], [gap])).toBe("lagoon");
  });

  it("does not take an island called Kandooma for a kandu", () => {
    expect(deriveSiteType({ name: "Kandooma Reef", ...onRim }, RING)).toBe("outer-reef");
  });
});

describe("site type thresholds", () => {
  // Points due north of a mate, on the great circle: 1 km is 1 / 111.195 degrees of latitude.
  const north = (from: { lat: number; lon: number }, km: number) => ({ lat: from.lat + km / 111.195, lon: from.lon });

  it("counts a pass 0.8 km away as near a thila, and not one 10 m farther", () => {
    const pass = { lat: 3.99, lon: 73.598 };
    expect(deriveSiteType({ name: "Kuda Thila", ...north(pass, CHANNEL_FUNNEL_KM - 0.01) }, RING, [pass])).toBe("channel-thila");
    expect(deriveSiteType({ name: "Kuda Thila", ...north(pass, CHANNEL_FUNNEL_KM + 0.01) }, RING, [pass])).toBe("outer-reef");
  });

  it("puts a pin within the gap's half width plus the margin in the gap, and not 10 m beyond", () => {
    const gap = { lat: 3.99, lon: 73.598, widthM: 400 };
    const reach = 0.2 + CHANNEL_GAP_MARGIN_KM;
    expect(deriveSiteType({ name: "New spot", ...north(gap, reach - 0.01) }, RING, [], [gap])).toBe("pass");
    expect(deriveSiteType({ name: "New spot", ...north(gap, reach + 0.01) }, RING, [], [gap])).toBe("outer-reef");
  });

  it("keeps a pin within 0.8 km of the outline on the rim band, and moves it to the lagoon 10 m farther in", () => {
    // Due west of the east rim at 4°N: 1 km is 1 / (111.32 · cos 4°) degrees of longitude in lib/rim.ts.
    const west = (km: number) => ({ lat: 4.0, lon: 73.6 - km / (111.32 * Math.cos((4 * Math.PI) / 180)) });
    const near = west(RIM_NEAR_KM - 0.01);
    const far = west(RIM_NEAR_KM + 0.01);
    expect(rimEdgeKm(near, RING)).toBeLessThan(RIM_NEAR_KM);
    expect(rimEdgeKm(far, RING)).toBeGreaterThan(RIM_NEAR_KM);
    expect(onRimBand(near, RING)).toBe(true);
    expect(onRimBand(far, RING)).toBe(false);
    expect(deriveSiteType({ name: "New spot", ...near }, RING)).toBe("outer-reef");
    expect(deriveSiteType({ name: "New spot", ...far }, RING)).toBe("lagoon");
  });
});
