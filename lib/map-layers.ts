import type { Control, Layer, LayerGroup, Map as LeafletMap } from "leaflet";
import {
  decodeRing,
  REEF_ZONE_CLASSES,
  REEF_ZONES_PATH,
  type ReefTileEntry,
  type ReefZoneTile,
} from "./reef-zones";

type LeafletLib = typeof import("leaflet");

/**
 * Map layers a viewer can switch. One base at a time; every overlay on or off on its own.
 * The dive pins are not a layer here: they are always on.
 */
export type BaseId = "satellite" | "street" | "none";
export type OverlayId = "seamarks" | "reefZones" | "depthShading" | "sonarDepths" | "depthContours" | "grid";

export type LayerChoice = { base: BaseId; overlays: Record<OverlayId, boolean> };

export const BASE_LAYERS: readonly { id: BaseId; label: string }[] = [
  { id: "satellite", label: "Satellite" },
  { id: "street", label: "Street map" },
  { id: "none", label: "None" },
];

export const OVERLAYS: readonly { id: OverlayId; label: string; defaultOn: boolean }[] = [
  { id: "seamarks", label: "Seamarks", defaultOn: true },
  { id: "reefZones", label: "Reef zones", defaultOn: false },
  { id: "depthShading", label: "Depth shading", defaultOn: false },
  { id: "sonarDepths", label: "Sonar depths", defaultOn: false },
  { id: "depthContours", label: "Depth contours", defaultOn: false },
  { id: "grid", label: "Coordinate grid", defaultOn: true },
];

/** Overlays drawn as colour fills or labels that clash with satellite imagery; they read best over the street map. */
const NEEDS_STREET_BASE: readonly OverlayId[] = ["depthShading", "depthContours"];

/** The base to show for a choice: depth shading or contours over satellite moves to the street map. None stays none. */
export function readableBase(choice: LayerChoice): BaseId {
  if (choice.base !== "satellite") return choice.base;
  return NEEDS_STREET_BASE.some((id) => choice.overlays[id]) ? "street" : "satellite";
}

export const DEFAULT_LAYER_CHOICE: LayerChoice = {
  base: "satellite",
  overlays: Object.fromEntries(OVERLAYS.map((item) => [item.id, item.defaultOn])) as Record<OverlayId, boolean>,
};

/**
 * v2: the first release saved its defaults on every page load, not only when a viewer chose, so stored v1 values
 * mostly record the old defaults. A new key lets every viewer start from the current ones.
 */
export const LAYER_STORAGE_KEY = "dive-current:map-layers:v2";

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

/** Reef zones are drawn from this zoom; below it a whole atoll's worth of tiles would load at once. */
export const REEF_ZONES_MIN_ZOOM = 11;

/**
 * Allen Coral Atlas reef zones, from the static tiles in public/overlays/reef-zones (npm run reef-zones).
 * Only the tiles in view are fetched, each once, and they are drawn on one canvas under the pins.
 * A legend shows while the layer is on.
 */
function reefZones(L: LeafletLib, map: LeafletMap): LayerGroup {
  const group = L.layerGroup([], {
    attribution: '<a href="https://allencoralatlas.org/">Allen Coral Atlas</a>, CC BY 4.0',
  });
  const renderer = L.canvas({ padding: 0.3 });
  const built = new Map<string, LayerGroup>();
  const requested = new Set<string>();
  let index: Promise<ReefTileEntry[]> | null = null;
  const legend = reefLegend(L, map);

  const tileIndex = () => {
    index ??= fetch(`${REEF_ZONES_PATH}/index.json`)
      .then((response) => (response.ok ? response.json() : { tiles: [] }))
      .then((body: { tiles?: ReefTileEntry[] }) => body.tiles ?? [])
      .catch(() => []);
    return index;
  };

  const buildTile = (zones: ReefZoneTile): LayerGroup =>
    L.layerGroup(
      zones.map(([classIndex, ...rings]) =>
        L.polygon(rings.map(decodeRing), {
          renderer,
          stroke: false,
          fillColor: REEF_ZONE_CLASSES[classIndex]?.color ?? "#ffffff",
          fillOpacity: 0.55,
          interactive: false,
        }),
      ),
    );

  const refresh = async () => {
    if (!map.hasLayer(group)) return;
    const zoomedIn = map.getZoom() >= REEF_ZONES_MIN_ZOOM;
    legend.setZoomedIn(zoomedIn);
    const view = map.getBounds();
    const tiles = zoomedIn ? await tileIndex() : [];
    const wanted = new Set(
      tiles
        .filter((tile) => tile.north >= view.getSouth() && tile.south <= view.getNorth() && tile.east >= view.getWest() && tile.west <= view.getEast())
        .map((tile) => tile.file),
    );
    for (const [file, layer] of built) {
      if (wanted.has(file)) group.addLayer(layer);
      else group.removeLayer(layer);
    }
    for (const file of wanted) {
      if (requested.has(file)) continue;
      requested.add(file);
      fetch(`${REEF_ZONES_PATH}/${file}`)
        .then((response) => (response.ok ? response.json() : []))
        .then((zones: ReefZoneTile) => {
          const layer = buildTile(zones);
          built.set(file, layer);
          if (map.hasLayer(group)) void refresh();
        })
        .catch(() => requested.delete(file)); // try again on the next move
    }
  };

  group.on("add", () => {
    legend.show();
    map.on("moveend", refresh);
    void refresh();
  });
  group.on("remove", () => {
    legend.hide();
    map.off("moveend", refresh);
    group.clearLayers();
  });
  return group;
}

