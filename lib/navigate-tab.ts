/** The Navigate tab: its address on the map page, the destination it keeps per browser tab, and the list to pick from. */

import { distanceKm, type LatLon } from "./geometry";
import { tabStorage } from "./map-view";
import { matchesSearch } from "./site-search";

const NAV_KEY = "dive-current:nav-site";
/** Sent on the window when the saved destination changes, so the header's Navigate tab follows it. */
export const NAV_SITE_EVENT = "dive-current:nav-site";

/** The saved destination is removed when cleared, not stored empty. */
type NavStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The Navigate tab's address: headed for a site, or the destination list when there is none. */
export function navigateHref(siteId: string | null): string {
  return siteId ? `/?navigate=${encodeURIComponent(siteId)}` : "/?navigate";
}

/** The Navigate tab's state in the address: on the tab or not, and the site it heads for (null on the destination list). */
export type NavigateState = { navigating: boolean; siteId: string | null };

/** Reads navigateHref's address back: "?navigate" is the destination list, "?navigate=<id>" a site, no param the map. */
export function readNavigate(params: { get(name: string): string | null }): NavigateState {
  const value = params.get("navigate");
  return { navigating: value != null, siteId: value || null };
}

/** The site boat navigation last headed for in this tab, so the Navigate tab comes back to it. Null when unknown. */
export function loadNavSite(storage: NavStorage | undefined = tabStorage()): string | null {
  try {
    return storage?.getItem(NAV_KEY) ?? null;
  } catch {
    return null;
  }
}

export function saveNavSite(siteId: string | null, storage: NavStorage | undefined = tabStorage()): void {
  try {
    if (siteId) storage?.setItem(NAV_KEY, siteId);
    else storage?.removeItem(NAV_KEY);
    if (typeof window !== "undefined") window.dispatchEvent(new Event(NAV_SITE_EVENT));
  } catch {
    // Blocked storage: the Navigate tab opens on the destination list next time.
  }
}

/** A site the Navigate tab can head for, with how far it is when the boat's position is known. */
export type Destination = LatLon & { id: string; name: string; atoll: string | null; km: number | null };

/** The destination list shows at most this many sites. */
export const DESTINATION_LIMIT = 40;

/**
 * The Navigate tab's destination list: sites whose name or atoll holds the search, nearest first once the boat's
 * position is known, else by name. Capped at DESTINATION_LIMIT; `total` counts every match.
 */
export function destinationList(
  sites: readonly (LatLon & { id: string; name: string; atoll: string | null })[],
  query: string,
  from: LatLon | null,
): { items: Destination[]; total: number } {
  const matches = sites.filter((site) => matchesSearch(site, site.atoll ?? undefined, query));
  const withKm = matches.map((site) => ({ ...site, km: from ? distanceKm(from, site) : null }));
  withKm.sort((a, b) => (a.km != null && b.km != null ? a.km - b.km : a.name.localeCompare(b.name)));
  return { items: withKm.slice(0, DESTINATION_LIMIT), total: withKm.length };
}
