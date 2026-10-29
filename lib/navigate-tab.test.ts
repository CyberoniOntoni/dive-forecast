import { describe, expect, it } from "vitest";
import { destinationList, DESTINATION_LIMIT, loadNavSite, navigateHref, readNavigate, saveNavSite } from "./navigate-tab";

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

describe("destinationList", () => {
  const sites = [
    { id: "kuda", name: "Kuda Faru", atoll: "North Male", lat: 4.4, lon: 73.6 },
    { id: "kandooma", name: "Kandooma Thila", atoll: "South Male", lat: 3.91, lon: 73.48 },
    { id: "banana", name: "Banana Reef", atoll: "North Male", lat: 4.24, lon: 73.53 },
  ];

  it("sorts by name until the boat's position is known, then nearest first", () => {
    expect(destinationList(sites, "", null).items.map((site) => site.id)).toEqual(["banana", "kandooma", "kuda"]);
    const near = destinationList(sites, "", { lat: 3.9, lon: 73.48 }).items;
    expect(near.map((site) => site.id)).toEqual(["kandooma", "banana", "kuda"]);
    expect(near[0].km).toBeLessThan(2);
  });

  it("matches every word against the name and the atoll", () => {
    expect(destinationList(sites, "north", null).items.map((site) => site.id)).toEqual(["banana", "kuda"]);
    expect(destinationList(sites, "  Male  thila ", null).items.map((site) => site.id)).toEqual(["kandooma"]);
    expect(destinationList(sites, "wreck", null).items).toEqual([]);
    // The same search as the Map list: word starts, punctuation and accents ignored.
    expect(destinationList(sites, "kuda-far", null).items.map((site) => site.id)).toEqual(["kuda"]);
    expect(destinationList(sites, "anana", null).items).toEqual([]);
  });

  it("keeps the list short", () => {
    const many = Array.from({ length: DESTINATION_LIMIT + 5 }, (_, index) => ({ ...sites[0], id: `s${index}` }));
    const list = destinationList(many, "", null);
    expect(list.items).toHaveLength(DESTINATION_LIMIT);
    expect(list.total).toBe(DESTINATION_LIMIT + 5);
  });
});
