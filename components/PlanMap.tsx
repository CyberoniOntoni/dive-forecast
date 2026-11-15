"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import type { LayerGroup, Map as LeafletMapType } from "leaflet";
import "leaflet/dist/leaflet.css";

type LeafletLib = typeof import("leaflet");

export type PlanMapStop = { lat: number; lon: number; number: number; name: string; color: string };

type Props = {
  stops: readonly PlanMapStop[];
  /** Each leg's points, [lat, lon]; `routed` false draws it dashed (a straight line, no way round the reef found). */
  legs: readonly { points: readonly [number, number][]; routed: boolean }[];
  /** A day of one dive: a shorter map, since there is no route to show. */
  compact?: boolean;
};

/** Leaflet's dynamic import is sometimes `{ default }` rather than the namespace. */
function leafletApi(mod: LeafletLib): LeafletLib {
  if (typeof mod.map === "function") return mod;
  const fallback = (mod as { default?: LeafletLib }).default;
  return fallback && typeof fallback.map === "function" ? fallback : mod;
}

function stopIcon(L: LeafletLib, stop: PlanMapStop) {
  return L.divIcon({
    className: "plan-stop",
    html: `<span style="display:grid;place-items:center;width:28px;height:28px;border-radius:999px;background:${stop.color};color:#07151d;font:600 13px/1 var(--font-geist-sans),sans-serif;box-shadow:0 0 0 2px #07151d,0 2px 6px rgba(0,0,0,.5)">${stop.number}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

/** One day of a plan on a small satellite map: the dives numbered in order, and the boat route between them. */
const PlanMapCanvas = dynamic(
  async () => {
    const L = leafletApi(await import("leaflet"));
    function Canvas({ stops, legs }: Props) {
      const containerRef = useRef<HTMLDivElement>(null);
      const mapRef = useRef<LeafletMapType | null>(null);
      const layerRef = useRef<LayerGroup | null>(null);

      useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const map = L.map(container, { zoomControl: true, scrollWheelZoom: false, attributionControl: true });
        L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
          maxZoom: 18,
          attribution: "&copy; Esri, Maxar",
        }).addTo(map);
        map.attributionControl.setPrefix(false);
        mapRef.current = map;
        return () => {
          map.remove();
          mapRef.current = null;
        };
      }, []);

      useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        layerRef.current?.remove();
        const group = L.layerGroup();
        for (const leg of legs) {
          const line = leg.points.map(([lat, lon]) => L.latLng(lat, lon));
          if (line.length < 2) continue;
          L.polyline(line, { color: "#07151d", weight: 6, opacity: 0.55, interactive: false }).addTo(group);
          L.polyline(line, { color: "#ffffff", weight: 3, dashArray: leg.routed ? undefined : "8 8", interactive: false }).addTo(group);
        }
        for (const stop of stops) {
          L.marker([stop.lat, stop.lon], { icon: stopIcon(L, stop), title: `${stop.number}. ${stop.name}`, keyboard: false })
            .bindTooltip(`${stop.number}. ${stop.name}`, { direction: "top", offset: [0, -14] })
            .addTo(group);
        }
        group.addTo(map);
        layerRef.current = group;
        const points = [
          ...stops.map((stop) => L.latLng(stop.lat, stop.lon)),
          ...legs.flatMap((leg) => leg.points.map(([lat, lon]) => L.latLng(lat, lon))),
        ];
        if (points.length === 1) map.setView(points[0], 12);
        else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 14 });
      }, [stops, legs]);

      return <div ref={containerRef} className="h-full w-full" />;
    }
    return Canvas;
  },
  { ssr: false, loading: () => <div className="h-full w-full animate-pulse bg-foam/5" /> },
);

export function PlanMap(props: Props) {
  return (
    <div
      className={`plan-map relative isolate w-full overflow-hidden rounded-2xl ring-1 ring-foam/15 ${props.compact ? "h-44 sm:h-52" : "h-64 sm:h-80"}`}
    >
      <PlanMapCanvas {...props} />
    </div>
  );
}
