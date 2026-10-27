import { describe, expect, it } from "vitest";
import { blendSeaState, fetchLimitedChopM, seaBand, seaStateHours, WIND_WAVE_WEIGHT, type OffshoreSide } from "./sea-state";
import { STEP_DEG, type SiteExposure } from "./wave-exposure";
import type { HourForecast, SeaStateHour } from "./types";
import type { WaveHour } from "./waves";
import type { WindHour } from "./wind";

const OPEN_SEA: null[] = Array(360 / STEP_DEG).fill(null);
const FULL: SiteExposure = {
  swell: Array(360 / STEP_DEG).fill(1),
  wind: Array(360 / STEP_DEG).fill(1),
  rayWind: Array(360 / STEP_DEG).fill(1),
  fetchKm: OPEN_SEA,
};
/** Open to the east (from 45 to 135), sheltered to a tenth everywhere else. */
const EAST_ONLY: SiteExposure = {
  swell: Array.from({ length: 360 / STEP_DEG }, (_, index) => (index * STEP_DEG >= 45 && index * STEP_DEG <= 135 ? 1 : 0.1)),
  wind: Array.from({ length: 360 / STEP_DEG }, (_, index) => (index * STEP_DEG >= 45 && index * STEP_DEG <= 135 ? 1 : 0.1)),
  rayWind: Array.from({ length: 360 / STEP_DEG }, (_, index) => (index * STEP_DEG >= 45 && index * STEP_DEG <= 135 ? 1 : 0.1)),
  fetchKm: OPEN_SEA,
};
/** No wind at the hours the tests use, so only the wave model's seas count. */
const STILL: WindHour[] = ["2026-10-13T08:00", "t"].map((time) => ({ time, speedMs: 0, fromDeg: 0 }));

function wave(time: string, swellM: number, fromDeg: number, windM = 0, windFromDeg = fromDeg): WaveHour {
  return {
    time,
    swell: { heightM: swellM, fromDeg, periodS: 10 },
    secondarySwell: null,
    windWave: { heightM: windM, fromDeg: windFromDeg, periodS: 4 },
  };
}

function hour(time: string, direction: HourForecast["direction"], strength: HourForecast["strength"]): HourForecast {
  return { time, direction, strength, confidence: "medium", levelM: 0 };
}

describe("seaBand", () => {
  it("bands the felt height", () => {
    expect(seaBand(0.3)).toBe("calm");
    expect(seaBand(0.7)).toBe("moderate");
    expect(seaBand(1.2)).toBe("choppy");
    expect(seaBand(1.8)).toBe("rough");
  });
});

describe("seaStateHours", () => {
  it("takes each sea from the offshore side it comes from", () => {
    // East side sees 1.6 m from the east; the west side, in the atoll's lee, a damped 0.6 m from the same way.
    const sides: OffshoreSide[] = [
      { sideDeg: 90, hours: [wave("2026-10-13T08:00", 1.6, 90)] },
      { sideDeg: 270, hours: [wave("2026-10-13T08:00", 0.6, 95)] },
    ];
    const [sea] = seaStateHours({ sides, exposure: FULL, wind: STILL });
    expect(sea.swell?.heightM).toBe(1.6);
    expect(sea.band).toBe("rough");
  });

  it("cuts the swell a sheltered site gets", () => {
    const sides: OffshoreSide[] = [{ sideDeg: 270, hours: [wave("2026-10-13T08:00", 2, 270)] }];
    const [sea] = seaStateHours({ sides, exposure: EAST_ONLY, wind: STILL });
    expect(sea.swell?.heightM).toBeCloseTo(0.2, 5);
    expect(sea.band).toBe("calm");
  });

  it("counts wind chop harder than swell of the same height", () => {
    const swellOnly = seaStateHours({ sides: [{ sideDeg: 90, hours: [wave("t", 0.8, 90)] }], exposure: FULL, wind: STILL })[0];
    const chopOnly = seaStateHours({
      sides: [{ sideDeg: 90, hours: [{ time: "t", swell: null, secondarySwell: null, windWave: { heightM: 0.8, fromDeg: 90, periodS: 4 } }] }],
      exposure: FULL, wind: STILL,
    })[0];
    expect(swellOnly.band).toBe("moderate");
    expect(chopOnly.band).toBe("choppy");
  });

  it("flags swell running in against a strong outgoing current at a channel", () => {
    const time = "2026-10-13T08:00";
    // The channel runs in toward the west (270), so swell from the east comes in through it.
    const base = { sides: [{ sideDeg: 90, hours: [wave(time, 1.2, 90)] }], exposure: FULL, wind: STILL, route: "channel" as const, inwardBearingDeg: 270 };
    expect(seaStateHours({ ...base, current: [hour(time, "outgoing", "strong")] })[0].againstCurrent).toBe(true);
    expect(seaStateHours({ ...base, current: [hour(time, "incoming", "strong")] })[0].againstCurrent).toBe(false);
    expect(seaStateHours({ ...base, current: [hour(time, "outgoing", "mild")] })[0].againstCurrent).toBe(false);
    expect(seaStateHours({ ...base, route: "along-reef", current: [hour(time, "outgoing", "strong")] })[0].againstCurrent).toBe(false);
    expect(seaStateHours({ ...base, inwardBearingDeg: 90, current: [hour(time, "outgoing", "strong")] })[0].againstCurrent).toBe(false);
  });
});

