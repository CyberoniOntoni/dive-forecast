import type { Layer, LayerGroup, Map as LeafletMap } from "leaflet";

type LeafletLib = typeof import("leaflet");

/**
 * Map layers a viewer can switch. One base at a time; every overlay on or off on its own.
 * The dive pins are not a layer here: they are always on.
 */
export type BaseId = "satellite" | "street" | "none";
export type OverlayId = "seamarks" | "depthShading" | "sonarDepths" | "depthContours" | "grid";

export type LayerChoice = { base: BaseId; overlays: Record<OverlayId, boolean> };

export const BASE_LAYERS: readonly { id: BaseId; label: string }[] = [
  { id: "satellite", label: "Satellite" },
  { id: "street", label: "Street map" },
  { id: "none", label: "None" },
];

export const OVERLAYS: readonly { id: OverlayId; label: string; defaultOn: boolean }[] = [
  { id: "seamarks", label: "Seamarks", defaultOn: true },
  { id: "depthShading", label: "Depth shading", defaultOn: false },
  { id: "sonarDepths", label: "Sonar depths", defaultOn: false },
  { id: "depthContours", label: "Depth contours", defaultOn: false },
  { id: "grid", label: "Coordinate grid", defaultOn: false },
];

export const DEFAULT_LAYER_CHOICE: LayerChoice = {
  base: "satellite",
  overlays: Object.fromEntries(OVERLAYS.map((item) => [item.id, item.defaultOn])) as Record<OverlayId, boolean>,
};

export const LAYER_STORAGE_KEY = "dive-current:map-layers";

const OPENSEAMAP = '&copy; <a href="https://www.openseamap.org/">OpenSeaMap</a> contributors';
const DEPTH_WMS = "https://depth.openseamap.org/geoserver/openseamap/wms";

/** A stored choice, checked field by field. Anything unknown or malformed falls back to the default. */
export function parseLayerChoice(raw: string | null | undefined): LayerChoice {
  const choice: LayerChoice = { base: DEFAULT_LAYER_CHOICE.base, overlays: { ...DEFAULT_LAYER_CHOICE.overlays } };
  if (!raw) return choice;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return choice;
  }
  if (!parsed || typeof parsed !== "object") return choice;
  const { base, overlays } = parsed as { base?: unknown; overlays?: unknown };
  if (BASE_LAYERS.some((item) => item.id === base)) choice.base = base as BaseId;
  if (overlays && typeof overlays === "object") {
    for (const item of OVERLAYS) {
      const value = (overlays as Record<string, unknown>)[item.id];
      if (typeof value === "boolean") choice.overlays[item.id] = value;
    }
  }
  return choice;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** The browser's localStorage, or undefined where it is missing or blocked (private windows, previews). */
function browserStorage(): StorageLike | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** This viewer's saved layers. Storage is a convenience: any failure just gives the defaults. */
export function readLayerChoice(storage: StorageLike | undefined = browserStorage()): LayerChoice {
  try {
    return parseLayerChoice(storage?.getItem(LAYER_STORAGE_KEY));
  } catch {
    return parseLayerChoice(null);
  }
}

export function saveLayerChoice(choice: LayerChoice, storage: StorageLike | undefined = browserStorage()): void {
  try {
    storage?.setItem(LAYER_STORAGE_KEY, JSON.stringify(choice));
  } catch {
    // Blocked or full storage: the choice lasts for this visit only.
  }
}

/** Grid spacings in degrees, coarse to fine: 10°, 5°, 2°, 1°, 30′, 10′, 5′, 2′, 1′. */
const GRID_STEPS = [10, 5, 2, 1, 1 / 2, 1 / 6, 1 / 12, 1 / 30, 1 / 60];
const GRID_MAX_LINES = 8;

/** The finest spacing that keeps at most eight lines across the wider side of the view. */
export function gridStep(spanDeg: number): number {
  if (!(spanDeg > 0)) return GRID_STEPS[0];
  let chosen = GRID_STEPS[0];
  for (const step of GRID_STEPS) {
    if (spanDeg / step <= GRID_MAX_LINES) chosen = step;
  }
  return chosen;
}

/** Multiples of `step` from `from` to `to`, rounded to the second so 10′ lines don't drift. */
export function gridValues(from: number, to: number, step: number): number[] {
  const values: number[] = [];
  for (let index = Math.ceil(from / step - 1e-9); index * step <= to + 1e-9; index += 1) {
    values.push(Math.round(index * step * 3600) / 3600);
  }
  return values;
}

/** Degrees and minutes, the way charts label them: 4°10′N, 0°36′S, 73°30′E. The equator and meridian 0 have no letter. */
export function formatGridLabel(value: number, axis: "lat" | "lon"): string {
  const totalMinutes = Math.round(Math.abs(value) * 60);
  const degrees = Math.floor(totalMinutes / 60);
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  const hemisphere = totalMinutes === 0 ? "" : axis === "lat" ? (value > 0 ? "N" : "S") : value > 0 ? "E" : "W";
  return `${degrees}°${minutes}′${hemisphere}`;
}

