import { describe, expect, it } from "vitest";
import { routeFor } from "./load-site";
import { pickerSites } from "./plan-picker";
import { readCatalog } from "./store";

describe("plan editor's site picker", () => {
  it("offers a wanted direction wherever the forecast reads across the rim, walls by a pass too", () => {
    const catalog = readCatalog();
    const byId = new Map(pickerSites().map((site) => [site.id, site]));
    for (const site of catalog.sites) {
      const atoll = catalog.atolls.find((item) => item.id === site.atollId);
      expect(byId.get(site.id)?.channel, site.id).toBe(routeFor(site, catalog.sites, atoll)?.route === "channel");
    }
    // An outer-reef wall within reach of a pass is read as a channel, not along the reef.
    const wall = catalog.sites.find((site) => site.id === "ihi-reef")!;
    expect(wall.siteType).toBe("outer-reef");
    expect(byId.get("ihi-reef")?.channel).toBe(true);
    expect(byId.get("kandooma-thila")?.channel).toBe(true);
    expect(byId.get("maaya-thila")?.channel).toBe(false);
  });
});
