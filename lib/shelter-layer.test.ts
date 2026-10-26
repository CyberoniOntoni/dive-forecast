import { describe, expect, it } from "vitest";
import { FIELD_NONE, FIELD_UNKNOWN } from "./shelter-field";
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
  it("puts the south row at the bottom, fills land from water next to it, and leaves unknown cells clear", () => {
    // Two rows of three: south row water 0.2 m, land, unknown; north row all land far from nothing.
    const values = new Uint8Array([10, FIELD_NONE, FIELD_UNKNOWN, FIELD_NONE, FIELD_NONE, FIELD_NONE]);
    const pixels = fieldPixels(2, 3, values);
    const alpha = (row: number, column: number) => pixels[(row * 3 + column) * 4 + 3];
    // Image row 1 is the south row.
    expect(alpha(1, 0)).toBe(255);
    expect(alpha(1, 1)).toBe(255); // land beside water, filled so the cut edge is full colour
    expect(alpha(1, 2)).toBe(0); // unknown
    expect([...pixels.slice((1 * 3 + 1) * 4, (1 * 3 + 1) * 4 + 3)]).toEqual(feltColor(0.2));
  });
});

describe("hourLabel", () => {
  it("names the day and hour", () => {
    expect(hourLabel("2026-10-26T21:00")).toBe("Mon 26 Oct, 21:00");
  });
});
