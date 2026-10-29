import { describe, expect, it } from "vitest";
import { inView, siteCountLabel, SPOTLIGHT_ZOOM, spotlightZoom } from "./map-view";

const vaavu = { south: 3.3, west: 73.3, north: 3.8, east: 73.8 };

describe("inView", () => {
  it("keeps sites inside the view, edges included, and leaves the rest out", () => {
    expect(inView(3.58, 73.5, vaavu)).toBe(true);
    expect(inView(3.3, 73.8, vaavu)).toBe(true);
    expect(inView(4.17, 73.5, vaavu)).toBe(false);
    expect(inView(3.58, 72.9, vaavu)).toBe(false);
  });
});

describe("siteCountLabel", () => {
  it("counts all sites until the view leaves some out", () => {
    expect(siteCountLabel(38, 38)).toBe("38 sites");
    expect(siteCountLabel(1, 1)).toBe("1 site");
    expect(siteCountLabel(7, 38)).toBe("7 of 38 sites in view");
    expect(siteCountLabel(0, 38)).toBe("0 of 38 sites in view");
  });
});

describe("spotlightZoom", () => {
  it("zooms in to show one site, but never out", () => {
    expect(spotlightZoom(7)).toBe(SPOTLIGHT_ZOOM);
    expect(spotlightZoom(SPOTLIGHT_ZOOM)).toBe(SPOTLIGHT_ZOOM);
    expect(spotlightZoom(15)).toBe(15);
    expect(spotlightZoom(Number.NaN)).toBe(SPOTLIGHT_ZOOM);
  });
});
