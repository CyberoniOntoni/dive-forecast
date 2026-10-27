import { describe, expect, it } from "vitest";
import { FIELD_LAND, FIELD_NONE, FIELD_OTHER, FIELD_OUTSIDE, FIELD_UNKNOWN } from "./shelter-field";
import { feltColor, fieldPixels, hourLabel } from "./shelter-layer";

describe("feltColor", () => {
  it("runs from green when calm to red when rough, blending between", () => {
    const [calmR, calmG] = feltColor(0);
    const [roughR, roughG] = feltColor(1.5);
    expect(calmG).toBeGreaterThan(calmR);
    expect(roughR).toBeGreaterThan(roughG);
    const middle = feltColor(0.25);
    expect(middle[0]).toBeGreaterThan(calmR);
    expect(middle[0]).toBeLessThan(feltColor(0.5)[0]);
    expect(feltColor(9)).toEqual(feltColor(2));
  });
});

describe("fieldPixels", () => {
  it("puts the south row at the bottom, fills land from water next to it, and leaves unknown and missing cells clear", () => {
    // Two rows of three: south row water 0.2 m, island, unknown; north row no cells at all.
    const values = new Uint8Array([10, FIELD_LAND, FIELD_UNKNOWN, FIELD_NONE, FIELD_NONE, FIELD_NONE]);
    const pixels = fieldPixels(2, 3, values);
    const alpha = (row: number, column: number) => pixels[(row * 3 + column) * 4 + 3];
    // Image row 1 is the south row.
    expect(alpha(1, 0)).toBe(255);
    expect(alpha(1, 1)).toBe(255); // land beside water, filled so the cut edge is full colour
    expect(alpha(1, 2)).toBe(0); // unknown
    expect(alpha(0, 0)).toBe(0); // no cell: the shading fades out here
    expect([...pixels.slice((1 * 3 + 1) * 4, (1 * 3 + 1) * 4 + 3)]).toEqual(feltColor(0.2));
  });

  it("draws one side of the outline at a time, filling the other side's water from its own", () => {
    // Lagoon 0.2 m beside sea 1.0 m.
    const values = new Uint8Array([10, 50 | FIELD_OUTSIDE]);
    const lagoon = fieldPixels(1, 2, values, false);
    const sea = fieldPixels(1, 2, values, true);
    expect([...lagoon.slice(4, 7)]).toEqual(feltColor(0.2));
    expect([...sea.slice(0, 3)]).toEqual(feltColor(1.0));
    expect([...sea.slice(4, 7)]).toEqual(feltColor(1.0));
  });

  it("fades the sea out toward the grid's edge, but not toward a neighbouring atoll's sea", () => {
    // One row: grid edge, five sea cells, then another atoll's sea.
    const sea = 25 | FIELD_OUTSIDE;
    const values = new Uint8Array([FIELD_NONE, sea, sea, sea, sea, sea, FIELD_OTHER]);
    const pixels = fieldPixels(1, 7, values, true, 4);
    const alpha = (column: number) => pixels[column * 4 + 3];
    expect(alpha(0)).toBe(0);
    expect(alpha(1)).toBeLessThan(alpha(2));
    expect(alpha(5)).toBe(255);
    expect(alpha(6)).toBe(0); // the neighbour draws its own
  });
});

describe("hourLabel", () => {
  it("names the day and hour", () => {
    expect(hourLabel("2026-10-26T21:00")).toBe("Mon 26 Oct, 21:00");
  });
});
