import { describe, expect, it } from "vitest";
import { inView, loadNavSite, navigateHref, readNavigate, saveNavSite, siteCountLabel, SPOTLIGHT_ZOOM, spotlightZoom } from "./map-view";

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

describe("navigate tab", () => {
  it("heads for a site, or opens the destination list", () => {
    expect(navigateHref("kandooma-thila")).toBe("/?navigate=kandooma-thila");
    expect(navigateHref("a b&c")).toBe("/?navigate=a%20b%26c");
    expect(navigateHref(null)).toBe("/?navigate");
  });

  it("reads its own address back", () => {
    const read = (href: string) => readNavigate(new URL(href, "https://x").searchParams);
    expect(read("/")).toEqual({ navigating: false, siteId: null });
    expect(read(navigateHref(null))).toEqual({ navigating: true, siteId: null });
    expect(read(navigateHref("a b&c"))).toEqual({ navigating: true, siteId: "a b&c" });
  });

  it("keeps the last destination for the tab, and clears it", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    };
    expect(loadNavSite(storage)).toBeNull();
    saveNavSite("kuda-faru", storage);
    expect(loadNavSite(storage)).toBe("kuda-faru");
    saveNavSite(null, storage);
    expect(loadNavSite(storage)).toBeNull();
    expect(values.size).toBe(0);
  });

  it("treats blocked storage as no destination", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => saveNavSite("kuda-faru", blocked)).not.toThrow();
    expect(() => saveNavSite(null, blocked)).not.toThrow();
    expect(loadNavSite(blocked)).toBeNull();
  });
});
