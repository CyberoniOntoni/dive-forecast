import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { constrictionFactor } from "./forecast";
import type { Catalog } from "./types";

const catalog = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "sites.json"), "utf8")) as Catalog;

describe("catalog depths", () => {
  it("keeps every lagoon mean between 10 and 120 m with an http source", () => {
    for (const atoll of catalog.atolls) {
      if (atoll.lagoonMeanDepthM == null) continue;
      expect(atoll.lagoonMeanDepthM).toBeGreaterThanOrEqual(10);
      expect(atoll.lagoonMeanDepthM).toBeLessThanOrEqual(120);
      expect(atoll.lagoonDepthSourceUrl).toMatch(/^https?:\/\//);
    }
  });

  it("gives every measured channel a positive width and an http source", () => {
    for (const site of catalog.sites) {
      if (site.channelDepthM == null) continue;
      expect(site.channelWidthM).toBeGreaterThan(0);
      expect(site.channelSourceUrl).toMatch(/^https?:\/\//);
    }
  });

  it("keeps every Atlas width between 100 m and 2.5 km with a confidence", () => {
    const measured = catalog.sites.filter((site) => site.atlasWidthM != null);
    expect(measured.length).toBeGreaterThan(0);
    for (const site of measured) {
      expect(site.atlasWidthM).toBeGreaterThanOrEqual(100);
      expect(site.atlasWidthM).toBeLessThanOrEqual(2500);
      expect(["checked", "low"]).toContain(site.atlasWidthConfidence);
    }
  });

  it("leaves an unsized channel unconstricted", () => {
    expect(constrictionFactor(undefined, undefined)).toBe(1);
  });
});
