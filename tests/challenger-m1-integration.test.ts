import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import {
  constrictionFactor,
  forecastHours,
  CONSTRICTION_MIN,
  CONSTRICTION_MAX,
} from "../lib/forecast";
import { inwardBearingDeg } from "../lib/bearing";
import { loadSite, type SiteLoad } from "../lib/load-site";
import * as Marine from "../lib/marine";
import { rimForAtoll } from "../lib/rim";
import type { Atoll, Catalog, MarineHour, Report as DiverReport, Site, Strength } from "../lib/types";

const SITES_PATH = path.join(process.cwd(), "data", "sites.json");
const catalogRaw = JSON.parse(fs.readFileSync(SITES_PATH, "utf8")) as Catalog;
const atolls = catalogRaw.atolls;
const sites = catalogRaw.sites;
const atollMap = new Map<string, Atoll>(atolls.map((a) => [a.id, a]));

/** Copies each site's committed benchmark fixture into the test cache directory, keyed by its seaward point. */
function seedCacheFromFixtures(siteIds: readonly string[]): void {
  const fixtureDir = path.join(process.cwd(), "data", "benchmark-marine-cache");
  fs.mkdirSync(Marine.marineCacheDir(), { recursive: true });
  for (const id of siteIds) {
    const site = sites.find((s) => s.id === id)!;
    const atoll = atollMap.get(site.atollId)!;
    const outside = { lat: atoll.oceanLat, lon: atoll.oceanLon };
    const bearing = inwardBearingDeg(site, sites, outside, rimForAtoll(atoll));
    const point = Marine.seawardPoint(site.lat, site.lon, bearing);
    const fixtureName = `${point.lat.toFixed(4)}_${point.lon.toFixed(4)}.json`;
    // The live cache reader strips letters from its file names, so its files have no extension.
    const cacheName = fixtureName.replace(/[^0-9.+_-]/g, "");
    const fixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, fixtureName), "utf8")) as { hours: MarineHour[] };
    fs.writeFileSync(
      path.join(Marine.marineCacheDir(), cacheName),
      JSON.stringify({ fetchedAt: Date.now(), hours: fixture.hours }),
    );
  }
}

// 72-hour semi-diurnal tidal series (Maldives 12h cycle) with timestamps relative to now
function createSyntheticMarine(amplitude = 0.28, mean = 0.5): MarineHour[] {
  const now = Date.now();
  // 36 hours in past, 36 hours in future
  return Array.from({ length: 72 }, (_, i) => {
    const timeMs = now - 36 * 3600 * 1000 + i * 3600 * 1000;
    return {
      time: new Date(timeMs + 5 * 3600 * 1000).toISOString().slice(0, 16),
      seaLevelM: mean + amplitude * Math.sin((2 * Math.PI * i) / 12),
      currentVelocityMs: 0.1,
      currentDirectionDeg: 90,
    };
  });
}

// Marine series with normal tidal range (H = 0.50m > 0.35m) and flat slack crests
function createNormalTideWithSlackCrests(): MarineHour[] {
  const now = Date.now();
  return Array.from({ length: 72 }, (_, i) => {
    const timeMs = now - 36 * 3600 * 1000 + i * 3600 * 1000;
    // 12-hour cycle with flat plateaus at peaks and troughs
    const phase = i % 12;
    let level: number;
    if (phase === 3 || phase === 4) {
      level = 0.75; // flat crest: slope between 3 and 4 is 0.0
    } else if (phase === 9 || phase === 10) {
      level = 0.25; // flat trough: slope between 9 and 10 is 0.0
    } else if (phase < 3) {
      level = 0.25 + 0.50 * (phase / 3);
    } else if (phase > 4 && phase < 9) {
      level = 0.75 - 0.50 * ((phase - 4) / 5);
    } else {
      level = 0.25 + 0.50 * ((phase - 10) / 2);
    }

    return {
      time: new Date(timeMs + 5 * 3600 * 1000).toISOString().slice(0, 16),
      seaLevelM: level,
      currentVelocityMs: 0.1,
      currentDirectionDeg: 90,
    };
  });
}

