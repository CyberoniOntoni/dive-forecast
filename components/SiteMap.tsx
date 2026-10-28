"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CircleMarker, LayerGroup, LeafletMouseEvent, Map as LeafletMapType, Marker, MarkerClusterGroup } from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import { BoatNav, type NavDraw, type NavSite } from "@/components/BoatNav";
import { CurrentOverlay, hasForecast, type SiteGlance } from "@/components/CurrentOverlay";
import { ARROW_LENGTH, ARROW_WIDTH, arrowSvgBody } from "@/lib/arrow-shape";
import { getShelter, getShelterPoint, getShelterShapes } from "@/lib/actions";
import { addMapLayers } from "@/lib/map-layers";
import { loadMapView, saveMapView, spotlightZoom, type MapView } from "@/lib/map-view";
import { nowcastGlance, type NowcastGlance } from "@/lib/nowcast-glance";
import type { SiteNowcast } from "@/lib/nowcast";
import type { Site, Strength } from "@/lib/types";

type Point = { lat: number; lon: number };
type LeafletLib = typeof import("leaflet");

const PIN_SIZE = 44;

type MapProps = {
  siteGlances: readonly SiteGlance[];
  draft: Point | null;
  adding: boolean;
  onPick: (point: Point) => void;
  onOpen: (id: string) => void;
  onView: (view: MapView) => void;
  /** An atoll to frame, from the list's filter. The count changes each time, so picking the same atoll again reframes. */
  focus: { atollId: string; count: number } | null;
  /** A site to centre and highlight, from a list row's "Show on map". The count changes each time, so it re-centres. */
  spotlight: { siteId: string; count: number } | null;
  /** The ring was dismissed on the map (a click): clear the spotlight state. */
  onSpotlightClear: () => void;
  /** Boat navigation: the boat, its route and the site it goes to. */
  nav: NavDraw | null;
};

/** Below this zoom nearby pins merge into a numbered cluster; from it every pin shows with its arrow. */
const CLUSTER_UNTIL_ZOOM = 11;

type ArrowFields = {
  bearing: number;
  strength: Strength;
  opacity: number;
  label: string;
  color: string;
  estimated: boolean;
};

/** Leaflet tooltip and pin aria-label are HTML, so a site name cannot inject markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pinHtml(glance: NowcastGlance, showStrength: boolean, age: string | null): string {
  const spoken = escapeHtml(withAge(glance.spoken, age));
  const arrow = arrowFields(glance);
  if (!arrow) return missingPin(spoken);
  const note = pinNote(showStrength ? arrow.label : "", age);
  const strengthMark = note ? strengthBadge(escapeHtml(note)) : "";
  return arrowPin(spoken, arrow, strengthMark);
}

function pinIcon(L: LeafletLib, glance: NowcastGlance, showStrength: boolean, age: string | null) {
  return L.divIcon({
    className: "dive-pin",
    html: pinHtml(glance, showStrength, age),
    iconSize: [PIN_SIZE, PIN_SIZE],
    iconAnchor: [PIN_SIZE / 2, PIN_SIZE / 2],
  });
}

/** Strength stays the zoomed-in word. A stale age is added and does not replace it. */
function pinNote(strength: string, age: string | null): string {
  if (age && strength) return `${strength} ${age}`;
  return age ?? strength;
}

function withAge(spoken: string, age: string | null): string {
  if (!age) return spoken;
  return `${spoken}, ${age}`;
}

/** One empty glance keeps the dot pin. Color is the glance token, including stop. */
function arrowFields(glance: NowcastGlance): ArrowFields | null {
  if (!hasForecast(glance) || glance.color == null) return null;
  return {
    bearing: glance.arrowBearing,
    strength: glance.strength ?? "mild",
    opacity: glance.opacity,
    label: glance.label,
    color: glance.color,
    estimated: glance.estimatedHeading,
  };
}

function missingPin(spoken: string): string {
  return `<div style="width:${PIN_SIZE}px;height:${PIN_SIZE}px;display:flex;align-items:center;justify-content:center" aria-label="${spoken}"><span style="width:10px;height:10px;border-radius:999px;background:var(--foam);opacity:0.45"></span></div>`;
}

