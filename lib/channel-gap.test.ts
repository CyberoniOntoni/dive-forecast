import { describe, expect, it } from "vitest";
import { gapWidthM } from "./channel-gap";

const transect = (pattern: string) => [...pattern].map((cell) => cell === "#");

describe("gapWidthM", () => {
  it("measures the gap round the middle between two reef edges", () => {
    expect(gapWidthM(transect("#####" + ".".repeat(31) + "#####"))).toBe(310);
  });

  it("skips a hole in the reef that is narrower than a channel", () => {
    const reef = "#".repeat(40);
    expect(gapWidthM(transect(reef.slice(0, 18) + "..." + reef.slice(0, 19) + ".".repeat(20) + "###"))).toBe(200);
  });

  it("gives no width when one edge runs off the transect", () => {
    expect(gapWidthM(transect("#####" + ".".repeat(40)))).toBeNull();
  });
});