const STRENGTH_ORDER: Record<Strength, number> = {
  slack: 0,
  mild: 1,
  strong: 2,
  too_strong: 3,
};

describe("Milestone 1 Adversarial Integration Challenge", () => {
  const syntheticHours = createSyntheticMarine(0.28, 0.5);

  describe("1. Catalog Schema & Physical Pass Dimensions Integrity", () => {
    it("all sites have valid atoll references and geographic coordinates", () => {
      expect(sites.length).toBeGreaterThanOrEqual(20);
      for (const site of sites) {
        expect(atollMap.has(site.atollId)).toBe(true);
        expect(site.lat).toBeGreaterThan(0);
        expect(site.lat).toBeLessThan(10);
        expect(site.lon).toBeGreaterThan(70);
        expect(site.lon).toBeLessThan(75);
      }
    });

    it("verifies physical dimensions for all 8 measured channel passes", () => {
      const passSiteIds = [
        "kandooma-thila",
        "rasdhoo-madivaru",
        "miyaru-kandu",
        "fotteyo-kandu",
        "kuredu-express",
        "embudhoo-express",
        "devana-kandu",
        "vaadhoo-caves",
      ];

      for (const id of passSiteIds) {
        const site = sites.find((s) => s.id === id);
        expect(site, `Site ${id} should exist`).toBeDefined();
        expect(site?.channelWidthM, `Site ${id} channelWidthM should be positive`).toBeGreaterThan(0);
        expect(site?.channelDepthM, `Site ${id} channelDepthM should be positive`).toBeGreaterThan(0);

        const c = constrictionFactor(site?.channelWidthM, site?.channelDepthM);
        expect(c).toBeGreaterThanOrEqual(CONSTRICTION_MIN);
        expect(c).toBeLessThanOrEqual(CONSTRICTION_MAX);
      }
    });

    it("Vaadhoo Caves reference pass evaluates to exact 1.000 unconstricted baseline factor", () => {
      const vaadhoo = sites.find((s) => s.id === "vaadhoo-caves");
      expect(vaadhoo).toBeDefined();
      expect(vaadhoo?.channelWidthM).toBe(5000);
      expect(vaadhoo?.channelDepthM).toBe(400);
      // Area = 5000 * 400 = 2,000,000 m2 = REF_CHANNEL_AREA_M2
      const c = constrictionFactor(vaadhoo?.channelWidthM, vaadhoo?.channelDepthM);
      expect(c).toBe(1.0);
    });
  });

  describe("2. loadSite Execution Across Entire Catalog", () => {
    it("runs loadSite on EVERY site in catalog and produces valid SiteLoad", async () => {
      // Mock Marine fetch to return synthetic marine series
      const spy = vi.spyOn(Marine, "siteMarineHours").mockResolvedValue({
        ok: true,
        hours: syntheticHours,
        fetchedAt: Date.now(),
        stale: false,
      });

      for (const site of sites) {
        const atoll = atollMap.get(site.atollId);
        const result: SiteLoad = await loadSite(site, sites, atoll, []);

        expect(result.unavailable).toBe(false);
        expect(result.stale).toBe(false);
        expect(result.bearing).toBeTypeOf("number");
        expect(result.bearing!).toBeGreaterThanOrEqual(0);
        expect(result.bearing!).toBeLessThan(360);
        expect(result.hours.length).toBeGreaterThan(0);

        // Every hour must have complete, valid fields
        for (const h of result.hours) {
          expect(h.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
          expect(["incoming", "outgoing"]).toContain(h.direction);
          expect(["slack", "mild", "strong", "too_strong"]).toContain(h.strength);
          expect(["low", "medium", "high"]).toContain(h.confidence);
          expect(Number.isFinite(h.levelM)).toBe(true);
        }
      }

      spy.mockRestore();
    });

    it("gracefully returns unavailable when atoll is missing or marine fetch fails", async () => {
      const site = sites[0];
      const unavailMissingAtoll = await loadSite(site, sites, undefined, []);
      expect(unavailMissingAtoll.unavailable).toBe(true);
      expect(unavailMissingAtoll.bearing).toBeNull();
      expect(unavailMissingAtoll.hours).toHaveLength(0);

      const spy = vi.spyOn(Marine, "siteMarineHours").mockResolvedValue({
        ok: false,
        unavailable: true,
      });
      const atoll = atollMap.get(site.atollId);
      const unavailFailedFetch = await loadSite(site, sites, atoll, []);
      expect(unavailFailedFetch.unavailable).toBe(true);
      expect(unavailFailedFetch.hours).toHaveLength(0);
      spy.mockRestore();
    });
  });

  describe("3. Constricted Pass vs Open Lagoon Sites Under Identical Marine Conditions", () => {
    it("amplifies current strength in constricted passes (Devana Kandu, Miyaru Kandu) over open sites during peak tidal flow", async () => {
      const devana = sites.find((s) => s.id === "devana-kandu")!;
      const miyaru = sites.find((s) => s.id === "miyaru-kandu")!;
      const openLagoon = sites.find((s) => s.id === "alimatha-house-reef")!;

      expect(devana).toBeDefined();
      expect(miyaru).toBeDefined();
      expect(openLagoon).toBeDefined();
      expect(devana.atollId).toBe(openLagoon.atollId); // Both in Vaavu Atoll!
      expect(miyaru.atollId).toBe(openLagoon.atollId); // All in Vaavu Atoll!

      const atoll = atollMap.get(devana.atollId)!;

      const spy = vi.spyOn(Marine, "siteMarineHours").mockResolvedValue({
        ok: true,
        hours: syntheticHours,
        fetchedAt: Date.now(),
        stale: false,
      });

      const devanaLoad = await loadSite(devana, sites, atoll, []);
      const miyaruLoad = await loadSite(miyaru, sites, atoll, []);
      const openLoad = await loadSite(openLagoon, sites, atoll, []);

      spy.mockRestore();

      // Find hours of peak tidal flow (where slope is maximal)
      // For synthetic semi-diurnal, peak rising slope occurs at index 3, 15, 27...
      const peakTime = devanaLoad.hours[15].time;

      const peakDevana = devanaLoad.hours.find((h) => h.time === peakTime)!;
      const peakMiyaru = miyaruLoad.hours.find((h) => h.time === peakTime)!;
      const peakOpen = openLoad.hours.find((h) => h.time === peakTime)!;

      // Open lagoon peak flow is 'mild'
      expect(peakOpen.strength).toBe("mild");

      // Constricted passes are amplified to 'strong' or 'too_strong'
      expect(["strong", "too_strong"]).toContain(peakDevana.strength);
      expect(["strong", "too_strong"]).toContain(peakMiyaru.strength);

      // Numeric band index check
      expect(STRENGTH_ORDER[peakDevana.strength]).toBeGreaterThan(STRENGTH_ORDER[peakOpen.strength]);
      expect(STRENGTH_ORDER[peakMiyaru.strength]).toBeGreaterThan(STRENGTH_ORDER[peakOpen.strength]);
    });

    it("strictly preserves slack hours at tidal crests between constricted pass and open lagoon", async () => {
      const devana = sites.find((s) => s.id === "devana-kandu")!;
      const openLagoon = sites.find((s) => s.id === "alimatha-house-reef")!;
      const atoll = atollMap.get(devana.atollId)!;

      const slackMarine = createNormalTideWithSlackCrests();
      const spy = vi.spyOn(Marine, "siteMarineHours").mockResolvedValue({
        ok: true,
        hours: slackMarine,
        fetchedAt: Date.now(),
        stale: false,
      });

      const devanaLoad = await loadSite(devana, sites, atoll, []);
      const openLoad = await loadSite(openLagoon, sites, atoll, []);
      spy.mockRestore();

      // Slack hours in open lagoon must be slack hours in constricted pass
      const openSlackTimes = openLoad.hours.filter((h) => h.strength === "slack").map((h) => h.time);
      const devanaSlackTimes = devanaLoad.hours.filter((h) => h.strength === "slack").map((h) => h.time);

      expect(openSlackTimes.length).toBeGreaterThan(0);
      expect(devanaSlackTimes).toEqual(openSlackTimes);
    });

    it("monotonicity check: constricted pass strength is greater than or equal to open site at EVERY hour", async () => {
      const devana = sites.find((s) => s.id === "devana-kandu")!;
      const openLagoon = sites.find((s) => s.id === "alimatha-house-reef")!;
      const atoll = atollMap.get(devana.atollId)!;

      const spy = vi.spyOn(Marine, "siteMarineHours").mockResolvedValue({
        ok: true,
        hours: syntheticHours,
        fetchedAt: Date.now(),
        stale: false,
      });

      const devanaLoad = await loadSite(devana, sites, atoll, []);
      const openLoad = await loadSite(openLagoon, sites, atoll, []);
      spy.mockRestore();

      expect(devanaLoad.hours.length).toBe(openLoad.hours.length);
      for (let i = 0; i < devanaLoad.hours.length; i++) {
        const dHour = devanaLoad.hours[i];
        const oHour = openLoad.hours[i];
        expect(dHour.time).toBe(oHour.time);
        expect(STRENGTH_ORDER[dHour.strength]).toBeGreaterThanOrEqual(STRENGTH_ORDER[oHour.strength]);
      }
    });

    it("directional invariance: constricted pass has identical tidal direction as open site", async () => {
      const devana = sites.find((s) => s.id === "devana-kandu")!;
      const openLagoon = sites.find((s) => s.id === "alimatha-house-reef")!;
      const atoll = atollMap.get(devana.atollId)!;

      const spy = vi.spyOn(Marine, "siteMarineHours").mockResolvedValue({
        ok: true,
        hours: syntheticHours,
        fetchedAt: Date.now(),
        stale: false,
      });

      const devanaLoad = await loadSite(devana, sites, atoll, []);
      const openLoad = await loadSite(openLagoon, sites, atoll, []);
      spy.mockRestore();

      for (let i = 0; i < devanaLoad.hours.length; i++) {
        expect(devanaLoad.hours[i].direction).toBe(openLoad.hours[i].direction);
      }
    });
  });

  describe("4. Exact Baseline Forecasts for Non-Pass Thilas / Sites Without Channel Dimensions", () => {
    it("all unconstricted sites produce exact identical forecasts as explicit baseline (constriction = 1.0)", async () => {
      const unconstrictedSites = sites.filter((s) => s.channelWidthM === undefined && s.channelDepthM === undefined);
      expect(unconstrictedSites.length).toBeGreaterThanOrEqual(10);

      const spy = vi.spyOn(Marine, "siteMarineHours").mockResolvedValue({
        ok: true,
        hours: syntheticHours,
        fetchedAt: 100000,
        stale: false,
      });

      for (const site of unconstrictedSites) {
        const atoll = atollMap.get(site.atollId)!;
        const result = await loadSite(site, sites, atoll, []);

        // Independent forecast computed directly with constriction = 1.0
        const directBaseline = forecastHours({
          hours: syntheticHours,
          inwardBearingDeg: result.bearing!,
          reports: [],
          channelWidthM: undefined,
          channelDepthM: undefined,
        });

        expect(result.hours).toEqual(directBaseline);
      }

      spy.mockRestore();
    });

    it("Vaadhoo Caves with 5000m x 400m produces exact identical forecast as unconstricted site", async () => {
      const vaadhoo = sites.find((s) => s.id === "vaadhoo-caves")!;
      const atoll = atollMap.get(vaadhoo.atollId)!;

      const spy = vi.spyOn(Marine, "siteMarineHours").mockResolvedValue({
        ok: true,
        hours: syntheticHours,
        fetchedAt: 100000,
        stale: false,
      });

      const vaadhooLoad = await loadSite(vaadhoo, sites, atoll, []);

      // Synthetic identical site with no channel dimensions
      const vaadhooUnconstricted: Site = {
        ...vaadhoo,
        id: "vaadhoo-unconstricted",
        channelWidthM: undefined,
        channelDepthM: undefined,
      };

      const unconstrictedLoad = await loadSite(vaadhooUnconstricted, sites, atoll, []);
      spy.mockRestore();

      expect(vaadhooLoad.hours).toEqual(unconstrictedLoad.hours);
    });
  });

  describe("5. Adversarial Input Stress & Malformed Dimension Robustness", () => {
    it("falls back to baseline when dimensions are zero, negative, NaN, Infinity, or partially missing", async () => {
      const siteBase = sites.find((s) => s.id === "banana-reef")!;
      const atoll = atollMap.get(siteBase.atollId)!;

      const spy = vi.spyOn(Marine, "siteMarineHours").mockResolvedValue({
        ok: true,
        hours: syntheticHours,
        fetchedAt: 100000,
        stale: false,
      });

      const baselineLoad = await loadSite(siteBase, sites, atoll, []);

      const malformedCases: Partial<Site>[] = [
        { channelWidthM: 0, channelDepthM: 40 },
        { channelWidthM: -500, channelDepthM: 40 },
        { channelWidthM: 500, channelDepthM: 0 },
        { channelWidthM: 500, channelDepthM: -40 },
        { channelWidthM: Number.NaN, channelDepthM: 40 },
        { channelWidthM: 500, channelDepthM: Number.NaN },
        { channelWidthM: Number.POSITIVE_INFINITY, channelDepthM: 40 },
        { channelWidthM: 500, channelDepthM: Number.POSITIVE_INFINITY },
        { channelWidthM: 500, channelDepthM: undefined },
        { channelWidthM: undefined, channelDepthM: 40 },
      ];

      for (const malformed of malformedCases) {
        const testSite: Site = { ...siteBase, ...malformed };
        const testLoad = await loadSite(testSite, sites, atoll, []);
        expect(testLoad.hours).toEqual(baselineLoad.hours);
      }

      spy.mockRestore();
    });

    it("micro-tide (tidal range < 0.35m) produces slack everywhere across both open and constricted sites", async () => {
      const now = Date.now();
      const microTideHours: MarineHour[] = Array.from({ length: 72 }, (_, i) => ({
        time: new Date(now - 36 * 3600 * 1000 + i * 3600 * 1000 + 5 * 3600 * 1000).toISOString().slice(0, 16),
        seaLevelM: 0.5 + 0.05 * Math.sin((2 * Math.PI * i) / 12), // tidal range = 0.10m < 0.35m
        currentVelocityMs: 0,
        currentDirectionDeg: 0,
      }));

      const devana = sites.find((s) => s.id === "devana-kandu")!;
      const banana = sites.find((s) => s.id === "banana-reef")!;
      const atoll = atollMap.get(devana.atollId)!;

      const spy = vi.spyOn(Marine, "siteMarineHours").mockResolvedValue({
        ok: true,
        hours: microTideHours,
        fetchedAt: Date.now(),
        stale: false,
      });

      const devanaLoad = await loadSite(devana, sites, atoll, []);
      const bananaLoad = await loadSite(banana, sites, atoll, []);
      spy.mockRestore();

      expect(devanaLoad.hours.length).toBeGreaterThan(0);
      expect(bananaLoad.hours.length).toBeGreaterThan(0);

      expect(devanaLoad.hours.every((h) => h.strength === "slack")).toBe(true);
      expect(bananaLoad.hours.every((h) => h.strength === "slack")).toBe(true);
    });

    it("dead-flat line with zero slopes across entire series returns empty hours cleanly without crashing", async () => {
      const now = Date.now();
      const deadFlatHours: MarineHour[] = Array.from({ length: 72 }, (_, i) => ({
        time: new Date(now - 36 * 3600 * 1000 + i * 3600 * 1000 + 5 * 3600 * 1000).toISOString().slice(0, 16),
        seaLevelM: 0.5, // zero slope everywhere
        currentVelocityMs: 0,
        currentDirectionDeg: 0,
      }));

      const devana = sites.find((s) => s.id === "devana-kandu")!;
      const atoll = atollMap.get(devana.atollId)!;

      const spy = vi.spyOn(Marine, "siteMarineHours").mockResolvedValue({
        ok: true,
        hours: deadFlatHours,
        fetchedAt: Date.now(),
        stale: false,
      });

      const devanaLoad = await loadSite(devana, sites, atoll, []);
      spy.mockRestore();

      // Because C8 requires a next signed lagged slope to determine tide direction,
      // a totally flat series has no direction and cleanly yields 0 hours without crashing.
      expect(devanaLoad.unavailable).toBe(false);
      expect(devanaLoad.hours).toHaveLength(0);
    });
  });

  describe("6. On-Disk Marine Cache Replay", () => {
    it("successfully loads cached marine series for sites with matching cache entries", async () => {
      // The committed benchmark fixtures stand in for a real cache, so this needs no network and no live cache.
      const candidates = ["kandooma-thila", "banana-reef", "rasdhoo-madivaru", "miyaru-kandu"];
      seedCacheFromFixtures(candidates);

      for (const id of candidates) {
        const site = sites.find((s) => s.id === id)!;
        const atoll = atollMap.get(site.atollId)!;

        // Call real loadSite without mocking Marine
        const result = await loadSite(site, sites, atoll, []);

        // Should load from cache
        expect(result.bearing).toBeTypeOf("number");
        expect(result.hours.length).toBeGreaterThan(0);
        expect(result.unavailable).toBe(false);

        // Check that hours contain valid forecast data
        const sampleHour = result.hours[0];
        expect(sampleHour).toBeDefined();
        expect(sampleHour.time).toBeDefined();
        expect(sampleHour.direction).toBeDefined();
        expect(sampleHour.strength).toBeDefined();
      }
    });
  });

  describe("7. Replay Backtesting Gate Integration", () => {
    it("respects replay.json ok flag: prevents high confidence when replay ok is false", async () => {
      const site = sites.find((s) => s.id === "devana-kandu")!;
      const atoll = atollMap.get(site.atollId)!;

      const spy = vi.spyOn(Marine, "siteMarineHours").mockResolvedValue({
        ok: true,
        hours: syntheticHours,
        fetchedAt: Date.now(),
        stale: false,
      });

      // Synthetic reports that would normally qualify for high confidence:
      // 4 agreeing reports with identical direction and strength
      const concordantReports: DiverReport[] = Array.from({ length: 4 }, (_, i) => ({
        id: `r-${i}`,
        siteId: site.id,
        time: syntheticHours[15].time,
        direction: "incoming",
        strength: "strong",
      }));

      // Case A: normal replay.json (ok: true)
      const normalLoad = await loadSite(site, sites, atoll, concordantReports);
      expect(normalLoad.hours.length).toBeGreaterThan(0);

      // Case B: mock fs.readFileSync for data/replay.json returning ok: false
      const originalReadFileSync = fs.readFileSync;
      const fsSpy = vi.spyOn(fs, "readFileSync").mockImplementation((...args: Parameters<typeof originalReadFileSync>) => {
        const filePath = args[0];
        if (typeof filePath === "string" && filePath.includes("replay.json")) {
          return JSON.stringify({ ok: false, failures: 10, strengthMismatches: 5 });
        }
        return originalReadFileSync(...args);
      });

      const blockedLoad = await loadSite(site, sites, atoll, concordantReports);
      expect(blockedLoad.hours.length).toBeGreaterThan(0);

      // Gating check: when replay.json has ok: false, NO hour can have 'high' confidence
      for (const h of blockedLoad.hours) {
        expect(h.confidence).not.toBe("high");
      }

      fsSpy.mockRestore();
      spy.mockRestore();
    });
  });
});