function strengthBadge(strength: string): string {
  return `<span style="position:absolute;left:50%;top:calc(100% + 2px);transform:translateX(-50%);white-space:nowrap;border-radius:999px;background:var(--glass);color:var(--foam);border:1px solid color-mix(in srgb, var(--foam) 28%, transparent);padding:1px 6px;font:600 11px/16px var(--font-geist-sans),ui-sans-serif,system-ui,sans-serif">${strength}</span>`;
}

/**
 * A slim tapered arrow from the pin's dot, rotated about its tail. Its length grows with strength; a measured or
 * rim-derived heading is solid, an estimated one a dashed outline (lib/arrow-shape.ts).
 */
function arrowPin(spoken: string, arrow: ArrowFields, strengthMark: string): string {
  const length = ARROW_LENGTH[arrow.strength];
  const half = ARROW_WIDTH / 2;
  return `<div style="width:${PIN_SIZE}px;height:${PIN_SIZE}px;position:relative;opacity:${arrow.opacity}" aria-label="${spoken}"><div style="position:absolute;left:50%;top:50%;width:${ARROW_WIDTH}px;height:${length}px;margin-left:-${half}px;margin-top:-${length}px;transform:rotate(${arrow.bearing}deg);transform-origin:${half}px ${length}px;color:${arrow.color}"><svg width="${ARROW_WIDTH}" height="${length}" viewBox="0 0 ${ARROW_WIDTH} ${length}" overflow="visible" aria-hidden="true">${arrowSvgBody(arrow.strength, arrow.estimated)}</svg></div><span style="position:absolute;left:50%;top:50%;width:8px;height:8px;margin:-4px 0 0 -4px;border-radius:999px;background:${arrow.color};box-shadow:0 0 0 2px var(--ink)"></span>${strengthMark}</div>`;
}

function framePadding() {
  const wide = window.matchMedia("(min-width: 1024px)").matches;
  if (wide) {
    return { paddingTopLeft: [24, 48] as [number, number], paddingBottomRight: [56, 36] as [number, number], maxZoom: 11 };
  }
  // The sheet covers the bottom of the map on a phone.
  return { paddingTopLeft: [12, 48] as [number, number], paddingBottomRight: [56, 88] as [number, number], maxZoom: 11 };
}

/** Leaflet's dynamic import is sometimes `{ default }` rather than the namespace. */
function leafletApi(mod: LeafletLib): LeafletLib {
  if (typeof mod.map === "function") return mod;
  const fallback = (mod as { default?: LeafletLib }).default;
  if (fallback && typeof fallback.map === "function") return fallback;
  return mod;
}

