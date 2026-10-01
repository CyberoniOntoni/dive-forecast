import { describe, expect, it } from "vitest";
import {
  atollChoices,
  filterCountLabel,
  filterListSites,
  loadListFilterText,
  matchesSearch,
  normalizeForSearch,
  NO_FILTER,
  parseListFilter,
  saveListFilter,
} from "./site-search";
import type { Site } from "./types";

const site = (id: string, name: string, atollId: string, lat = 4, lon = 73.5): { site: Site } => ({
  site: { id, name, atollId, lat, lon, sourceUrl: "x" },
});

const items = [
  site("banana", "Banana Reef", "north-male", 4.24, 73.53),
  site("kandooma", "Kandooma Thila", "south-male", 3.9, 73.48),
  site("fish-head", "Fish Head (Mushimasmingili Thila)", "north-ari", 3.94, 72.92),
  site("maaya", "Maaya Thila", "north-ari", 4.08, 72.86),
];
const names = { "north-male": "North Malé", "south-male": "South Malé", "north-ari": "North Ari" };

describe("normalizeForSearch and matchesSearch", () => {
  it("ignores case, accents and punctuation", () => {
    expect(normalizeForSearch("North Malé")).toBe("north male");
    expect(normalizeForSearch("Fish Head (Mushimasmingili)")).toBe("fish head mushimasmingili");
  });

  it("matches words at the start of words in the name or the atoll, in any order", () => {
    expect(matchesSearch({ name: "Kandooma Thila" }, "South Malé", "kand")).toBe(true);
    expect(matchesSearch({ name: "Kandooma Thila" }, "South Malé", "thila kandooma")).toBe(true);
    expect(matchesSearch({ name: "Kandooma Thila" }, "South Malé", "south")).toBe(true);
    expect(matchesSearch({ name: "Kandooma Thila" }, "South Malé", "male")).toBe(true);
    // Not in the middle of a word.
    expect(matchesSearch({ name: "Kandooma Thila" }, "South Malé", "dooma")).toBe(false);
    expect(matchesSearch({ name: "Banana Reef" }, "North Malé", "")).toBe(true);
  });
});

describe("filterListSites", () => {
  const view = { south: 4.0, west: 73.0, north: 4.5, east: 74.0 };

  it("shows the sites in view with no search or atoll", () => {
    expect(filterListSites(items, NO_FILTER, view, names).map((item) => item.site.id)).toEqual(["banana"]);
    expect(filterListSites(items, NO_FILTER, null, names)).toHaveLength(4);
  });

  it("searches every site, not only those in view", () => {
    const found = filterListSites(items, { query: "thila", atollId: "" }, view, names).map((item) => item.site.id);
    expect(found).toEqual(["kandooma", "fish-head", "maaya"]);
  });

  it("lists every site of a chosen atoll, and searches within it", () => {
    expect(filterListSites(items, { query: "", atollId: "north-ari" }, view, names)).toHaveLength(2);
    const found = filterListSites(items, { query: "fish", atollId: "north-ari" }, view, names).map((item) => item.site.id);
    expect(found).toEqual(["fish-head"]);
  });
});

describe("atoll choices and counts", () => {
  it("lists the atolls with sites, by name, with their counts", () => {
    expect(atollChoices(items.map((item) => item.site), names)).toEqual([
      { id: "north-ari", name: "North Ari", count: 2 },
      { id: "north-male", name: "North Malé", count: 1 },
      { id: "south-male", name: "South Malé", count: 1 },
    ]);
  });

  it("says how many matched", () => {
    expect(filterCountLabel(3, { query: "thila", atollId: "" }, undefined)).toBe("3 matches");
    expect(filterCountLabel(1, { query: "fish", atollId: "" }, undefined)).toBe("1 match");
    expect(filterCountLabel(12, { query: "", atollId: "north-male" }, "North Malé")).toBe("12 sites in North Malé");
    expect(filterCountLabel(5, NO_FILTER, undefined)).toBeNull();
  });
});

describe("saved filter", () => {
  it("round-trips, and a damaged one is no filter", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) };
    saveListFilter({ query: "kand", atollId: "south-male" }, storage);
    expect(parseListFilter(loadListFilterText(storage))).toEqual({ query: "kand", atollId: "south-male" });
    expect(parseListFilter("{nope")).toEqual(NO_FILTER);
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadListFilterText(blocked)).toBe("");
    expect(() => saveListFilter(NO_FILTER, blocked)).not.toThrow();
  });
});
