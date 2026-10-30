import { describe, expect, it } from "vitest";
import { parseWall } from "./forecast";

describe("parseWall", () => {
  it("gives the same answer from its memo as on first parse, including for bad input", () => {
    const first = parseWall("2026-10-30T14:00");
    expect(first).toBe(Date.UTC(2026, 9, 30, 14, 0));
    expect(parseWall("2026-10-30T14:00")).toBe(first);
    expect(parseWall("2026-10-30 14:00")).toBe(first);
    expect(parseWall("not a time")).toBeNaN();
    expect(parseWall("not a time")).toBeNaN();
  });
});
