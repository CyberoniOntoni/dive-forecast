"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CircleMarker, LeafletMouseEvent, Map as LeafletMapType, Marker } from "leaflet";
import "leaflet/dist/leaflet.css";
import { CurrentOverlay, hasForecast, type SiteGlance } from "@/components/CurrentOverlay";
import { nowcastGlance, type NowcastGlance } from "@/lib/nowcast-glance";
import type { SiteNowcast } from "@/lib/nowcast";
import type { Site } from "@/lib/types";

type Point = { lat: number; lon: number };
type LeafletLib = typeof import("leaflet");

const PIN_SIZE = 44;

type MapProps = {
  siteGlances: readonly SiteGlance[];
  draft: Point | null;
  adding: boolean;
  onPick: (point: Point) => void;
  onOpen: (id: string) => void;
};

type ArrowFields = {
  bearing: number;
  opacity: number;
  label: string;
  color: string;
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

function pinHtml(glance: NowcastGlance, showStrength: boolean): string {
  const spoken = escapeHtml(glance.spoken);
  const arrow = arrowFields(glance);
  if (!arrow) return missingPin(spoken);
  const strengthMark = showStrength ? strengthBadge(escapeHtml(arrow.label)) : "";
  return arrowPin(spoken, arrow.opacity, arrow.bearing, arrow.color, strengthMark);
}

/** One empty glance keeps the dot pin. Color is the glance token, including stop. */
function arrowFields(glance: NowcastGlance): ArrowFields | null {
  if (!hasForecast(glance) || glance.color == null) return null;
  return {
    bearing: glance.arrowBearing,
    opacity: glance.opacity,
    label: glance.label,
    color: glance.color,
  };
}

function missingPin(spoken: string): string {
  return `<div style="width:${PIN_SIZE}px;height:${PIN_SIZE}px;display:flex;align-items:center;justify-content:center" aria-label="${spoken}"><span style="width:10px;height:10px;border-radius:999px;background:var(--foam);opacity:0.45"></span></div>`;
}

function strengthBadge(strength: string): string {
  return `<span style="position:absolute;left:50%;top:calc(100% + 2px);transform:translateX(-50%);white-space:nowrap;border-radius:999px;background:var(--glass);color:var(--foam);border:1px solid color-mix(in srgb, var(--foam) 28%, transparent);padding:1px 6px;font:600 11px/16px var(--font-geist-sans),ui-sans-serif,system-ui,sans-serif">${strength}</span>`;
}

function arrowPin(spoken: string, opacity: number, bearing: number, color: string, strengthMark: string): string {
  return `<div style="width:${PIN_SIZE}px;height:${PIN_SIZE}px;position:relative;opacity:${opacity}" aria-label="${spoken}"><div style="position:absolute;left:50%;top:50%;width:16px;height:30px;margin-left:-8px;margin-top:-30px;transform:rotate(${bearing}deg);transform-origin:8px 30px;color:${color}"><svg width="16" height="30" viewBox="0 0 16 30" aria-hidden="true"><path d="M8 1.2 14.2 12.2H10.4V28H5.6V12.2H1.8Z" fill="currentColor" stroke="var(--ink)" stroke-width="1.2" stroke-linejoin="round"/></svg></div><span style="position:absolute;left:50%;top:50%;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:999px;background:${color};box-shadow:0 0 0 2px var(--ink)"></span>${strengthMark}</div>`;
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
.dive-map .leaflet-bar a{width:44px!important;height:44px!important;line-height:44px!important;background:var(--ink);color:var(--foam);border-bottom-color:color-mix(in srgb, var(--foam) 28%, transparent)}
.dive-map .leaflet-bar a:hover,.dive-map .leaflet-bar a:focus{background:color-mix(in srgb, var(--ink) 78%, var(--foam));color:var(--foam)}
.dive-map .leaflet-bar a:focus-visible{outline:2px solid var(--incoming);outline-offset:2px}
.dive-map.leaflet-container .leaflet-control-attribution{max-width:min(70%, calc(100% - 4.5rem));white-space:normal;background:color-mix(in srgb, var(--ink) 88%, transparent);color:var(--foam)}
.dive-map.leaflet-container .leaflet-control-attribution a{color:var(--foam)}
@media (max-width:1023px){
  .dive-map .leaflet-bottom.leaflet-right{top:0;bottom:auto;left:0;right:auto}
}
`;

function mountDiveMap(
  L: LeafletLib,
  container: HTMLDivElement,
  siteGlances: readonly SiteGlance[],
  hooks: {
    isAdding: () => boolean;
    onPick: (point: Point) => void;
    onZoom: (zoom: number) => void;
  },
): { map: LeafletMapType; destroy: () => void } {
  const map = L.map(container, { zoomControl: false });
  L.control.zoom({ position: "topright" }).addTo(map);
  addSatelliteTiles(L, map);

  map.on("zoomend", () => {
    hooks.onZoom(map.getZoom());
  });

  frameSites(L, map, siteGlances);

  map.on("click", (event: LeafletMouseEvent) => {
    if (!hooks.isAdding()) return;
    hooks.onPick({ lat: event.latlng.lat, lon: event.latlng.lng });
  });

  const resize = new ResizeObserver(() => {
    map.invalidateSize();
  });
  resize.observe(container);
  map.invalidateSize();
  hooks.onZoom(map.getZoom());

  return {
    map,
    destroy: () => {
      resize.disconnect();
      map.remove();
    },
  };
}

function addSatelliteTiles(L: LeafletLib, map: LeafletMapType) {
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 18,
    attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  }).addTo(map);
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

function placeSiteMarkers(
  L: LeafletLib,
  map: LeafletMapType,
  siteGlances: readonly SiteGlance[],
  showStrength: boolean,
  onOpen: (id: string) => void,
): Marker[] {
  return siteGlances.map(({ site, glance }) => {
    const marker = L.marker([site.lat, site.lon], {
      icon: L.divIcon({
        className: "dive-pin",
        html: pinHtml(glance, showStrength),
        iconSize: [PIN_SIZE, PIN_SIZE],
        iconAnchor: [PIN_SIZE / 2, PIN_SIZE / 2],
      }),
      bubblingMouseEvents: false,
      keyboard: true,
    });
    marker.bindTooltip(escapeHtml(glance.spoken), { direction: "top" });
    marker.on("click", () => {
      onOpen(site.id);
    });
    marker.addTo(map);
    return marker;
  });
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

function glancesFor(sites: readonly Site[], nowcasts: readonly SiteNowcast[]): SiteGlance[] {
  const byId = new Map(nowcasts.map((item) => [item.siteId, item]));
  // Spoken line includes strength. The pin hides that word when zoomed out.
  return sites.map((site) => ({
    site,
    glance: nowcastGlance(site.name, byId.get(site.id), true),
  }));
}
/** Leaflet touches window. dynamic() is the only loader; the canvas is created on mount. */
const LeafletMap = dynamic(
  async () => {
    const L = leafletApi(await import("leaflet"));

    function MapCanvas({ siteGlances, draft, adding, onPick, onOpen }: MapProps) {
      const containerRef = useRef<HTMLDivElement>(null);
      const mapRef = useRef<LeafletMapType | null>(null);
      const markersRef = useRef<Marker[]>([]);
      const draftMarkerRef = useRef<CircleMarker | null>(null);
      const onPickRef = useRef(onPick);
      const onOpenRef = useRef(onOpen);
      const addingRef = useRef(adding);
      const destroyRef = useRef<(() => void) | null>(null);
      // 0 until the map exists, so marker effects wait for mount.
      const [mapEpoch, setMapEpoch] = useState(0);
      const [zoom, setZoom] = useState(0);
      // Strength word on the pin from zoom 10. The tooltip keeps the full spoken line.
      const showStrength = zoom >= 10;

      useEffect(() => {
        onPickRef.current = onPick;
        onOpenRef.current = onOpen;
        addingRef.current = adding;
      }, [onPick, onOpen, adding]);

      // One canvas, from the sites on screen now. A later list only replaces markers.
      useEffect(() => {
        const container = containerRef.current;
        if (!container || mapRef.current) return;
        const mounted = mountDiveMap(L, container, siteGlances, {
          isAdding: () => addingRef.current,
          onPick: (point) => onPickRef.current(point),
          onZoom: (next) => setZoom(next),
        });
        mapRef.current = mounted.map;
        destroyRef.current = mounted.destroy;
        setMapEpoch((epoch) => epoch + 1);
      }, [siteGlances]);

      useEffect(() => {
        return () => {
          destroyRef.current?.();
          destroyRef.current = null;
          mapRef.current = null;
          markersRef.current = [];
          draftMarkerRef.current = null;
        };
      }, []);

      useEffect(() => {
        const map = mapRef.current;
        if (!map || mapEpoch === 0) return;
        for (const marker of markersRef.current) marker.remove();
        markersRef.current = placeSiteMarkers(L, map, siteGlances, showStrength, (id) => {
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
}: {
  sites: Site[];
  nowcasts: SiteNowcast[];
  maldivesWall: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Point | null>(null);
  const [adding, setAdding] = useState(false);
  const siteGlances = useMemo(() => glancesFor(sites, nowcasts), [sites, nowcasts]);

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
          maldivesWall={maldivesWall}
          draft={draft}
          adding={adding}
          onAddingChange={setAddingMode}
          onAdded={finishAdd}
        />
        {/* h-full: the page body is a 100dvh column. Without it the map collapses on a wide window. */}
        <div className="relative z-0 h-full min-h-0 min-w-0 flex-1">
          <LeafletMap
            siteGlances={siteGlances}
            draft={draft}
            adding={adding}
            onPick={setDraft}
            onOpen={(id) => {
              router.push(`/sites/${id}`);
            }}
          />
        </div>
      </div>
    </div>
  );
}