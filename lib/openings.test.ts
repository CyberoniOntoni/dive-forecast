import { describe, expect, it } from "vitest";
import { isCountedMouth, openingsFromCrestArcs } from "./openings";

const perimeter = 20_000;

describe("reef-crest openings", () => {
  it("keeps a 400 m mouth between two crest arcs", () => {
    const gaps = openingsFromCrestArcs(
      [
        { startM: 0, endM: 1000 },
        { startM: 1400, endM: 5000 },
      ],
      perimeter,
    );
    expect(gaps.find((gap) => gap.kind === "opening")).toMatchObject({ alongM: 400, startM: 1000, endM: 1400 });
  });

  it("drops a 40 m crack", () => {
    const gaps = openingsFromCrestArcs(
      [
        { startM: 0, endM: 1000 },
        { startM: 1040, endM: 5000 },
      ],
      perimeter,
    );
    expect(gaps.some((gap) => gap.kind === "opening")).toBe(false);
  });

  it("joins mouths separated by a 40 m crest sliver", () => {
    const gaps = openingsFromCrestArcs(
      [
        { startM: 0, endM: 1000 },
        { startM: 1040, endM: 1100 },
        { startM: 1500, endM: 4000 },
      ],
      perimeter,
    );
    expect(gaps.find((gap) => gap.kind === "opening")).toMatchObject({ alongM: 500, startM: 1000, endM: 1500 });
  });

  it("marks a 4 km bare arc as open coast", () => {
    const gaps = openingsFromCrestArcs(
      [
        { startM: 0, endM: 1000 },
        { startM: 5000, endM: 8000 },
      ],
      perimeter,
    );
    expect(gaps.find((gap) => gap.alongM === 4000)?.kind).toBe("open-coast");
  });

  it("keeps a mouth that reef flat bridges", () => {
    expect(isCountedMouth({ widthM: 400, reefFlatBridges: true })).toBe(true);
  });

  it("drops a rim that has crest on only one side of a short bare arc", () => {
    const gaps = openingsFromCrestArcs([{ startM: 0, endM: 8000 }], perimeter);
    expect(gaps.some((gap) => gap.kind === "opening")).toBe(false);
  });
});
