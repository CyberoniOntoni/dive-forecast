import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearLagoonMemo, driftLenders, driftShares, loadSite, reportTideForSite } from "./load-site";
import { distanceKm } from "./geometry";
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
    expect(driftLenders(site, [site, catalogMate], atoll, own)).toHaveLength(1);
    expect(driftLenders(site, [site, userMate], atoll, own)).toHaveLength(0);
    expect(driftLenders(site, [site, farMate], atoll, own)).toHaveLength(0);
  });

  it("does not reuse lenders when the atoll's pins change but their count does not", () => {
    expect(driftLenders(site, [site, catalogMate], atoll, own)).toHaveLength(1);
    expect(driftLenders(site, [site, { ...catalogMate, siteType: "lagoon" }], atoll, own)).toHaveLength(0);
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
    const sameChannel = corner("same-channel", site.lat + 0.001, site.lon);
    expect(driftShares(site, [catalogMate])).toEqual({ own: 1, lenders: [1] });
    expect(driftShares(site, [catalogMate, twin])).toEqual({ own: 1, lenders: [0.5, 0.5] });
    expect(driftShares(site, [sameChannel, catalogMate])).toEqual({ own: 0.5, lenders: [0.5, 1] });
  });

  it("waits for lenders as the caller does, so a report saves the forecast the page shows a moment later", async () => {
    await throughflowWith([site, catalogMate], { ok: true, hours: series(0.3, 220), fetchedAt: Date.now(), stale: false });
    const calls = vi.mocked(Marine.fetchMarine).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(([, , options]) => options?.wait !== false)).toBe(true);
  });

  it("does not wait for lenders when the caller does not (the map)", async () => {
    vi.mocked(Marine.siteMarineHours).mockResolvedValue({ ok: true, hours: series(0, 0), fetchedAt: Date.now(), stale: false });
    vi.mocked(Marine.fetchMarine).mockClear();
    vi.mocked(Marine.fetchMarine).mockResolvedValue({ ok: false, unavailable: true, pending: true });
    await loadSite(site, [site, catalogMate], atoll, [], { wait: false });
    const calls = vi.mocked(Marine.fetchMarine).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(([, , options]) => options?.wait === false)).toBe(true);
  });

  it("shares nothing when the site's own hours came from the atoll's ocean point", async () => {
    const borrowed = await throughflowWith(
      [site, catalogMate],
      { ok: true, hours: series(0.3, 220), fetchedAt: Date.now(), stale: false },
      true,
    );
    expect(borrowed).toBe(0);
  });

  it("cuts on the distance between sample points, at 8 km, not between pins", () => {
    // The site's sample point is 3 km out to the north-east (inward 220°). A mate facing north samples 3 km south of
    // its pin, one facing south 3 km north, so pin and sample distances differ on either side of the cut.
    const pinsFar = corner("pins-far", site.lat + 10 / 110.57, site.lon, { inwardBearingDeg: 0 });
    const pinsNear = corner("pins-near", site.lat + 7.5 / 110.57, site.lon, { inwardBearingDeg: 180 });
    const sampleOf = (mate: Site) => Marine.seawardPoint(mate.lat, mate.lon, mate.inwardBearingDeg!);
    expect(distanceKm(site, pinsFar)).toBeGreaterThan(8);
    expect(distanceKm(own, sampleOf(pinsFar))).toBeLessThan(8);
    expect(distanceKm(site, pinsNear)).toBeLessThan(8);
    expect(distanceKm(own, sampleOf(pinsNear))).toBeGreaterThan(8);
    expect(driftLenders(site, [site, pinsFar], atoll, own)).toHaveLength(1);
    expect(driftLenders(site, [site, pinsNear], atoll, own)).toHaveLength(0);
  });

  it("gives a lagoon site's channel openings the same shared drift", async () => {
    // A real outline (North Malé), so the lagoon model runs; every point but the lender's has a calm sea.
    const northMale: Atoll = { ...atoll, id: "north-male", rimSourceUrl: "https://www.openstreetmap.org/way/671807044", oceanLat: 4.45451, oceanLon: 73.7604 };
    const a = { ...site, atollId: northMale.id };
    const b = { ...catalogMate, atollId: northMale.id };
    const lagoon: Site = { ...site, id: "lagoon-site", atollId: northMale.id, siteType: "lagoon", lat: 4.40, lon: 73.55, inwardBearingDeg: undefined };
    const mates = [a, b, lagoon];
    const lenderPoint = Marine.seawardPoint(b.lat, b.lon, 220);
    const isLender = (lat: number, lon: number) =>
      Math.abs(lat - lenderPoint.lat) < 1e-9 && Math.abs(lon - lenderPoint.lon) < 1e-9;
    const run = async (lenderStale: boolean) => {
      clearLagoonMemo();
      vi.mocked(Marine.siteMarineHours).mockResolvedValue({ ok: true, hours: series(0, 0), fetchedAt: Date.now(), stale: false });
      vi.mocked(Marine.fetchMarine).mockImplementation(async (lat, lon) =>
        isLender(lat, lon)
          ? { ok: true, hours: series(1.5, 220), fetchedAt: Date.now(), stale: lenderStale }
          : { ok: true, hours: series(0, 0), fetchedAt: Date.now(), stale: false },
      );
      return loadSite(lagoon, mates, northMale, []);
    };
    const shared = await run(false);
    const unshared = await run(true);
    expect(shared.forecastRoute).toBe("lagoon");
    expect(unshared.forecastRoute).toBe("lagoon");
    expect(JSON.stringify(shared.hours)).not.toBe(JSON.stringify(unshared.hours));
    clearLagoonMemo();
  });

  it("splits channel shares only among the lenders that loaded", async () => {
    const twin = corner("twin", site.lat + 0.002, site.lon); // same channel as the site, 0.2 km
    const other = corner("other", site.lat + 3 / 110.57, site.lon); // another channel, 3 km
    const twinPoint = Marine.seawardPoint(twin.lat, twin.lon, 220);
    const near = (a: { lat: number; lon: number }, lat: number, lon: number) =>
      Math.abs(a.lat - lat) < 1e-9 && Math.abs(a.lon - lon) < 1e-9;
    const throughflow = async (mates: Site[]) => {
      vi.mocked(Marine.siteMarineHours).mockResolvedValue({ ok: true, hours: series(0, 0), fetchedAt: Date.now(), stale: false });
      vi.mocked(Marine.fetchMarine).mockImplementation(async (lat, lon) =>
        near(twinPoint, lat, lon)
          ? { ok: true, hours: series(0.3, 220), fetchedAt: 1, stale: true }
          : { ok: true, hours: series(0.3, 220), fetchedAt: Date.now(), stale: false },
      );
      return (await reportTideForSite(site, mates, atoll, series(0, 0)[48].time))?.throughflowM ?? null;
    };
    // The stale twin lends nothing, and the site keeps its channel's whole weight, as if the twin were not there.
    const withStaleTwin = await throughflow([site, twin, other]);
    const withoutTwin = await throughflow([site, other]);
    expect(withStaleTwin).not.toBeNull();
    expect(withStaleTwin!).toBeCloseTo(withoutTwin!, 12);
  });
});