/** Thin lat/long lines for the visible area, redrawn as the map moves. Labels sit on the left and top edges. */
function coordinateGrid(L: LeafletLib, map: LeafletMap): LayerGroup {
  const group = L.layerGroup();
  const draw = () => {
    group.clearLayers();
    const bounds = map.getBounds();
    const south = Math.max(-85, bounds.getSouth());
    const north = Math.min(85, bounds.getNorth());
    const west = bounds.getWest();
    const east = bounds.getEast();
    const step = gridStep(Math.max(north - south, east - west));
    const line = { color: "#ffffff", opacity: 0.45, weight: 1, interactive: false };
    const label = (text: string, at: [number, number], anchor: [number, number]) =>
      L.marker(at, {
        icon: L.divIcon({ className: "dive-grid-label", html: text, iconSize: [64, 16], iconAnchor: anchor }),
        interactive: false,
        keyboard: false,
        zIndexOffset: -1000,
      });
    for (const lat of gridValues(south, north, step)) {
      group.addLayer(L.polyline([[lat, west], [lat, east]], line));
      group.addLayer(label(formatGridLabel(lat, "lat"), [lat, west], [-4, 16]));
    }
    for (const lon of gridValues(west, east, step)) {
      group.addLayer(L.polyline([[south, lon], [north, lon]], line));
      group.addLayer(label(formatGridLabel(lon, "lon"), [north, lon], [-4, -2]));
    }
  };
  group.on("add", () => {
    map.on("moveend", draw);
    draw();
  });
  group.on("remove", () => {
    map.off("moveend", draw);
    group.clearLayers();
  });
  return group;
}

function baseLayer(L: LeafletLib, id: BaseId): Layer {
  if (id === "satellite") {
    return L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 18,
      attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    });
  }
  if (id === "street") {
    return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    });
  }
  // No tiles: the map's own dark background, for the least clutter.
  return L.layerGroup();
}

function overlayLayer(L: LeafletLib, id: OverlayId, map: LeafletMap): Layer {
  switch (id) {
    case "seamarks":
      return L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", { maxZoom: 18, attribution: OPENSEAMAP });
    case "depthShading":
      // GEBCO 2021 on a 15 arc-second grid (about 450 m): the shape of the atolls and the deep water, not a pass's sill.
      return L.tileLayer.wms("https://geoserver.openseamap.org/geoserver/gwc/service/wms", {
        layers: "gebco2021:gebco_2021",
        format: "image/png",
        transparent: true,
        version: "1.1.1",
        opacity: 0.8,
        attribution: '<a href="https://www.gebco.net/">GEBCO 2021 Grid</a> via OpenSeaMap',
      });
    case "sonarDepths":
      // Depths logged by boats that share their sonar tracks. Sparse in the Maldives.
      return L.tileLayer.wms(DEPTH_WMS, {
        layers: "openseamap:tracks_10m",
        format: "image/png",
        transparent: true,
        version: "1.1.0",
        attribution: OPENSEAMAP,
      });
    case "depthContours":
      return L.tileLayer.wms(DEPTH_WMS, {
        layers: "openseamap:contour2,openseamap:contour",
        format: "image/png",
        transparent: true,
        version: "1.1.0",
        attribution: OPENSEAMAP,
      });
    case "grid":
      return coordinateGrid(L, map);
  }
}

/** Adds the saved base and overlays, and a layer switcher under the zoom buttons that remembers what the viewer picks. */
export function addMapLayers(L: LeafletLib, map: LeafletMap): void {
  const choice = readLayerChoice();
  const bases: Record<string, Layer> = {};
  const overlays: Record<string, Layer> = {};
  const baseByLabel = new Map<string, BaseId>();
  const overlayByLabel = new Map<string, OverlayId>();

  for (const item of BASE_LAYERS) {
    const layer = baseLayer(L, item.id);
    bases[item.label] = layer;
    baseByLabel.set(item.label, item.id);
    if (item.id === choice.base) layer.addTo(map);
  }
  for (const item of OVERLAYS) {
    const layer = overlayLayer(L, item.id, map);
    overlays[item.label] = layer;
    overlayByLabel.set(item.label, item.id);
    if (choice.overlays[item.id]) layer.addTo(map);
  }

  L.control.layers(bases, overlays, { position: "topright", collapsed: true, sortLayers: false }).addTo(map);

  map.on("baselayerchange", (event: { name: string }) => {
    const id = baseByLabel.get(event.name);
    if (!id) return;
    choice.base = id;
    saveLayerChoice(choice);
  });
  const setOverlay = (on: boolean) => (event: { name: string }) => {
    const id = overlayByLabel.get(event.name);
    if (!id) return;
    choice.overlays[id] = on;
    saveLayerChoice(choice);
  };
  map.on("overlayadd", setOverlay(true));
  map.on("overlayremove", setOverlay(false));
}