/** A small key to the reef-zone colours, with a hint to zoom in below the drawing zoom. */
function reefLegend(L: LeafletLib, map: LeafletMap) {
  let control: Control | null = null;
  let note: HTMLElement | null = null;
  return {
    show() {
      if (control) return;
      control = new L.Control({ position: "topleft" });
      control.onAdd = () => {
        const box = L.DomUtil.create("div", "dive-reef-legend");
        L.DomEvent.disableClickPropagation(box);
        const title = L.DomUtil.create("p", "dive-reef-legend-title", box);
        title.textContent = "Reef zones";
        note = L.DomUtil.create("p", "dive-reef-legend-note", box);
        note.textContent = "Zoom in to see them";
        const list = L.DomUtil.create("ul", "", box);
        for (const item of REEF_ZONE_CLASSES) {
          if (item.name === "Terrestrial Reef Flat") continue; // not mapped in the Maldives
          const row = L.DomUtil.create("li", "", list);
          const swatch = L.DomUtil.create("span", "dive-reef-swatch", row);
          swatch.style.background = item.color;
          row.append(item.name);
        }
        return box;
      };
      control.addTo(map);
    },
    hide() {
      control?.remove();
      control = null;
      note = null;
    },
    setZoomedIn(zoomedIn: boolean) {
      if (note) note.hidden = zoomedIn;
    },
  };
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
    case "reefZones":
      return reefZones(L, map);
    case "grid":
      return coordinateGrid(L, map);
  }
}

/** Adds the saved base and overlays, and a layer switcher under the zoom buttons that remembers what the viewer picks. */
export function addMapLayers(L: LeafletLib, map: LeafletMap): void {
  const choice = readLayerChoice();
  choice.base = readableBase(choice);
  const bases: Record<string, Layer> = {};
  const overlays: Record<string, Layer> = {};
  const baseById = new Map<BaseId, Layer>();
  const baseByLabel = new Map<string, BaseId>();
  const overlayByLabel = new Map<string, OverlayId>();

  for (const item of BASE_LAYERS) {
    const layer = baseLayer(L, item.id);
    bases[item.label] = layer;
    baseById.set(item.id, layer);
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

  // Leaflet adds layers only once the map has its first view, and removes them all when it is torn down. Both fire
  // the switcher's events, so listen only in between: from the first view (after the initial adds) until unload.
  map.whenReady(() => listenForChoices(map, choice, baseById, baseByLabel, overlayByLabel));
}

function listenForChoices(
  map: LeafletMap,
  choice: LayerChoice,
  baseById: ReadonlyMap<BaseId, Layer>,
  baseByLabel: ReadonlyMap<string, BaseId>,
  overlayByLabel: ReadonlyMap<string, OverlayId>,
): void {
  let unloading = false;
  map.on("unload", () => {
    unloading = true;
  });

  map.on("baselayerchange", (event: { name: string }) => {
    if (unloading) return;
    const id = baseByLabel.get(event.name);
    if (!id) return;
    choice.base = id;
    saveLayerChoice(choice);
  });
  const setOverlay = (on: boolean) => (event: { name: string }) => {
    if (unloading) return;
    const id = overlayByLabel.get(event.name);
    if (!id) return;
    choice.overlays[id] = on;
    saveLayerChoice(choice);
    const next = readableBase(choice);
    if (next === choice.base) return;
    // After the switcher finishes this click, so it redraws its radio buttons for the new base.
    const from = baseById.get(choice.base);
    const to = baseById.get(next);
    setTimeout(() => {
      if (unloading) return;
      if (from) map.removeLayer(from);
      if (to) map.addLayer(to); // fires baselayerchange, which saves the new base
    }, 0);
  };
  map.on("overlayadd", setOverlay(true));
  map.on("overlayremove", setOverlay(false));
}
