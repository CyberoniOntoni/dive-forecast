import { describe, expect, it } from "vitest";
import { loadNavSite, navigateHref, readNavigate, saveNavSite } from "./navigate-tab";

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
