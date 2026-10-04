import { describe, expect, it } from "vitest";
import { resolveBearing } from "./bearing";
import { nowcastGlance } from "./nowcast-glance";
import { rimInwardBearing, type RimRing } from "./rim";
import { alongReefHeading, crossesRim, deriveSiteType, flowsAlongReef, siteRoute, straitHeading } from "./site-type";
import { readCatalog } from "./store";
import type { Site, SiteType } from "./types";

/** The owner's classification of North Malé, South Malé, Baa, South Ari and Faafu sites (3 Oct 2026). */
const OWNER: Record<string, SiteType> = {
  "prisca-corner": "corner",
  "prisca-head": "corner",
  "meeru-corner": "corner",
  "kani-corner": "corner",
  "kufunadhoo-corner": "corner",
  "kudadhoo-corner": "corner",
  "maaddoo-corner": "corner",
  balcony: "corner",
  "rannalhi-faru": "corner",
  "ramm-faru": "corner",
  "furana-south": "corner",
  "furana-north": "corner",
  "cave-corner": "pass",
  "maldive-victory": "pass",
  "lankan-caves": "pass",
  "middle-point": "pass",
  "coral-garden-3": "pass",
  "vaadhoo-housereef": "pass",
  "vaagili-caves": "pass",
  "ran-faru": "pass",
  "lhohi-paradise": "pass",
  sundune: "pass",
  "kandooma-caves": "pass",
  "seven-stingrays": "pass",
  "maaddoo-giri": "channel-thila",
  "embudhu-thila": "channel-thila",
  "embudhoo-canyon": "strait-wall",
  cathedral: "strait-wall",
  "velassaru-caves": "strait-wall",
};

describe("the owner's site classification", () => {
  const catalog = readCatalog();
  const byId = new Map(catalog.sites.map((site) => [site.id, site]));

  it("is in the catalog, set by hand", () => {
    for (const [id, type] of Object.entries(OWNER)) {
      const site = byId.get(id);
      expect(site, id).toBeDefined();
      expect(site?.siteType, id).toBe(type);
      expect(site?.siteTypeSource, id).toBe("manual");
    }
  });

  it("keeps the confirmed lagoon sites and the outer wall", () => {
    expect(byId.get("kings-corner")?.siteType).toBe("lagoon");
    expect(byId.get("kudadhoo-etheru-faru")?.siteType).toBe("lagoon");
    expect(byId.get("kudadhoo-beyru")?.siteType).toBe("outer-reef");
  });

  it("stores every Corner as a channel corner, except the owner's channel and lagoon ones", () => {
    // The type alone decides the model, so the data must say what the name used to imply.
    const exceptions: Record<string, SiteType> = { "cave-corner": "pass", "kings-corner": "lagoon" };
    for (const site of catalog.sites.filter((item) => /\bcorner\b/i.test(item.name))) {
      expect(site.siteType, site.id).toBe(exceptions[site.id] ?? "corner");
    }
  });

  it("spells Embudhoo Thila the owner's way, keeping its id", () => {
    expect(byId.get("embudhu-thila")?.name).toBe("Embudhoo Thila");
  });

  it("gives every channel, corner and thila the channel model", () => {
    for (const [id, type] of Object.entries(OWNER)) {
      if (type === "strait-wall") continue;
      const site = byId.get(id)!;
      expect(crossesRim(site, catalog.sites), id).toBe(true);
      expect(flowsAlongReef(site, catalog.sites), id).toBe(false);
    }
  });

  it("points HP Reef in toward 10 o'clock and out toward 5", () => {
    const hp = byId.get("hp-reef")!;
    expect(hp.inwardBearingDeg).toBe(300);
    expect(hp.outgoingBearingDeg).toBe(150);
  });
});

