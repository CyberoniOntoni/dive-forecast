import type { LatLngBounds, LayerGroup, Map as LeafletMapType } from "leaflet";
import type { NavDraw } from "@/components/BoatNav";

/** Boat navigation's map drawing, kept apart from the site map; SiteMap hands it its Leaflet copy. */

type LeafletLib = typeof import("leaflet");

/** The route (white over a dark casing), the target ring, the GPS accuracy circle and the boat with its heading. */
export function drawNav(L: LeafletLib, map: LeafletMapType, nav: NavDraw): LayerGroup {
  const group = L.layerGroup();
  const target = L.latLng(nav.target.lat, nav.target.lon);
  const line = nav.route
    ? nav.route.points.map(([lat, lon]) => L.latLng(lat, lon))
    : nav.boat
      ? [L.latLng(nav.boat.lat, nav.boat.lon), target]
      : [];
  if (line.length > 1) {
    const dashed = nav.route?.routed === false || nav.route == null;
    L.polyline(line, { color: "#07151d", weight: 7, opacity: 0.55, interactive: false }).addTo(group);
    L.polyline(line, { color: "#ffffff", weight: 3.5, dashArray: dashed ? "8 8" : undefined, interactive: false }).addTo(group);
  }
  L.circleMarker(target, { radius: 13, color: "#ffffff", weight: 3, fill: false, interactive: false }).addTo(group);
  if (nav.boat) {
    const boat = L.latLng(nav.boat.lat, nav.boat.lon);
    L.circle(boat, { radius: nav.boat.accuracyM, color: "#8ef6e4", weight: 1, fillOpacity: 0.1, interactive: false }).addTo(group);
    L.marker(boat, { icon: boatIcon(L, nav.courseDeg), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(group);
  }
  group.addTo(map);
  return group;
}

/** A dot for a stopped boat; a pointed hull along the course once it is under way. */
function boatIcon(L: LeafletLib, courseDeg: number | null) {
  const body =
    courseDeg == null
      ? '<circle cx="14" cy="14" r="7" fill="#8ef6e4" stroke="#07151d" stroke-width="3"/>'
      : `<g transform="rotate(${courseDeg} 14 14)"><path d="M14 2 L22 24 L14 19 L6 24 Z" fill="#8ef6e4" stroke="#07151d" stroke-width="2.5" stroke-linejoin="round"/></g>`;
  return L.divIcon({
    className: "dive-boat",
    html: `<svg width="28" height="28" viewBox="0 0 28 28" aria-label="Your boat">${body}</svg>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

/** The target, the boat and the route: what "Show route" frames. */
export function navBounds(L: LeafletLib, nav: NavDraw): LatLngBounds {
  const points = [L.latLng(nav.target.lat, nav.target.lon)];
  if (nav.boat) points.push(L.latLng(nav.boat.lat, nav.boat.lon));
  for (const [lat, lon] of nav.route?.points ?? []) points.push(L.latLng(lat, lon));
  return L.latLngBounds(points);
}