/** On a phone the current sheet covers the bottom of the map, so attribution moves to the top left. */
const MAP_STYLE = `
.dive-pin{background:transparent;border:none}
.dive-spotlight{background:transparent;border:none;pointer-events:none}
.dive-spotlight span{position:absolute;inset:0;border-radius:999px;border:3px solid var(--foam);box-shadow:0 0 0 2px var(--ink),inset 0 0 0 2px var(--ink);animation:dive-spotlight-pulse 1.1s ease-out 3}
@keyframes dive-spotlight-pulse{0%{transform:scale(.55);opacity:1}70%{transform:scale(1.35);opacity:.3}100%{transform:scale(1);opacity:.9}}
@media (prefers-reduced-motion: reduce){.dive-spotlight span{animation:none}}
.dive-map .leaflet-bar a{width:44px!important;height:44px!important;line-height:44px!important;background:var(--ink);color:var(--foam);border-bottom-color:color-mix(in srgb, var(--foam) 28%, transparent)}
.dive-map .leaflet-bar a:hover,.dive-map .leaflet-bar a:focus{background:color-mix(in srgb, var(--ink) 78%, var(--foam));color:var(--foam)}
.dive-map .leaflet-bar a:focus-visible{outline:2px solid var(--incoming);outline-offset:2px}
.dive-map.leaflet-container .leaflet-control-attribution{max-width:min(70%, calc(100% - 4.5rem));white-space:normal;background:color-mix(in srgb, var(--ink) 88%, transparent);color:var(--foam)}
.dive-map.leaflet-container .leaflet-control-attribution a{color:var(--foam)}
.dive-map.leaflet-container{background:var(--ink)}
.dive-map .leaflet-control-layers{background:var(--ink);color:var(--foam);border:2px solid rgba(0,0,0,0.2);border-radius:4px}
.dive-map .leaflet-control-layers-toggle{width:44px;height:44px;background-size:24px 24px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23f5fbfc' stroke-width='1.8' stroke-linejoin='round'%3E%3Cpath d='M12 3 2 8l10 5 10-5z'/%3E%3Cpath d='m2 12 10 5 10-5'/%3E%3Cpath d='m2 16 10 5 10-5'/%3E%3C/svg%3E")}
.dive-map .leaflet-control-layers-toggle:focus-visible{outline:2px solid var(--incoming);outline-offset:2px}
.dive-map .leaflet-control-layers-expanded{padding:4px 10px 4px 8px;font:500 14px/1.2 var(--font-geist-sans),ui-sans-serif,system-ui,sans-serif}
.dive-map .leaflet-control-layers label{min-height:44px;display:flex;align-items:center;margin:0;cursor:pointer}
.dive-map .leaflet-control-layers label>span{display:flex;align-items:center;gap:10px}
.dive-map .leaflet-control-layers input{width:18px;height:18px;margin:0;accent-color:var(--incoming)}
.dive-map .leaflet-control-layers input:focus-visible{outline:2px solid var(--incoming);outline-offset:2px}
.dive-map .leaflet-control-layers-separator{border-top-color:color-mix(in srgb, var(--foam) 28%, transparent)}
.dive-atlas-legend{background:color-mix(in srgb, var(--ink) 90%, transparent);color:var(--foam);border-radius:6px;padding:6px 10px;font:500 12px/1.3 var(--font-geist-sans),ui-sans-serif,system-ui,sans-serif;max-width:190px}
.dive-atlas-legend-title{font-weight:600;margin:0 0 2px}
.dive-atlas-legend-note{margin:0 0 4px;color:color-mix(in srgb, var(--foam) 75%, transparent)}
.dive-atlas-legend ul{list-style:none;margin:0;padding:0}
.dive-atlas-legend li{display:flex;align-items:center;gap:6px;margin:2px 0}
.dive-shelter-legend{min-width:210px;max-width:240px}
.dive-shelter-time{display:flex;align-items:center;gap:6px;margin:2px 0 6px;font-variant-numeric:tabular-nums}
.dive-shelter-time>span{flex:1;text-align:center}
.dive-shelter-time button{min-width:28px;height:28px;border-radius:4px;border:1px solid color-mix(in srgb, var(--foam) 35%, transparent);background:transparent;color:var(--foam);font:600 14px/1 inherit;cursor:pointer}
.dive-shelter-time button.dive-shelter-now{padding:0 6px;font-size:12px}
.dive-shelter-time button:disabled{opacity:.35;cursor:default}
.dive-shelter-time button:focus-visible{outline:2px solid var(--incoming);outline-offset:1px}
.dive-shelter-bar{height:10px;border-radius:3px;opacity:.85}
.dive-shelter-ticks{position:relative;height:30px;margin:2px 0 2px;font-size:10px;line-height:12px}
.dive-shelter-ticks span{position:absolute;top:0;width:44px;margin-left:-1px;padding-left:3px;border-left:1px solid color-mix(in srgb, var(--foam) 60%, transparent)}
.dive-shelter-note{margin:2px 0 0}
.dive-shelter-ticks small{display:block;font-size:10px;color:color-mix(in srgb, var(--foam) 75%, transparent)}
@media (max-width:640px){.dive-shelter-legend{min-width:0;width:210px;max-width:210px}.dive-shelter-time{font-size:11px}.dive-shelter-ticks{height:14px}.dive-shelter-ticks small,.dive-shelter-tick-mid,.dive-shelter-note,.dive-shelter-date{display:none}}
.dive-shelter-popup p{margin:0 0 2px}
.dive-shelter-popup-head{font-weight:600}
.dive-atlas-swatch{display:inline-block;width:12px;height:12px;border-radius:2px;flex:none}
.dive-cluster-icon{background:transparent;border:none}
.dive-cluster{width:44px;height:44px;border-radius:999px;display:flex;align-items:center;justify-content:center;background:var(--ink);color:var(--foam);border:2px solid color-mix(in srgb, var(--foam) 70%, transparent);box-shadow:0 1px 4px rgba(0,0,0,.45);font:600 15px/1 var(--font-geist-sans),ui-sans-serif,system-ui,sans-serif;font-variant-numeric:tabular-nums;cursor:pointer}
.dive-grid-label{color:#fff;font:600 11px/16px var(--font-geist-sans),ui-sans-serif,system-ui,sans-serif;text-shadow:0 0 3px #000,0 0 2px #000;white-space:nowrap;pointer-events:none}
@media (max-width:1023px){
  .dive-map .leaflet-bottom.leaflet-right{top:0;bottom:auto;left:0;right:auto}
  .dive-map .leaflet-bottom.leaflet-right .leaflet-control-attribution{float:left}
}
`;