describe("seaStateHours upstream side", () => {
  it("does not take a sea from a side in the atoll's lee", () => {
    // Only the west side loaded while an east swell runs: its damped sample is not used for the east swell.
    const sides: OffshoreSide[] = [{ sideDeg: 270, hours: [wave("2026-10-13T08:00", 0.5, 90)] }];
    expect(seaStateHours({ sides, exposure: FULL, wind: STILL })).toEqual([]);
  });
});

describe("seaStateHours with the swell side missing", () => {
  it("leaves the hour out rather than band it from the wind chop alone", () => {
    // The east side failed while a 1.6 m swell runs from the east. The west side has that swell only from its lee,
    // and a wind wave from the west that is inside the upstream cut.
    const time = "2026-10-13T08:00";
    const sides: OffshoreSide[] = [{ sideDeg: 270, hours: [wave(time, 0.5, 90, 0.2, 270)] }];
    expect(seaStateHours({ sides, exposure: FULL, wind: STILL })).toEqual([]);
  });

  it("still bands an hour whose every component comes from upwind", () => {
    const time = "2026-10-13T08:00";
    const sides: OffshoreSide[] = [{ sideDeg: 270, hours: [wave(time, 0.5, 270, 0.2, 270)] }];
    expect(seaStateHours({ sides, exposure: FULL, wind: STILL })).toHaveLength(1);
  });
});

describe("seaStateHours with an upwind side that has no such wave", () => {
  it("takes the upwind side's word that there is none, rather than leaving the hour out", () => {
    const time = "2026-10-13T08:00";
    // The east side loaded and has no secondary swell; the west side has one from the east, in its lee.
    const east: WaveHour = { ...wave(time, 1.0, 90), secondarySwell: null };
    const west: WaveHour = { ...wave(time, 0.4, 90), secondarySwell: { heightM: 0.3, fromDeg: 90, periodS: 8 } };
    const [sea] = seaStateHours({ sides: [{ sideDeg: 90, hours: [east] }, { sideDeg: 270, hours: [west] }], exposure: FULL, wind: STILL });
    expect(sea.swell?.heightM).toBe(1);
  });
});

describe("seaStateHours with an unknown component", () => {
  const time = "2026-10-13T08:00";

  it("keeps an hour that is already rough from what is known", () => {
    // East swell 1.6 m from its own side. A secondary swell from the north is only on the south side, in its lee, and
    // no northern side loaded: it is unknown, but it can only add to an hour that is already rough.
    const east: WaveHour = { ...wave(time, 1.6, 90), secondarySwell: null };
    const south: WaveHour = { ...wave(time, 0.4, 180), secondarySwell: { heightM: 0.5, fromDeg: 0, periodS: 9 } };
    const sides: OffshoreSide[] = [
      { sideDeg: 90, hours: [east] },
      { sideDeg: 180, hours: [south] },
    ];
    const [sea] = seaStateHours({ sides, exposure: FULL, wind: STILL });
    expect(sea.band).toBe("rough");
    expect(sea.swell?.heightM).toBe(1.6);
  });

  it("leaves the hour out when only a later lee copy lacks an upwind hour", () => {
    // Secondary swell in two lee copies. The first (from the east, on the west side) has an upwind east side that
    // loaded without it; the second (from the north, on the south side) has no northern side at all.
    const east: WaveHour = { ...wave(time, 0.4, 90), secondarySwell: null };
    const west: WaveHour = { ...wave(time, 0.3, 90), secondarySwell: { heightM: 0.3, fromDeg: 90, periodS: 8 } };
    const south: WaveHour = { ...wave(time, 0.3, 90), secondarySwell: { heightM: 0.6, fromDeg: 0, periodS: 9 } };
    const sides: OffshoreSide[] = [
      { sideDeg: 90, hours: [east] },
      { sideDeg: 270, hours: [west] },
      { sideDeg: 180, hours: [south] },
    ];
    expect(seaStateHours({ sides, exposure: FULL, wind: STILL })).toEqual([]);
  });
});

