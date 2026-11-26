import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeVectors, KNOTS_PER_MS } from "./flow-wire";
import { clearOceanGridMemo, fetchGrid, fillGaps, gridPoints, gridSize, oceanGridAt } from "./ocean-grid";

const TIMES = ["2026-09-01T00:00", "2026-09-01T01:00"];

/** Open-Meteo's multi-location answer: every location heading east at 1 km/h, or masked (`masked` true). */
function answer(url: string, masked = false) {
  const count = new URL(url).searchParams.get("latitude")!.split(",").length;
  return Array.from({ length: count }, () => ({
    hourly_units: { ocean_current_velocity: "km/h" },
    hourly: {
      time: TIMES,
      ocean_current_velocity: TIMES.map(() => (masked ? null : 3.6)),
      ocean_current_direction: TIMES.map(() => (masked ? null : 90)),
    },
  }));
}

let requests: string[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  requests = [];
  clearOceanGridMemo();
  fs.rmSync(path.join(process.env.MARINE_CACHE_DIR!, "ocean-grid.json"), { force: true });
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    requests.push(url);
    return new Response(JSON.stringify(answer(url)), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("gridPoints", () => {
  it("covers the Maldives on the grid and leaves out points inside an atoll outline", () => {
    const points = gridPoints();
    const { rows, columns } = gridSize();
    expect(points).toHaveLength(rows * columns);
    expect(points.some((point) => !point.sea)).toBe(true);
    expect(points.filter((point) => point.sea).length).toBeGreaterThan(points.length / 2);
  });
});

describe("fillGaps", () => {
  it("fills masked cells from their neighbours, and gives nothing when every cell is masked", () => {
    const filled = fillGaps([[1, 0], null, null, [0, 1]], 2, 2)!;
    expect(filled[1][0]).toBeCloseTo(0.5, 9);
    expect(filled[1][1]).toBeCloseTo(0.5, 9);
    expect(fillGaps([null, null], 1, 2)).toBeNull();
  });
});

describe("the ocean grid", () => {
  it("fetches every sea point in a few multi-location requests, in m/s east and north", async () => {
    const grid = await fetchGrid();
    expect(grid).not.toBeNull();
    const sea = gridPoints().filter((point) => point.sea).length;
    expect(requests.length).toBe(Math.ceil(sea / 80));
    const first = grid!.hours[0].find((value) => value != null)!;
    expect(first[0]).toBeCloseTo(1, 2);
    expect(first[1]).toBeCloseTo(0, 2);
  });

  it("does not wait for a first fetch when told not to, and serves the hour in knots once cached", async () => {
    expect(await oceanGridAt(TIMES[1], { wait: false })).toBeNull();
    const field = await oceanGridAt(TIMES[1], { wait: true });
    expect(field).not.toBeNull();
    const { east, north } = decodeVectors(field!.vectors);
    expect(east[0]).toBeCloseTo(KNOTS_PER_MS, 1);
    expect(north[0]).toBeCloseTo(0, 1);
    // Cached: no new request.
    const before = requests.length;
    await oceanGridAt(TIMES[0], { wait: true });
    expect(requests.length).toBe(before);
    expect(await oceanGridAt("2026-09-05T00:00", { wait: true })).toBeNull();
  });

  it("keeps nothing from a fetch that failed part way, and does not try again at once", async () => {
    let calls = 0;
    globalThis.fetch = (async (input: string | URL) => {
      calls += 1;
      if (calls === 2) return new Response("{}", { status: 500 });
      return new Response(JSON.stringify(answer(String(input))));
    }) as typeof fetch;
    expect(await oceanGridAt(TIMES[0], { wait: true })).toBeNull();
    const after = calls;
    expect(await oceanGridAt(TIMES[0], { wait: true })).toBeNull();
    expect(calls).toBe(after);
  });
});
