import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { constrictionFactor, sectionInput } from "./forecast";
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

  it("gives every measured channel a positive width, a depth kind and an http source", () => {
    for (const site of catalog.sites) {
      if (site.channelDepthM == null) continue;
      expect(site.channelWidthM).toBeGreaterThan(0);
      expect(site.channelDepthKind).toBeDefined();
      expect(site.channelSourceUrl).toMatch(/^https?:\/\//);
    }
  });

  it("sizes a channel only from a mean or typical depth", () => {
    const maximum = { channelWidthM: 500, channelDepthM: 25, channelDepthKind: "max" as const };
    expect(sectionInput(maximum)).toEqual({});
    expect(sectionInput({ ...maximum, channelDepthKind: undefined })).toEqual({});
    expect(sectionInput({ ...maximum, channelDepthKind: "typical" })).toEqual({ channelWidthM: 500, channelDepthM: 25 });
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

  it("keeps each channel record once, with a size, a depth kind for any depth and an http source", () => {
    const records = catalog.channels ?? [];
    expect(new Set(records.map((record) => record.id)).size).toBe(records.length);
    for (const record of records) {
      expect(record.widthM ?? record.depthM).toBeGreaterThan(0);
      if (record.depthM != null) expect(record.depthKind).toBeDefined();
      expect(record.sourceUrl).toMatch(/^https?:\/\//);
    }
  });

  it("points every channel lead at a record that fits its basis", () => {
    const byId = new Map((catalog.channels ?? []).map((record) => [record.id, record]));
    for (const site of catalog.sites) {
      for (const lead of site.channelLeads ?? []) {
        const record = byId.get(lead.channel);
        expect(record, `${site.id} -> ${lead.channel}`).toBeDefined();
        if (lead.basis === "depth-only") expect(record?.widthM).toBeUndefined();
        if (lead.basis === "conflict") expect(site.channelWidthM).toBeDefined();
      }
    }
  });

  it("leaves an unsized channel unconstricted", () => {
    expect(constrictionFactor(undefined, undefined)).toBe(1);
  });
});