function mountDiveMap(
  L: LeafletLib,
  container: HTMLDivElement,
  siteGlances: readonly SiteGlance[],
  hooks: {
    isAdding: () => boolean;
    onPick: (point: Point) => void;
    /** Clears the spotlight ring if one is up; true when it did. */
    clearSpotlight: () => boolean;
    onZoom: (zoom: number) => void;
    onView: (view: MapView) => void;
  },
): { map: LeafletMapType; pins: MarkerClusterGroup; destroy: () => void } {
  const map = L.map(container, { zoomControl: false });
  L.control.zoom({ position: "topright" }).addTo(map);
  const { readSea } = addMapLayers(L, map, { shelter: { load: getShelter, shapes: getShelterShapes, point: getShelterPoint } });
  const pins = L.markerClusterGroup({
    disableClusteringAtZoom: CLUSTER_UNTIL_ZOOM,
    maxClusterRadius: 48,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: false,
    iconCreateFunction: (cluster) => clusterIcon(L, cluster.getChildCount()),
  });
  pins.addTo(map);

  const reportView = () => {
    const bounds = map.getBounds();
    hooks.onView({ south: bounds.getSouth(), west: bounds.getWest(), north: bounds.getNorth(), east: bounds.getEast() });
    // Kept for this tab, so "Back to map" (or the browser's back) opens the map where it was.
    const center = map.getCenter();
    saveMapView({ lat: center.lat, lon: center.lng, zoom: map.getZoom() });
  };
  map.on("zoomend", () => {
    hooks.onZoom(map.getZoom());
  });
  map.on("moveend", reportView);

  const saved = loadMapView();
  if (saved) map.setView(L.latLng(saved.lat, saved.lon), saved.zoom);
  else frameSites(L, map, siteGlances);

  // The one owner of a map click: placing a new site's pin, else dismissing the spotlight ring, else reading the
  // sea state where the sheltered-water layer is on.
  map.on("click", (event: LeafletMouseEvent) => {
    const { lat, lng } = event.latlng;
    if (hooks.isAdding()) hooks.onPick({ lat, lon: lng });
    else if (!hooks.clearSpotlight()) readSea(lat, lng);
  });

  const resize = new ResizeObserver(() => {
    map.invalidateSize();
  });
  resize.observe(container);
  map.invalidateSize();
  hooks.onZoom(map.getZoom());
  reportView();

  return {
    map,
    pins,
    destroy: () => {
      resize.disconnect();
      map.remove();
    },
  };
}

/** Frame bounds in the part of the map the list does not cover, at most `maxZoom` (framePadding's by default). */
function frameOn(map: LeafletMapType, bounds: ReturnType<LeafletLib["latLngBounds"]>, maxZoom?: number, fly = false) {
  const options = maxZoom == null ? framePadding() : { ...framePadding(), maxZoom };
  if (fly) map.flyToBounds(bounds, { ...options, duration: 0.8 });
  else map.fitBounds(bounds, options);
}

/**
 * Ring one site and fly to it: centred, close enough that pins no longer cluster (spotlightZoom). The ring carries
 * the site's label as a permanent tooltip, so it reads at once even while the pin is still inside a cluster. A map
 * click clears it (through mountDiveMap's click handler). Returns the cleanup, which removes the ring.
 */
function attachSpotlight(L: LeafletLib, map: LeafletMapType, item: SiteGlance): () => void {
  const point = L.latLng(item.site.lat, item.site.lon);
  const ring = L.marker(point, {
    icon: L.divIcon({ className: "dive-spotlight", html: "<span></span>", iconSize: [52, 52], iconAnchor: [26, 26] }),
    interactive: false,
    keyboard: false,
    zIndexOffset: -1000,
  })
    .bindTooltip(escapeHtml(withAge(item.glance.spoken, item.age)), { permanent: true, direction: "top", offset: [0, -26] })
    .addTo(map);
  frameOn(map, L.latLngBounds(point, point), spotlightZoom(map.getZoom()), true);
  return () => {
    ring.remove();
  };
}

