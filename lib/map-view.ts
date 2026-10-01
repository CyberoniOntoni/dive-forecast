/** The map's visible area, as the site list uses it. */
export type MapView = { south: number; west: number; north: number; east: number };

/** True when the point is inside the view. Edges count as inside. */
export function inView(lat: number, lon: number, view: MapView): boolean {
  return lat >= view.south && lat <= view.north && lon >= view.west && lon <= view.east;
}

/** "25 sites", or "7 of 38 sites in view" once the view leaves some out. */
export function siteCountLabel(inViewCount: number, total: number): string {
  const noun = total === 1 ? "site" : "sites";
  if (inViewCount === total) return `${total} ${noun}`;
  return `${inViewCount} of ${total} ${noun} in view`;
}

/** Where the map was, so coming back from a site page opens it there again. Per tab: a new visit frames every site. */
export type SavedMapView = { lat: number; lon: number; zoom: number };

const VIEW_KEY = "dive-current:map-view";
const SHEET_KEY = "dive-current:sheet-open";

type SessionLike = Pick<Storage, "getItem" | "setItem">;

/** The tab's sessionStorage, or undefined where it is missing or blocked (private windows, previews). */
function tabStorage(): SessionLike | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function parseMapView(raw: string | null | undefined): SavedMapView | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SavedMapView>;
    const { lat, lon, zoom } = value;
    if (typeof lat !== "number" || typeof lon !== "number" || typeof zoom !== "number") return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(zoom)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || zoom < 0 || zoom > 22) return null;
    return { lat, lon, zoom };
  } catch {
    return null;
  }
}

/** The view saved in this tab, or null. Storage is a convenience: any failure just frames every site. */
export function loadMapView(storage: SessionLike | undefined = tabStorage()): SavedMapView | null {
  try {
    return parseMapView(storage?.getItem(VIEW_KEY));
  } catch {
    return null;
  }
}

export function saveMapView(view: SavedMapView, storage: SessionLike | undefined = tabStorage()): void {
  try {
    storage?.setItem(VIEW_KEY, JSON.stringify(view));
  } catch {
    // Blocked or full storage: the map frames every site next time.
  }
}

/** Whether the phone list was open, so it comes back as it was. False when unknown. */
export function loadSheetOpen(storage: SessionLike | undefined = tabStorage()): boolean {
  try {
    return storage?.getItem(SHEET_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveSheetOpen(open: boolean, storage: SessionLike | undefined = tabStorage()): void {
  try {
    storage?.setItem(SHEET_KEY, open ? "true" : "false");
  } catch {
    // Blocked storage: the list starts closed next time.
  }
}
