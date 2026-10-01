import { inView, type MapView } from "./map-view";
import type { Site } from "./types";

/** What the list is narrowed to: a search across every site, an atoll, or neither (the sites in view). */
export type ListFilter = { query: string; atollId: string };

export const NO_FILTER: ListFilter = { query: "", atollId: "" };

/** Lower case, accents dropped, and anything but letters and digits as single spaces: "Fesdu Wreck" ≈ "fesdu-wreck". */
export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Every word of the query starts a word in the site's name or its atoll's name, in any order. */
export function matchesSearch(site: Pick<Site, "name">, atollName: string | undefined, query: string): boolean {
  const words = normalizeForSearch(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const haystack = ` ${normalizeForSearch(site.name)} ${normalizeForSearch(atollName ?? "")} `;
  return words.every((word) => haystack.includes(` ${word}`));
}

/**
 * The sites the list shows. A search or an atoll looks past the map's edges: a search runs over every site (within
 * the atoll when one is chosen), an atoll lists all of its sites. With neither, the list is the sites in view, as
 * before; with no view yet, every site.
 */
export function filterListSites<T extends { site: Site }>(
  items: readonly T[],
  filter: ListFilter,
  view: MapView | null,
  atollNames: Readonly<Record<string, string>>,
): T[] {
  const query = filter.query.trim();
  if (!query && !filter.atollId) {
    return view ? items.filter(({ site }) => inView(site.lat, site.lon, view)) : [...items];
  }
  return items.filter(
    ({ site }) =>
      (!filter.atollId || site.atollId === filter.atollId) && matchesSearch(site, atollNames[site.atollId], query),
  );
}

/** The atolls that have sites, by name, for the filter's choices. */
export function atollChoices(
  sites: readonly Pick<Site, "atollId">[],
  atollNames: Readonly<Record<string, string>>,
): { id: string; name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const site of sites) counts.set(site.atollId, (counts.get(site.atollId) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([id]) => atollNames[id])
    .map(([id, count]) => ({ id, name: atollNames[id], count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The list's heading count: "3 matches", "12 sites in North Malé", or the in-view count as before. */
export function filterCountLabel(shown: number, filter: ListFilter, atollName: string | undefined): string | null {
  if (filter.query.trim()) return shown === 1 ? "1 match" : `${shown} matches`;
  if (filter.atollId) return `${shown} ${shown === 1 ? "site" : "sites"} in ${atollName ?? "this atoll"}`;
  return null;
}

const FILTER_KEY = "dive-current:list-filter";

type SessionLike = Pick<Storage, "getItem" | "setItem">;

function tabStorage(): SessionLike | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

/** The tab's saved filter as stored text ("" when none), so it can be compared cheaply between renders. */
export function loadListFilterText(storage: SessionLike | undefined = tabStorage()): string {
  try {
    return storage?.getItem(FILTER_KEY) ?? "";
  } catch {
    return "";
  }
}

export function parseListFilter(text: string): ListFilter {
  try {
    const value = JSON.parse(text) as Partial<ListFilter>;
    return {
      query: typeof value.query === "string" ? value.query.slice(0, 80) : "",
      atollId: typeof value.atollId === "string" ? value.atollId : "",
    };
  } catch {
    return NO_FILTER;
  }
}

export function saveListFilter(filter: ListFilter, storage: SessionLike | undefined = tabStorage()): void {
  try {
    storage?.setItem(FILTER_KEY, JSON.stringify(filter));
  } catch {
    // Blocked storage: the filter lasts for this page only.
  }
}
