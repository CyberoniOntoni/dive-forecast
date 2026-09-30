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
