import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoatTrip } from "@/lib/boat-route-data";
import { ROUTE_OUTSIDE } from "@/lib/boat-route-limits";

type From = { lat: number; lon: number };
/** What the mocked getBoatRoute answers, and the calls it had. */
let answer: (from: From, to: string) => Promise<BoatTrip | null> = async () => null;
const calls: [From, string][] = [];
vi.mock("@/lib/actions", () => ({
  getBoatRoute: (from: From, to: string) => {
    calls.push([from, to]);
    return answer(from, to);
  },
}));

const { GET } = await import("@/app/api/v1/boat-route/route");

const trip: BoatTrip = {
  points: [
    [4.123456789, 73.5],
    [4.2, 73.512345678],
  ],
  lengthKm: 9.87654,
  directKm: 9.1,
  routed: true,
  gaps: [{ lat: 4.15, lon: 73.505, widthM: 212.4, shallow: false }],
  current: {
    stepKm: 0.25,
    samples: [0, 0, -1],
    sources: [
      {
        siteId: "banana-reef",
        name: "Banana Reef",
        hours: [{ timeMs: 1_763_270_000_000, eastKn: 0.5657, northKn: -0.5657, strength: "mild" }],
      },
    ],
  },
};

function ask(query: string) {
  return GET(new Request(`https://50bar.app/api/v1/boat-route${query}`));
}

describe("GET /api/v1/boat-route", () => {
  beforeEach(() => {
    calls.length = 0;
    answer = async () => null;
  });

  it("gives the route and its current, rounded, never cached", async () => {
    answer = async () => trip;
    const response = await ask("?from=4.1,73.4&to=banana-reef");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(calls).toEqual([[{ lat: 4.1, lon: 73.4 }, "banana-reef"]]);
    expect(await response.json()).toEqual({
      apiVersion: 1,
      points: [
        [4.12346, 73.5],
        [4.2, 73.51235],
      ],
      lengthKm: 9.877,
      directKm: 9.1,
      routed: true,
      gaps: [{ lat: 4.15, lon: 73.505, widthM: 212, shallow: false }],
      current: {
        stepKm: 0.25,
        samples: [0, 0, -1],
        sources: [
          {
            siteId: "banana-reef",
            name: "Banana Reef",
            hours: [{ timeMs: 1_763_270_000_000, eastKn: 0.57, northKn: -0.57, strength: "mild" }],
          },
        ],
      },
    });
  });

  it("takes a point picked on the map as the destination, and a route with no current", async () => {
    answer = async () => ({ ...trip, current: null });
    const response = await ask("?from=4.1,73.4&to=4.25000,73.60000");
    expect(calls).toEqual([[{ lat: 4.1, lon: 73.4 }, "4.25000,73.60000"]]);
    expect((await response.json()).current).toBeNull();
  });

  it("answers 400 for a missing position or destination, and for a start outside the Maldives", async () => {
    expect((await ask("?to=banana-reef")).status).toBe(400);
    expect((await ask("?from=north&to=banana-reef")).status).toBe(400);
    expect((await ask("?from=4.1,73.4")).status).toBe(400);
    // Off the globe, at either end, is a bad request, never an unknown site.
    expect((await ask("?from=91,73&to=banana-reef")).status).toBe(400);
    for (const to of ["91,73", "4.2,200", "4.2,73,1"]) {
      const response = await ask(`?from=4.1,73.4&to=${to}`);
      expect(response.status).toBe(400);
      expect((await response.json()).error.message).toBe("Routes go to a dive site or a point in the Maldives.");
    }
    expect(calls).toEqual([]);
    answer = async () => {
      throw new Error(ROUTE_OUTSIDE);
    };
    const outside = await ask("?from=51.5,-0.1&to=banana-reef");
    expect(outside.status).toBe(400);
    expect(await outside.json()).toEqual({ error: { code: "bad_request", message: "Routes start in the Maldives." } });
  });

  it("answers 404 for an unknown site and 500 for a failure, never with its text", async () => {
    answer = async () => null;
    expect((await ask("?from=4.1,73.4&to=nowhere")).status).toBe(404);
    vi.spyOn(console, "error").mockImplementation(() => {});
    answer = async () => {
      throw new Error("disk on fire");
    };
    const failed = await ask("?from=4.1,73.4&to=banana-reef");
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain("disk");
  });
});
