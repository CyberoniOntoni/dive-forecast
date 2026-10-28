import { describe, expect, it } from "vitest";
import { parseShoals } from "./shoals";

const RING = [
  [4, 73.5],
  [4.001, 73.5],
  [4.001, 73.501],
  [4, 73.5],
];

describe("parseShoals", () => {
  it("reads shoals with their kind and ring", () => {
    expect(parseShoals(JSON.stringify({ shoals: [{ kind: "reef", ring: RING }] }))).toEqual([{ kind: "reef", ring: RING }]);
  });

  it("throws on a file of the wrong shape", () => {
    expect(() => parseShoals("{}")).toThrow(/not a list/);
    expect(() => parseShoals(JSON.stringify({ shoals: [{ kind: "sandbar", ring: RING }] }))).toThrow(/shoal 0 has no valid kind/);
    expect(() => parseShoals(JSON.stringify({ shoals: [{ kind: "shallow", ring: [...RING.slice(0, 3), [4, 73.6]] }] }))).toThrow(
      /not closed/,
    );
  });
});
