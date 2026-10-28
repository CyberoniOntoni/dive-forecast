import { describe, expect, it } from "vitest";
import {
  destinationList,
  DESTINATION_LIMIT,
  alongRoute,
  etaMinutes,
  formatBearing,
  formatDuration,
  formatNm,
  keepFixes,
  motionFrom,
  SPEED_WINDOW_MS,
  type Fix,
} from "./boat-nav";
import { distanceKm } from "./geometry";

/** One nautical mile of latitude is one minute of arc. */
const NM_LAT = 1 / 60;

function fix(timeS: number, lat: number, extra: Partial<Fix> = {}): Fix {
  return { lat, lon: 73.5, timeMs: timeS * 1000, accuracyM: 5, speedMs: null, headingDeg: null, ...extra };
}

describe("motionFrom", () => {
  it("works out speed and course from positions when the device gives no speed", () => {
    // A tenth of a mile north in 36 s is 10 kn.
    const motion = motionFrom([fix(0, 4), fix(18, 4 + NM_LAT / 20), fix(36, 4 + NM_LAT / 10)]);
    expect(motion?.knots).toBeCloseTo(10, 0);
    expect(motion?.courseDeg).toBeCloseTo(0, 0);
  });

  it("prefers the device's own speed and heading", () => {
    const motion = motionFrom([fix(0, 4), fix(10, 4.0001, { speedMs: 5.144, headingDeg: 90 })]);
    expect(motion?.knots).toBeCloseTo(10, 1);
    expect(motion?.courseDeg).toBe(90);
  });

  it("calls a move inside the GPS accuracy drift: stopped, no course", () => {
    const motion = motionFrom([fix(0, 4, { accuracyM: 20 }), fix(20, 4.0001, { accuracyM: 20 })]);
    expect(motion).toEqual({ knots: 0, courseDeg: null });
  });

  it("uses the device's heading when it gives one without a speed", () => {
    const motion = motionFrom([fix(0, 4), fix(18, 4 + NM_LAT / 20, { headingDeg: 5 })]);
    expect(motion?.knots).toBeCloseTo(10, 0);
    expect(motion?.courseDeg).toBe(5);
  });

  it("takes no course from a move inside the GPS accuracy, even with a device speed", () => {
    const motion = motionFrom([fix(0, 4, { accuracyM: 20 }), fix(20, 4.0001, { accuracyM: 20, speedMs: 3 })]);
    expect(motion?.knots).toBeGreaterThan(5);
    expect(motion?.courseDeg).toBeNull();
  });

  it("says nothing until the fixes span a few seconds", () => {
    expect(motionFrom([])).toBeNull();
    expect(motionFrom([fix(0, 4), fix(1, 4.0001)])).toBeNull();
  });
});

describe("keepFixes", () => {
  it("drops fixes older than the window and out-of-order repeats", () => {
    const window = SPEED_WINDOW_MS / 1000;
    const kept = keepFixes([fix(0, 4), fix(10, 4), fix(window + 5, 4)], fix(window + 5, 4.1));
    expect(kept.map((item) => [item.timeMs / 1000, item.lat])).toEqual([
      [10, 4],
      [window + 5, 4.1],
    ]);
  });
});

describe("alongRoute", () => {
  const route: [number, number][] = [
    [4, 73.5],
    [4 + NM_LAT, 73.5],
    [4 + NM_LAT, 73.5 + NM_LAT],
  ];

  it("measures what is left from the nearest point and steers for the next turn", () => {
    const along = alongRoute({ lat: 4 + NM_LAT / 2, lon: 73.5 }, route);
    expect(along.offKm).toBeCloseTo(0, 3);
    expect(along.remainingKm).toBeCloseTo(distanceKm({ lat: 4, lon: 73.5 }, { lat: 4 + NM_LAT / 2, lon: 73.5 }) + distanceKm({ lat: 4 + NM_LAT, lon: 73.5 }, { lat: 4 + NM_LAT, lon: 73.5 + NM_LAT }), 3);
    expect(along.next).toEqual({ lat: 4 + NM_LAT, lon: 73.5 });
  });

  it("says how far off the route the boat is", () => {
    const along = alongRoute({ lat: 4 + NM_LAT / 4, lon: 73.51 }, route);
    expect(along.offKm).toBeCloseTo(1.11, 1);
  });
});

describe("etaMinutes", () => {
  it("gives ETA only under way", () => {
    expect(etaMinutes(1.852 * 5, 10)).toBeCloseTo(30, 6);
    expect(etaMinutes(5, 1)).toBeNull();
  });
});

describe("panel formatting", () => {
  it("formats distance, time and bearing", () => {
    expect(formatNm(1.852 * 0.43)).toBe("0.4 nm");
    expect(formatNm(1.852 * 12.6)).toBe("13 nm");
    expect(formatDuration(0.4)).toBe("under 1 min");
    expect(formatDuration(25)).toBe("25 min");
    expect(formatDuration(65)).toBe("1 h 05 min");
    expect(formatBearing(7)).toBe("007° N");
    expect(formatBearing(135.4)).toBe("135° SE");
    expect(formatBearing(359.7)).toBe("000° N");
  });
});

describe("destinationList", () => {
  const sites = [
    { id: "kuda", name: "Kuda Faru", atoll: "North Male", lat: 4.4, lon: 73.6 },
    { id: "kandooma", name: "Kandooma Thila", atoll: "South Male", lat: 3.91, lon: 73.48 },
    { id: "banana", name: "Banana Reef", atoll: "North Male", lat: 4.24, lon: 73.53 },
  ];

  it("sorts by name until the boat's position is known, then nearest first", () => {
    expect(destinationList(sites, "", null).map((site) => site.id)).toEqual(["banana", "kandooma", "kuda"]);
    const near = destinationList(sites, "", { lat: 3.9, lon: 73.48 });
    expect(near.map((site) => site.id)).toEqual(["kandooma", "banana", "kuda"]);
    expect(near[0].km).toBeLessThan(2);
  });

  it("matches every word against the name and the atoll", () => {
    expect(destinationList(sites, "north", null).map((site) => site.id)).toEqual(["banana", "kuda"]);
    expect(destinationList(sites, "  Male  thila ", null).map((site) => site.id)).toEqual(["kandooma"]);
    expect(destinationList(sites, "wreck", null)).toEqual([]);
  });

  it("keeps the list short", () => {
    const many = Array.from({ length: DESTINATION_LIMIT + 5 }, (_, index) => ({ ...sites[0], id: `s${index}` }));
    expect(destinationList(many, "", null)).toHaveLength(DESTINATION_LIMIT);
  });
});