describe("local wind chop", () => {
  const time = "2026-10-13T08:00";
  /** A lagoon site with 20 km of open lagoon across the east (30° to 150°) and the rim close by everywhere else. */
  const LAGOON: SiteExposure = {
    swell: Array(360 / STEP_DEG).fill(0.1),
    wind: Array(360 / STEP_DEG).fill(0.1),
    rayWind: Array(360 / STEP_DEG).fill(0.1),
    fetchKm: Array.from({ length: 360 / STEP_DEG }, (_, index) => (Math.abs(index * STEP_DEG - 90) <= 60 ? 20 : 1)),
  };
  const calmSea: OffshoreSide[] = [{ sideDeg: 90, hours: [wave(time, 0.3, 90, 0.1, 90)] }];

  it("grows with wind speed and the square root of fetch", () => {
    expect(fetchLimitedChopM(10, 20)).toBeCloseTo(0.72, 2);
    expect(fetchLimitedChopM(10, 80)).toBeCloseTo(2 * fetchLimitedChopM(10, 20), 5);
    expect(fetchLimitedChopM(0, 20)).toBe(0);
    // Never above the fully developed sea for that wind.
    expect(fetchLimitedChopM(3, 10_000)).toBeCloseTo((0.2433 * 9) / 9.81, 5);
  });

  it("raises chop across the lagoon when the wind blows over its long side", () => {
    const across = seaStateHours({ sides: calmSea, exposure: LAGOON, wind: [{ time, speedMs: 10, fromDeg: 90 }] })[0];
    const short = seaStateHours({ sides: calmSea, exposure: LAGOON, wind: [{ time, speedMs: 10, fromDeg: 270 }] })[0];
    expect(across.windWaveM).toBeCloseTo(0.72, 2);
    expect(across.band).toBe("choppy");
    expect(short.windWaveM).toBeLessThan(0.2);
    expect(across.wind).toEqual({ speedMs: 10, fromDeg: 90 });
  });

  it("leaves wind from the open sea to the wave model", () => {
    const [sea] = seaStateHours({ sides: calmSea, exposure: FULL, wind: [{ time, speedMs: 10, fromDeg: 90 }] });
    expect(sea.windWaveM).toBeCloseTo(0.1, 5);
  });

  it("leaves out a lagoon hour with no wind unless it is already rough", () => {
    expect(seaStateHours({ sides: calmSea, exposure: LAGOON, wind: [] })).toEqual([]);
    const big: OffshoreSide[] = [{ sideDeg: 90, hours: [wave(time, 1.8, 90)] }];
    // Rough swell reaching a spot with sheltered water upwind: rough whatever the chop.
    const [sea] = seaStateHours({ sides: big, exposure: { ...LAGOON, swell: FULL.swell }, wind: [] });
    expect(sea.band).toBe("rough");
    expect(sea.wind).toBeNull();
  });

  it("keeps the wave model's band on open water when the wind is missing", () => {
    const moderate: OffshoreSide[] = [{ sideDeg: 90, hours: [wave(time, 0.7, 90, 0.2)] }];
    const [sea] = seaStateHours({ sides: moderate, exposure: FULL, wind: [] });
    expect(sea.band).toBe("moderate");
    expect(sea.wind).toBeNull();
  });

  it("only needs the wind where the water upwind of it is sheltered", () => {
    // Sheltered water to the west only; the wave model's wind sea comes from the east.
    const westFetch: SiteExposure = {
      ...FULL,
      fetchKm: Array.from({ length: 360 / STEP_DEG }, (_, index) => (index * STEP_DEG >= 225 && index * STEP_DEG <= 315 ? 5 : null)),
    };
    const fromEast: OffshoreSide[] = [{ sideDeg: 90, hours: [wave(time, 0.7, 90, 0.2, 90)] }];
    expect(seaStateHours({ sides: fromEast, exposure: westFetch, wind: [] })[0]?.band).toBe("moderate");
    const fromWest: OffshoreSide[] = [{ sideDeg: 270, hours: [wave(time, 0.7, 270, 0.2, 270)] }];
    expect(seaStateHours({ sides: fromWest, exposure: { ...westFetch, rayWind: FULL.wind.map(() => 0.5) }, wind: [] })).toEqual([]);
    // A sliver of sheltered water on otherwise open rays: the wave model's wind sea stands.
    expect(seaStateHours({ sides: fromWest, exposure: westFetch, wind: [] })[0]?.band).toBe("moderate");
  });

  it("reads the gate from each ray's own wind share, not the spread table", () => {
    // A 15° window of 20 km lagoon to the west (rays 265°, 270°, 275°), open sea on every other ray. Each of those rays
    // keeps sqrt(20 / 60) ≈ 0.58 of the wind; spread over ±45° with open neighbours the table reads about 0.92 there.
    const window = (index: number) => Math.abs(index * STEP_DEG - 270) <= 5;
    const exposure: SiteExposure = {
      ...FULL,
      wind: FULL.wind.map((_, index) => (window(index) ? 0.92 : 1)),
      rayWind: FULL.wind.map((_, index) => (window(index) ? 0.58 : 1)),
      fetchKm: FULL.wind.map((_, index) => (window(index) ? 20 : null)),
    };
    const moderate: OffshoreSide[] = [{ sideDeg: 270, hours: [wave(time, 0.7, 270, 0.2, 270)] }];
    // Without the wind, the chop that 20 km could raise is unknown: the moderate hour is left out.
    expect(seaStateHours({ sides: moderate, exposure, wind: [] })).toEqual([]);
    // Already rough whatever the chop: shown.
    const rough: OffshoreSide[] = [{ sideDeg: 270, hours: [wave(time, 1.8, 270, 0.2, 270)] }];
    expect(seaStateHours({ sides: rough, exposure, wind: [] })[0]?.band).toBe("rough");
    // The same window behind a sliver (each ray over 90% open): the wave model's band stands.
    const sliver = { ...exposure, rayWind: exposure.rayWind.map((share) => (share < 1 ? 0.95 : 1)) };
    expect(seaStateHours({ sides: moderate, exposure: sliver, wind: [] })[0]?.band).toBe("moderate");
  });
});

