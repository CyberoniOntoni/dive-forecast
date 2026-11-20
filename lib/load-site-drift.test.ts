import { beforeEach, describe, expect, it, vi } from "vitest";
import { driftLenders, reportTideForSite } from "./load-site";
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
  ownFromFallback = false,
): Promise<number | null> {
  vi.mocked(Marine.siteMarineHours).mockResolvedValue({
    ok: true,
    hours: series(0, 0),
    fetchedAt: Date.now(),
    stale: false,
    ...(ownFromFallback ? { fromFallback: true as const } : {}),
  });
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
    expect(driftLenders(site, [site, catalogMate], atoll, own).lenders).toHaveLength(1);
    expect(driftLenders(site, [site, userMate], atoll, own).lenders).toHaveLength(0);
    expect(driftLenders(site, [site, farMate], atoll, own).lenders).toHaveLength(0);
  });

  it("does not reuse lenders when the atoll's pins change but their count does not", () => {
    expect(driftLenders(site, [site, catalogMate], atoll, own).lenders).toHaveLength(1);
    expect(driftLenders(site, [site, { ...catalogMate, siteType: "lagoon" }], atoll, own).lenders).toHaveLength(0);
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

  it("splits one weight among the pins of one channel, the site's own pin included", () => {
    const twin = corner("twin", catalogMate.lat + 0.001, catalogMate.lon);
    const one = driftLenders(site, [site, catalogMate], atoll, own);
    const two = driftLenders(site, [site, catalogMate, twin], atoll, own);
    expect(one.lenders.map((item) => item.share)).toEqual([1]);
    expect(two.lenders.map((item) => item.share)).toEqual([0.5, 0.5]);
    expect(two.ownShare).toBe(1);
    const sameChannel = corner("same-channel", site.lat + 0.001, site.lon);
    const mine = driftLenders(site, [site, sameChannel, catalogMate], atoll, own);
    expect(mine.ownShare).toBe(0.5);
  });

  it("fetches lenders without waiting, so a lender's first fetch never holds up the page", async () => {
    await throughflowWith([site, catalogMate], { ok: true, hours: series(0.3, 220), fetchedAt: Date.now(), stale: false });
    expect(vi.mocked(Marine.fetchMarine).mock.calls.every(([, , options]) => options?.wait === false)).toBe(true);
  });

  it("shares nothing when the site's own hours came from the atoll's ocean point", async () => {
    const borrowed = await throughflowWith(
      [site, catalogMate],
      { ok: true, hours: series(0.3, 220), fetchedAt: Date.now(), stale: false },
      true,
    );
    expect(borrowed).toBe(0);
  });
});
