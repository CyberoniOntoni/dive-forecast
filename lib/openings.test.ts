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

  it("counts a 400 m width and rejects 50 m and 4000 m", () => {
    expect(isCountedMouth({ widthM: 400 })).toBe(true);
    expect(isCountedMouth({ widthM: 50 })).toBe(false);
    expect(isCountedMouth({ widthM: 4000 })).toBe(false);
  });

  it("marks the 12 km bare rest of one crest as open coast", () => {
    const gaps = openingsFromCrestArcs([{ startM: 0, endM: 8000 }], perimeter);
    expect(gaps.find((gap) => gap.kind === "open-coast")).toMatchObject({ alongM: 12000 });
    expect(gaps.some((gap) => gap.kind === "opening")).toBe(false);
  });
});
