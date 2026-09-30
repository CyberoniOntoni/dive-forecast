import { describe, expect, it } from "vitest";
import { ATLAS_OVERLAYS, atlasTileFile, decodeRing, encodeRing, ringAreaM2, simplifyRing } from "./atlas-overlays";

describe("overlay rings", () => {
  it("round-trips to 1e-5 degrees and comes back as [lat, lon]", () => {
    const ring = [
      [73.126008231, -0.676431409],
      [73.126008231, -0.67652124],
      [73.12609, -0.67652124],
      [73.126008231, -0.676431409],
    ];
    const encoded = encodeRing(ring);
    expect(encoded.slice(0, 2)).toEqual([7312601, -67643]);
    expect(encoded[2]).toBe(0); // same longitude: a zero step
    expect(decodeRing(encoded)).toEqual(ring.map(([lon, lat]) => [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5]));
  });
});

describe("simplifyRing", () => {
  it("keeps a closed square's corners and drops points along its edges", () => {
    const square = [[0, 0], [0.5, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
    expect(simplifyRing(square, 0.01)).toEqual([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]);
  });

  it("keeps a small wiggle above the tolerance and drops one below it", () => {
    const line = [[0, 0], [1, 0.02], [2, 0]];
    expect(simplifyRing(line, 0.01)).toHaveLength(3);
    expect(simplifyRing(line, 0.05)).toHaveLength(2);
  });
});

describe("atlasTileFile", () => {
  it("names the tile by its south-west corner, south of the equator too", () => {
    expect(atlasTileFile(4.17, 73.51)).toBe("4.00_73.50.json");
    expect(atlasTileFile(-0.6, 73.1)).toBe("-0.75_73.00.json");
  });
});

describe("ringAreaM2", () => {
  it("measures a 100 m square near the equator", () => {
    const side = 100 / 111_320; // degrees for 100 m
    const square = [[73, 0], [73 + side, 0], [73 + side, side], [73, side], [73, 0]];
    expect(ringAreaM2(square)).toBeGreaterThan(9_900);
    expect(ringAreaM2(square)).toBeLessThan(10_100);
  });
});

it("gives each overlay unique class names and its own tile directory", () => {
  const overlays = Object.values(ATLAS_OVERLAYS);
  for (const overlay of overlays) {
    expect(new Set(overlay.classes.map((item) => item.name)).size).toBe(overlay.classes.length);
  }
  expect(new Set(overlays.map((overlay) => overlay.path)).size).toBe(overlays.length);
});
