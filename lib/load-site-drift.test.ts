import { beforeEach, describe, expect, it, vi } from "vitest";
import { driftLenderPoints, reportTideForSite } from "./load-site";
import * as Marine from "./marine";
import type { Atoll, MarineHour, Site } from "./types";

vi.mock("./marine", async () => {
  const actual = await vi.importActual<typeof import("./marine")>("./marine");
  return { ...actual, siteMarineHours: vi.fn(), fetchMarine: vi.fn() };
});

// No outline for this atoll, so bearings come from the fallback heuristic and there is no ring level.
const atoll: Atoll = { id: "test-atoll", name: "Test", oceanLat: 4.6, oceanLon: 73.9, rimSourceUrl: "https://example.com/none" };
const corner = (id: string, lat: number, lon: number, extra: Partial<Site> = {}): Site => ({
  id,
  name: id,
  atollId: atoll.id,
  lat,
  lon,
  sourceUrl: "https://example.com/catalog",
  siteType: "corner",
  inwardBearingDeg: 220,
  ...extra,
});

const site = corner("prisca-like", 4.4834, 73.6943);
const catalogMate = corner("catalog-mate", 4.4888, 73.6885);
const userMate = corner("user-mate", 4.4888, 73.6885, { sourceUrl: "user", id: "user-mate" });
const farMate = corner("far-mate", 4.8, 73.69);

const series = (speed: number, directionDeg: number): MarineHour[] =>
  Array.from({ length: 96 }, (_, i) => {
    const wall = new Date(Date.UTC(2026, 10, 19, i)).toISOString().slice(0, 16);
    return {
      time: wall,
      seaLevelM: 0.5 + 0.3 * Math.sin((2 * Math.PI * i) / 12.42),
      currentVelocityMs: speed,
      currentDirectionDeg: directionDeg,
    };
  });

/** The own series has no current; any through-flow at the report hour has to come from a lender. */
async function throughflowWith(
  mates: Site[],
  lender: { ok: true; hours: MarineHour[]; fetchedAt: number; stale: boolean } | { ok: false; unavailable: true; pending?: true },
): Promise<number | null> {
  vi.mocked(Marine.siteMarineHours).mockResolvedValue({ ok: true, hours: series(0, 0), fetchedAt: Date.now(), stale: false });
  vi.mocked(Marine.fetchMarine).mockResolvedValue(lender);
  const tide = await reportTideForSite(site, mates, atoll, series(0, 0)[48].time);
  return tide?.throughflowM ?? null;
}

describe("shared drift at a channel site", () => {
  beforeEach(() => {
    vi.mocked(Marine.siteMarineHours).mockReset();
    vi.mocked(Marine.fetchMarine).mockReset();
    vi.spyOn(Marine, "marineSeriesStale").mockReturnValue(false);
  });

  const own = Marine.seawardPoint(site.lat, site.lon, 220);

  it("borrows from a catalog channel site nearby, never from a pin added in the app or one too far off", () => {
    expect(driftLenderPoints(site, [site, catalogMate], atoll, own)).toHaveLength(1);
    expect(driftLenderPoints(site, [site, userMate], atoll, own)).toHaveLength(0);
    expect(driftLenderPoints(site, [site, farMate], atoll, own)).toHaveLength(0);
  });

  it("does not reuse lenders when the atoll's pins change but their count does not", () => {
    expect(driftLenderPoints(site, [site, catalogMate], atoll, own)).toHaveLength(1);
    expect(driftLenderPoints(site, [site, { ...catalogMate, siteType: "lagoon" }], atoll, own)).toHaveLength(0);
  });

  it("takes a fresh lender's drift into the through-flow", async () => {
    const inward = await throughflowWith([site, catalogMate], { ok: true, hours: series(0.3, 220), fetchedAt: Date.now(), stale: false });
    expect(inward).toBeGreaterThan(0.05);
  });

  it("leaves out a lender that is stale, failed or still pending", async () => {
    const stale = await throughflowWith([site, catalogMate], { ok: true, hours: series(0.3, 220), fetchedAt: 1, stale: true });
    const failed = await throughflowWith([site, catalogMate], { ok: false, unavailable: true });
    const pending = await throughflowWith([site, catalogMate], { ok: false, unavailable: true, pending: true });
    expect([stale, failed, pending]).toEqual([0, 0, 0]);
  });

  it("leaves out a lender whose newest hour is too old", async () => {
    vi.spyOn(Marine, "marineSeriesStale").mockImplementation((hours) => (hours[0] as MarineHour | undefined)?.currentVelocityMs === 0.3);
    const old = await throughflowWith([site, catalogMate], { ok: true, hours: series(0.3, 220), fetchedAt: Date.now(), stale: false });
    expect(old).toBe(0);
  });

  it("gets nothing from a pin added in the app", async () => {
    const user = await throughflowWith([site, userMate], { ok: true, hours: series(0.3, 220), fetchedAt: Date.now(), stale: false });
    expect(user).toBe(0);
  });
});