function frameSites(L: LeafletLib, map: LeafletMapType, siteGlances: readonly SiteGlance[]) {
  const points = siteGlances.map((item) => L.latLng(item.site.lat, item.site.lon));
  if (points.length > 0) {
    map.fitBounds(L.latLngBounds(points), framePadding());
  } else {
    // Archipelago frame when no sites are loaded. Not a dive site.
    map.fitBounds(L.latLngBounds([L.latLng(-0.7, 72.6), L.latLng(7.1, 73.8)]));
  }
}

/** A numbered bubble for several pins; tapping it zooms in (the cluster group's default). */
function clusterIcon(L: LeafletLib, count: number) {
  return L.divIcon({
    className: "dive-cluster-icon",
    html: `<div class="dive-cluster" aria-label="${count} sites. Zoom in to see them">${count}</div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
}

function placeSiteMarkers(
  L: LeafletLib,
  pins: MarkerClusterGroup,
  siteGlances: readonly SiteGlance[],
  showStrength: boolean,
  onOpen: (id: string) => void,
): Marker[] {
  const markers = siteGlances.map(({ site, glance, age }) => {
    const marker = L.marker([site.lat, site.lon], {
      icon: pinIcon(L, glance, showStrength, age),
      bubblingMouseEvents: false,
      keyboard: true,
    });
    marker.bindTooltip(escapeHtml(withAge(glance.spoken, age)), { direction: "top" });
    marker.on("click", () => {
      onOpen(site.id);
    });
    return marker;
  });
  pins.addLayers(markers);
  return markers;
}

function placeDraftPin(L: LeafletLib, map: LeafletMapType, draft: Point): CircleMarker {
  const marker = L.circleMarker([draft.lat, draft.lon], {
    radius: 10,
    color: "var(--ink)",
    weight: 2,
    fillColor: "var(--outgoing)",
    fillOpacity: 0.95,
    bubblingMouseEvents: false,
  });
  marker.bindTooltip("New site", { direction: "top" });
  marker.addTo(map);
  return marker;
}

function glancesFor(
  sites: readonly Site[],
  nowcasts: readonly SiteNowcast[],
  maldivesWall: string,
): SiteGlance[] {
  const byId = new Map(nowcasts.map((item) => [item.siteId, item]));
  // Spoken line includes strength. The pin hides that word when zoomed out.
  return sites.map((site) => {
    const nowcast = byId.get(site.id);
    const glance = nowcastGlance(site.name, nowcast, true);
    const stale = glance.confidence != null && nowcast?.stale === true;
    return {
      site,
      glance,
      age: stale ? (shortSeriesAge(glance.fetchedAt, maldivesWall) ?? "old") : null,
    };
  });
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
/** Maldives is UTC+5. The wall clock is those digits with no zone. */
const MALDIVES_OFFSET_MS = 5 * HOUR_MS;

/** Minutes, hours, or days since the marine fetch. */
function shortSeriesAge(fetchedAt: number | null, maldivesWall: string): string | null {
  if (fetchedAt == null || !Number.isFinite(fetchedAt)) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(maldivesWall);
  if (!match) return null;
  const wallMs = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
  const ageMs = wallMs - MALDIVES_OFFSET_MS - fetchedAt;
  if (!Number.isFinite(ageMs)) return null;
  const minutes = Math.floor(Math.max(0, ageMs) / MINUTE_MS);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
/** The route (white over a dark casing), the target ring, the GPS accuracy circle and the boat with its heading. */
function drawNav(L: LeafletLib, map: LeafletMapType, nav: NavDraw): LayerGroup {
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
    className: "dive-pin",
    html: `<svg width="28" height="28" viewBox="0 0 28 28" aria-label="Your boat">${body}</svg>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

/** Leaflet touches window. dynamic() is the only loader; the canvas is created on mount. */
const LeafletMap = dynamic(
  async () => {
    // The cluster plugin adds MarkerClusterGroup to the global L. An ES module namespace is frozen, so it gets a
    // plain copy of Leaflet's exports (same classes), and the map uses that copy.
    const L: LeafletLib = { ...leafletApi(await import("leaflet")) };
    (globalThis as { L?: LeafletLib }).L = L;
    await import("leaflet.markercluster");

    function MapCanvas({
      siteGlances,
      draft,
      adding,
      onPick,
      onOpen,
      onView,
      focus,
      spotlight,
      onSpotlightClear,
      nav,
    }: MapProps) {
      const onSpotlightClearRef = useRef(onSpotlightClear);
      // Set while the spotlight ring is on the map, so a map click knows to clear it.
      const spotlightUpRef = useRef(false);
      const containerRef = useRef<HTMLDivElement>(null);
      const mapRef = useRef<LeafletMapType | null>(null);
      const pinsRef = useRef<MarkerClusterGroup | null>(null);
      const onViewRef = useRef(onView);
      const markersRef = useRef<Marker[]>([]);
      const draftMarkerRef = useRef<CircleMarker | null>(null);
      const onPickRef = useRef(onPick);
      const onOpenRef = useRef(onOpen);
      const addingRef = useRef(adding);
      // 0 until the map exists, so marker effects wait for mount.
      const [mapEpoch, setMapEpoch] = useState(0);
      const [zoom, setZoom] = useState(0);
      // Strength word on the pin from zoom 10. The tooltip keeps the full spoken line.
      const showStrength = zoom >= 10;

      useEffect(() => {
        onPickRef.current = onPick;
        onOpenRef.current = onOpen;
        onViewRef.current = onView;
        onSpotlightClearRef.current = onSpotlightClear;
        addingRef.current = adding;
      }, [onPick, onOpen, onView, onSpotlightClear, adding]);

      // W4: one canvas; this effect returns mounted.destroy. Marker updates stay below.
      useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const mounted = mountDiveMap(L, container, siteGlances, {
          isAdding: () => addingRef.current,
          onPick: (point) => onPickRef.current(point),
          clearSpotlight: () => {
            if (!spotlightUpRef.current) return false;
            onSpotlightClearRef.current();
            return true;
          },
          onZoom: (next) => setZoom(next),
          onView: (view) => onViewRef.current(view),
        });
        mapRef.current = mounted.map;
        pinsRef.current = mounted.pins;
        setMapEpoch((epoch) => epoch + 1);
        return mounted.destroy;
      // eslint-disable-next-line react-hooks/exhaustive-deps -- W4 mounts the canvas once; marker sync is the next effect.
      }, []);

      useEffect(() => {
        const pins = pinsRef.current;
        if (!pins || mapEpoch === 0) return;
        // W11: same-length list setIcon in place; rebuild only when the count changes.
        if (markersRef.current.length === siteGlances.length) {
          for (let index = 0; index < siteGlances.length; index++) {
            const marker = markersRef.current[index];
            const item = siteGlances[index];
            if (!marker || !item) continue;
            marker.setIcon(pinIcon(L, item.glance, showStrength, item.age));
            marker.setTooltipContent(escapeHtml(withAge(item.glance.spoken, item.age)));
          }
          return;
        }
        pins.clearLayers();
        markersRef.current = placeSiteMarkers(L, pins, siteGlances, showStrength, (id) => {
          onOpenRef.current(id);
        });
      }, [siteGlances, mapEpoch, showStrength]);

      useEffect(() => {
        const map = mapRef.current;
        if (!map || mapEpoch === 0) return;
        draftMarkerRef.current?.remove();
        draftMarkerRef.current = null;
        if (!draft) return;
        draftMarkerRef.current = placeDraftPin(L, map, draft);
      }, [draft, mapEpoch]);

      useEffect(() => {
        const map = mapRef.current;
        if (!map || mapEpoch === 0 || !focus) return;
        const points = siteGlances
          .filter(({ site }) => site.atollId === focus.atollId)
          .map(({ site }) => L.latLng(site.lat, site.lon));
        if (points.length > 0) frameOn(map, L.latLngBounds(points));
        // Reframe only when a new atoll is picked, not when the forecast refreshes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [focus, mapEpoch]);

      // "Show on map": React's spotlight state is the only owner of the ring; a map click asks to clear it.
      useEffect(() => {
        const map = mapRef.current;
        if (!map || mapEpoch === 0 || !spotlight) return;
        const item = siteGlances.find(({ site }) => site.id === spotlight.siteId);
        if (!item) return;
        const detach = attachSpotlight(L, map, item);
        spotlightUpRef.current = true;
        return () => {
          spotlightUpRef.current = false;
          detach();
        };
        // Fly only when a site is picked, not when the forecast refreshes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [spotlight, mapEpoch]);

      // Boat navigation: drawn afresh on each fix, above the pins.
      const navLayerRef = useRef<LayerGroup | null>(null);
      useEffect(() => {
        const map = mapRef.current;
        if (!map || mapEpoch === 0) return;
        navLayerRef.current?.remove();
        navLayerRef.current = nav ? drawNav(L, map, nav) : null;
      }, [nav, mapEpoch]);

      useEffect(() => {
        const map = mapRef.current;
        if (!map || mapEpoch === 0 || !nav || nav.frame === 0) return;
        const points = [L.latLng(nav.target.lat, nav.target.lon)];
        if (nav.boat) points.push(L.latLng(nav.boat.lat, nav.boat.lon));
        for (const [lat, lon] of nav.route?.points ?? []) points.push(L.latLng(lat, lon));
        frameOn(map, L.latLngBounds(points), 15, true);
        // Frame only when asked (first route, "Show route"), not on every fix.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [nav?.frame, mapEpoch]);

      return <div ref={containerRef} className="dive-map absolute inset-0" />;
    }

    return { default: MapCanvas };
  },
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 flex items-center justify-center text-sm text-foam/80">Loading map…</div>
    ),
  },
);

export function SiteMap({
  sites,
  nowcasts,
  maldivesWall,
  atollNames,
  navigateTo = null,
}: {
  sites: Site[];
  nowcasts: SiteNowcast[];
  maldivesWall: string;
  /** Short atoll names by id, shown after site names that more than one site uses. */
  atollNames: Record<string, string>;
  /** A site to start boat navigation to (the site page's "Navigate by boat"). */
  navigateTo?: string | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Point | null>(null);
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<MapView | null>(null);
  const [focus, setFocus] = useState<{ atollId: string; count: number } | null>(null);
  const [spotlight, setSpotlight] = useState<{ siteId: string; count: number } | null>(null);
  const [navSiteId, setNavSiteId] = useState<string | null>(navigateTo);
  const [navDraw, setNavDraw] = useState<NavDraw | null>(null);
  const navSite = useMemo<NavSite | null>(() => {
    const site = sites.find((item) => item.id === navSiteId);
    return site ? { id: site.id, name: site.name, lat: site.lat, lon: site.lon } : null;
  }, [sites, navSiteId]);
  const siteGlances = useMemo(
    () => glancesFor(sites, nowcasts, maldivesWall),
    [sites, nowcasts, maldivesWall],
  );

  function setAddingMode(open: boolean) {
    setAdding(open);
    if (!open) setDraft(null);
  }

  function finishAdd() {
    setDraft(null);
    setAdding(false);
    router.refresh();
  }

  return (
    <div className="relative h-full min-h-0 w-full min-w-0 flex-1">
      <style>{MAP_STYLE}</style>
      <div className="absolute inset-0 flex min-h-0 flex-col overflow-hidden lg:flex-row">
        <CurrentOverlay
          siteGlances={siteGlances}
          atollNames={atollNames}
          view={view}
          maldivesWall={maldivesWall}
          draft={draft}
          adding={adding}
          onAddingChange={setAddingMode}
          onAdded={finishAdd}
          onFocusAtoll={(atollId) => setFocus((current) => ({ atollId, count: (current?.count ?? 0) + 1 }))}
          onSpotlight={(siteId) =>
            setSpotlight((current) => (siteId ? { siteId, count: (current?.count ?? 0) + 1 } : null))
          }
        />
        {/* h-full: the page body is a 100dvh column. Without it the map collapses on a wide window. */}
        <div className="relative z-0 h-full min-h-0 min-w-0 flex-1">
          <LeafletMap
            siteGlances={siteGlances}
            draft={draft}
            adding={adding}
            onPick={setDraft}
            onView={setView}
            focus={focus}
            spotlight={spotlight}
            onSpotlightClear={() => setSpotlight(null)}
            nav={navSite ? navDraw : null}
            onOpen={(id) => {
              router.push(`/sites/${id}`);
            }}
          />
          {navSite ? (
            // Below the attribution row on a phone; clear of the zoom and layer buttons on the right.
            <div className="pointer-events-none absolute left-2 right-16 top-12 z-[1000] max-w-md lg:left-3 lg:top-3">
              <BoatNav
                key={navSite.id}
                site={navSite}
                onDraw={setNavDraw}
                onClose={() => {
                  setNavSiteId(null);
                  router.replace("/");
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}