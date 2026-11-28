import { describe, expect, it } from "vitest";
import { readCatalog, withCurrentPlace } from "./store";
import type { Site } from "./types";

const catalog = readCatalog();

/** An app-added pin where a catalog site sits. */
function pinAt(siteId: string, extra: Partial<Site> = {}): Site {
  const site = catalog.sites.find((item) => item.id === siteId)!;
  return { id: "new-spot-1a2b3c4d", name: "New spot", atollId: "", lat: site.lat, lon: site.lon, sourceUrl: "user", ...extra };
}

describe("withCurrentPlace: an app-added pin's forecast type", () => {
  it("puts a pin well inside North Male's lagoon in the lagoon, even when its diver picked a channel", () => {
    // Banana Reef sits 2.1 km inside the outline.
    expect(withCurrentPlace(pinAt("banana-reef"), catalog)).toMatchObject({ siteType: "lagoon", siteTypeSource: "derived" });
    expect(withCurrentPlace(pinAt("banana-reef", { diverSiteType: "pass" }), catalog)).toMatchObject({
      siteType: "lagoon",
      siteTypeSource: "derived",
    });
  });

  it("takes a rim pin in an open reef gap for a pass, and one on unbroken rim for a wall", () => {
    expect(withCurrentPlace(pinAt("kuda-kandu-2"), catalog).siteType).toBe("pass");
    expect(withCurrentPlace(pinAt("guruwa-faru"), catalog).siteType).toBe("outer-reef");
  });

  it("takes the diver's pick on the rim band, where position cannot tell", () => {
    // Kagi Kandu: 0.19 km from the outline, and no reef gap in the outline there.
    expect(withCurrentPlace(pinAt("kagi-kandu"), catalog).siteType).toBe("outer-reef");
    expect(withCurrentPlace(pinAt("kagi-kandu", { diverSiteType: "pass" }), catalog)).toMatchObject({
      siteType: "pass",
      siteTypeSource: "diver",
    });
  });

  it("gives no type in an unseeded atoll, and leaves catalog sites as they are", () => {
    const haa = { id: "haa-1a2b3c4d", name: "Haa spot", atollId: "", lat: 6.95, lon: 72.95, sourceUrl: "user", diverSiteType: "pass" as const };
    const placed = withCurrentPlace(haa, catalog);
    expect(placed.siteType).toBeUndefined();
    expect(placed.atollId).toBe("unseeded");
    const published = catalog.sites[0];
    expect(withCurrentPlace(published, catalog)).toBe(published);
  });
});
