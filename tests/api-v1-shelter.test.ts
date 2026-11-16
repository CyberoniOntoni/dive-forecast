import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShelterView } from "@/lib/shelter-grid";
import type { SeaStateHour } from "@/lib/types";

type Box = { south: number; west: number; north: number; east: number };
/** What the mocked actions answer, and the calls they had. */
let view: ShelterView = { time: "2026-11-16T14:00", hours: [], atolls: [], stale: false };
let shapes: { outline: [number, number][]; islands: [number, number][][] } | null = null;
let point: SeaStateHour | "unknown" | null = null;
const calls: unknown[][] = [];
vi.mock("@/lib/actions", () => ({
  getShelter: async (box: Box, time?: string) => {
    calls.push(["shelter", box, time]);
    return view;
  },
  getShelterShapes: async (wayId: string) => {
    calls.push(["shapes", wayId]);
    return shapes;
  },
  getShelterPoint: async (lat: number, lon: number, time: string) => {
    calls.push(["point", lat, lon, time]);
    return point;
  },
}));

const shelter = await import("@/app/api/v1/shelter/route");
const shapesRoute = await import("@/app/api/v1/shelter/shapes/[wayId]/route");
const pointRoute = await import("@/app/api/v1/shelter/point/route");

const ask = (path: string) => new Request(`https://50bar.app/api/v1/shelter${path}`);

beforeEach(() => {
  calls.length = 0;
  view = { time: "2026-11-16T14:00", hours: [], atolls: [], stale: false };
  shapes = null;
  point = null;
});

describe("GET /api/v1/shelter", () => {
  it("gives the view's fields, the hours and the colour scale", async () => {
    view = {
      time: "2026-11-16T15:00",
      hours: ["2026-11-16T14:00", "2026-11-16T15:00"],
      atolls: [{ wayId: "123", layer: "coarse", south: 4, west: 73.2, stepDeg: 0.0045, rows: 1, columns: 2, values: "CjI=" }],
      stale: true,
    };
    const response = await shelter.GET(ask("?south=4&west=73.2&north=4.6&east=73.8&time=2026-11-16T15:00"));
    expect(response.status).toBe(200);
    expect(calls).toEqual([["shelter", { south: 4, west: 73.2, north: 4.6, east: 73.8 }, "2026-11-16T15:00"]]);
    const body = await response.json();
    expect(body).toMatchObject({ apiVersion: 1, time: "2026-11-16T15:00", hours: view.hours, stale: true, atolls: view.atolls });
    expect(body.scale.maxM).toBe(2);
    expect(body.scale.stops[0]).toEqual({ m: 0, color: "#26a678" });
    expect(body.scale.ticks.map((tick: { label: string }) => tick.label)).toEqual(["Calm", "Moderate", "Choppy", "Rough"]);
    expect(body.scale.opacity).toBe(0.85);
  });

  it("takes no time as the current hour", async () => {
    await shelter.GET(ask("?south=4&west=73.2&north=4.6&east=73.8"));
    expect(calls).toEqual([["shelter", { south: 4, west: 73.2, north: 4.6, east: 73.8 }, undefined]]);
  });

  it("refuses a missing, upside-down or too wide view, and a bad hour", async () => {
    for (const query of [
      "",
      "?south=4&west=73.2&north=4.6",
      "?south=4.6&west=73.2&north=4&east=73.8",
      "?south=x&west=73.2&north=4.6&east=73.8",
      "?south=-5&west=70&north=8&east=78",
      "?south=4&west=73.2&north=4.6&east=73.8&time=2026-11-16T15:30",
    ]) {
      const response = await shelter.GET(ask(query));
      expect(response.status, query).toBe(400);
      expect((await response.json()).error.code).toBe("bad_request");
    }
    expect(calls).toEqual([]);
  });
});

describe("GET /api/v1/shelter/shapes/{wayId}", () => {
  const get = (wayId: string) => shapesRoute.GET(ask(`/shapes/${wayId}`), { params: Promise.resolve({ wayId }) });

  it("gives the outline and islands, rounded, kept for a day", async () => {
    shapes = {
      outline: [
        [4.123456789, 73.4],
        [4.2, 73.5],
        [4.1, 73.6],
      ],
      islands: [
        [
          [4.15, 73.45],
          [4.151, 73.451],
          [4.15, 73.452],
        ],
      ],
    };
    const response = await get("671807065");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("max-age=86400");
    expect(await response.json()).toEqual({
      apiVersion: 1,
      wayId: "671807065",
      outline: [
        [4.12346, 73.4],
        [4.2, 73.5],
        [4.1, 73.6],
      ],
      islands: shapes.islands,
    });
  });

  it("is 404 for an unknown or malformed outline", async () => {
    expect((await get("42")).status).toBe(404);
    expect((await get("abc")).status).toBe(404);
    expect(calls).toEqual([["shapes", "42"]]);
  });
});

describe("GET /api/v1/shelter/point", () => {
  const hour: SeaStateHour = {
    time: "2026-10-26T21:00",
    band: "moderate",
    feltM: 0.72,
    swell: { heightM: 1.24, fromDeg: 225, periodS: 11.2 },
    windWaveM: 0.4,
    wind: { speedMs: 7.2, fromDeg: 270 },
    againstCurrent: false,
  };

  it("gives the sea state with the web popup's words", async () => {
    point = hour;
    const response = await pointRoute.GET(ask("/point?at=4.2,73.5&time=2026-10-26T21:00"));
    expect(calls).toEqual([["point", 4.2, 73.5, "2026-10-26T21:00"]]);
    expect(await response.json()).toEqual({
      apiVersion: 1,
      time: "2026-10-26T21:00",
      inLayer: true,
      seaState: hour,
      head: "Moderate · 0.7 m felt",
      detail: "1.2 m swell from SW, 11 s · 0.4 m wind chop · wind 14 kt from W. Mon 26 Oct, 21:00.",
    });
  });

  it("says when the spot has no data that hour, and when the layer does not reach it", async () => {
    point = "unknown";
    expect(await (await pointRoute.GET(ask("/point?at=4.2,73.5&time=2026-10-26T21:00"))).json()).toMatchObject({
      inLayer: true,
      seaState: null,
      head: "Sea state unknown",
      detail: "No wave or wind data here for Mon 26 Oct, 21:00.",
    });
    point = null;
    expect(await (await pointRoute.GET(ask("/point?at=4.2,73.5&time=2026-10-26T21:00"))).json()).toMatchObject({
      inLayer: false,
      seaState: null,
      head: null,
      detail: null,
    });
  });

  it("refuses a bad spot or hour", async () => {
    expect((await pointRoute.GET(ask("/point?at=95,73.5&time=2026-10-26T21:00"))).status).toBe(400);
    expect((await pointRoute.GET(ask("/point?at=4.2,73.5"))).status).toBe(400);
    expect(calls).toEqual([]);
  });
});
