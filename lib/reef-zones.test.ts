import { describe, expect, it } from "vitest";
import { decodeRing, encodeRing, reefTileFile, REEF_ZONE_CLASSES, simplifyRing } from "./reef-zones";

describe("reef-zone rings", () => {
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

describe("reefTileFile", () => {
  it("names the tile by its south-west corner, south of the equator too", () => {
    expect(reefTileFile(4.17, 73.51)).toBe("4.00_73.50.json");
    expect(reefTileFile(-0.6, 73.1)).toBe("-0.75_73.00.json");
  });
});

it("keeps one colour per Atlas class, with unique names", () => {
  expect(new Set(REEF_ZONE_CLASSES.map((item) => item.name)).size).toBe(REEF_ZONE_CLASSES.length);
});