describe("channel corner type", () => {
  const ring: RimRing = [
    [3.9, 73.4],
    [3.9, 73.6],
    [4.1, 73.6],
    [4.1, 73.4],
    [3.9, 73.4],
  ];

  it("is derived for a Corner on the rim", () => {
    expect(deriveSiteType({ name: "Kani Corner", lat: 4.0, lon: 73.598 }, ring)).toBe("corner");
    expect(deriveSiteType({ name: "Long Wall", lat: 4.0, lon: 73.598 }, ring)).toBe("outer-reef");
  });

  it("counts as a channel", () => {
    const site: Site = { id: "c", name: "Ramm Faru", atollId: "a", lat: 4, lon: 73.598, sourceUrl: "x", siteType: "corner" };
    expect(crossesRim(site)).toBe(true);
    expect(flowsAlongReef(site)).toBe(false);
  });
});

describe("rim bearing for a channel the outline puts inside the lagoon", () => {
  const ring: RimRing = [
    [3.9, 73.4],
    [3.9, 73.6],
    [4.1, 73.6],
    [4.1, 73.4],
    [3.9, 73.4],
  ];
  // About 1.5 km inside the east rim.
  const pin = { lat: 4.0, lon: 73.5865 };

  it("reaches farther than 0.8 km only when asked", () => {
    expect(rimInwardBearing(pin, ring)).toBeNull();
    expect(rimInwardBearing(pin, ring, 3)).toBeCloseTo(270, 0);
  });

  it("takes the rim's normal for a hand-set channel, but not for a derived lagoon site", () => {
    const base: Site = { id: "p", name: "Somewhere", atollId: "a", lat: pin.lat, lon: pin.lon, sourceUrl: "x" };
    const outside = { lat: 4.0, lon: 74.0 };
    const channel = resolveBearing({ ...base, siteType: "pass", siteTypeSource: "manual" }, [], outside, ring);
    expect(channel.source).toBe("rim-derived");
    expect(channel.deg).toBeCloseTo(270, 0);
    const lagoon = resolveBearing({ ...base, siteType: "lagoon", siteTypeSource: "derived" }, [], outside, ring);
    expect(lagoon.source).toBe("fallback");
  });
});

describe("a curved channel's outgoing arrow", () => {
  const glance = (direction: "incoming" | "outgoing") =>
    nowcastGlance(
      "HP Reef",
      {
        siteId: "hp-reef",
        atollId: "north-male",
        inwardBearingDeg: 300,
        outgoingBearingDeg: 150,
        forecastRoute: "channel",
        unavailable: false,
        hour: { time: "2026-10-03T10:00", direction, strength: "strong", confidence: "low", levelM: 0.1 },
      },
      true,
    );

  it("points out along the channel's own outgoing heading, and in along the inward bearing", () => {
    expect(glance("incoming").arrowBearing).toBe(300);
    expect(glance("outgoing").arrowBearing).toBe(150);
  });
});

describe("siteRoute", () => {
  const catalog = readCatalog();

  it("picks one model per catalog site, as the type and the reef say", () => {
    for (const site of catalog.sites) {
      const { route, axisDeg } = siteRoute(site, catalog.sites, 100);
      if (site.siteType === "strait-wall") {
        expect({ route, axisDeg }, site.id).toEqual({ route: "strait", axisDeg: straitHeading(100) });
      } else if (site.siteType === "lagoon") {
        expect({ route, axisDeg }, site.id).toEqual({ route: "lagoon", axisDeg: null });
      } else if (flowsAlongReef(site, catalog.sites)) {
        expect({ route, axisDeg }, site.id).toEqual({ route: "along-reef", axisDeg: alongReefHeading(100) });
      } else {
        expect({ route, axisDeg }, site.id).toEqual({ route: "channel", axisDeg: null });
      }
    }
  });

  it("keeps the route but no axis without a bearing", () => {
    const strait = catalog.sites.find((site) => site.siteType === "strait-wall")!;
    expect(siteRoute(strait, catalog.sites, null)).toEqual({ route: "strait", axisDeg: null });
  });
});