describe("blendSeaState", () => {
  const time = "2026-10-13T08:00";
  /** An hour of `swellM` swell from `fromDeg` and `chopM` chop, felt as seaStateHours puts them together. */
  const sea = (swellM: number, chopM: number, fromDeg: number): SeaStateHour => {
    const feltM = Math.sqrt(swellM ** 2 + (WIND_WAVE_WEIGHT * chopM) ** 2);
    return {
      time,
      band: seaBand(feltM),
      feltM,
      swell: { heightM: swellM, fromDeg, periodS: 8 },
      windWaveM: chopM,
      wind: { speedMs: 6, fromDeg: 260 },
      againstCurrent: false,
    };
  };

  it("mixes the two seas so the detail describes the felt height", () => {
    const own = sea(0.3, 0.2, 140); // felt about 0.41 m
    const other = sea(1.5, 0.3, 120); // felt about 1.56 m
    const mixed = blendSeaState(own, other, 0.5);
    expect(mixed).not.toBeNull();
    expect(mixed!.swell?.heightM).toBeCloseTo(0.9, 2);
    expect(mixed!.swell?.fromDeg).toBe(120); // the heavier swell
    expect(mixed!.windWaveM).toBeCloseTo(0.25, 2);
    expect(mixed!.feltM).toBeCloseTo(Math.sqrt(0.9 ** 2 + (WIND_WAVE_WEIGHT * 0.25) ** 2), 2);
    expect(mixed!.band).toBe("moderate");
    expect(mixed!.wind?.fromDeg).toBe(260);
  });

  it("mixes the felt swell, second swell included, so one sea feeds the band and the detail", () => {
    // Two equal 1.2 m swells and no chop: shown as 1.2 m, felt sqrt(2) × 1.2 ≈ 1.70 m (rounded, as stored).
    const crossed: SeaStateHour = { ...sea(1.2, 0, 140), feltM: 1.7, band: "rough" };
    const flat = sea(0, 0, 90);
    const mixed = blendSeaState(crossed, { ...flat, swell: null }, 0.6)!;
    expect(mixed.swell?.heightM).toBeCloseTo(1.02, 2);
    expect(mixed.swell?.fromDeg).toBe(140);
    expect(mixed.feltM).toBeCloseTo(1.02, 2);
    expect(mixed.band).toBe("choppy");
    // At share 1 the owner's sea comes back as its felt height.
    const whole = blendSeaState(crossed, flat, 1)!;
    expect(whole.feltM).toBe(1.7);
    expect(whole.swell?.heightM).toBe(1.7);
    expect(whole.band).toBe("rough");
  });

  it("drops the wind when the two disagree", () => {
    const other = { ...sea(1.5, 0.3, 120), wind: { speedMs: 6, fromDeg: 80 } };
    expect(blendSeaState(sea(0.3, 0.2, 140), other, 0.5)?.wind).toBeNull();
  });

  it("keeps a missing side unknown unless the known one is already rough", () => {
    expect(blendSeaState(sea(0.3, 0.2, 140), null, 0.7)).toBeNull();
    expect(blendSeaState(null, sea(2, 0.3, 120), 0.7)?.band).toBe("rough");
  });
});
