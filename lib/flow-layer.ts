import type { Control, Layer, Map as LeafletMap } from "leaflet";
import { buildFlowRaster, DEFAULT_CHANNEL_KM, FlowParticles, SCREEN_EXPONENT, velocityAt, cellAt, KIND_LAND, type FlowRaster, type FlowShapes, type FlowVector } from "./flow-raster";
import type { FlowFieldView } from "./flow-wire";

type LeafletLib = typeof import("leaflet");

/** The server actions the layer reads through, passed in by the map so this module stays free of server code. */
export type FlowSource = {
  load: (time: string) => Promise<FlowFieldView>;
  shapes: (wayId: string) => Promise<FlowShapes | null>;
};

/** The map's forecast arrows this hour, by site id: channels' and walls' heading and band speed. */
export type FlowArrows = ReadonlyMap<string, FlowVector>;

export type FlowLayer = {
  layer: Layer;
  /** The hour the map shows and its arrows; the layer loads that hour's field and rebuilds when either changes. */
  setArrows: (time: string, arrows: FlowArrows) => void;
};

/** Below this zoom an atoll is a few pixels wide and the trails would be noise. */
export const FLOW_MIN_ZOOM = 8;
/** On-screen speed: pixels per second for one knot, at every zoom, so the flow reads the same zoomed in or out. */
const PX_PER_KNOT = 22;
/** Trail points kept per particle, one every TRAIL_EVERY_S: about 1 s of path. */
const TRAIL = 16;
const TRAIL_EVERY_S = 0.065;
/** Screen area per particle, px². */
const AREA_PER_PARTICLE = 1100;
const MIN_PARTICLES = 150;
const MAX_PARTICLES = 1400;
/** Phones and small windows: fewer particles, so the map stays smooth and the battery lasts. */
const MAX_PARTICLES_SMALL = 500;
/** Longest step a frame may take; a slow frame or a tab coming back does not throw the particles. */
const MAX_STEP_S = 0.05;

/**
 * Speed classes for drawing (knots, lower bound): slack and drifting, mild, strong, very strong. The edges sit between
 * the band speeds (lib/flow-wire.ts FLOW_KNOTS), so a channel's jet draws in its band's class. Very strong takes the
 * map's stop colour, as the pins do.
 */
export const FLOW_CLASSES: readonly { from: number; label: string; rgb: string; width: number; alpha: number }[] = [
  { from: 0, label: "Slack", rgb: "214, 232, 238", width: 1, alpha: 0.38 },
  { from: 0.4, label: "Mild", rgb: "238, 247, 249", width: 1.1, alpha: 0.55 },
  { from: 1.2, label: "Strong", rgb: "168, 222, 240", width: 1.4, alpha: 0.7 },
  { from: 2, label: "Very strong", rgb: "255, 160, 168", width: 1.7, alpha: 0.8 },
];

export function flowClass(knots: number): number {
  let chosen = 0;
  for (let index = 1; index < FLOW_CLASSES.length; index += 1) if (knots >= FLOW_CLASSES[index].from) chosen = index;
  return chosen;
}

/** The legend's words; the lagoon part is approximate, and none of it is for navigation. */
export const FLOW_NOTE =
  "How the water moves this hour: through the channels and along the outer walls from the forecast. Inside the lagoon the flow is indicative only. Not for navigation.";

/** Trail segments are drawn in this many fading steps from tail to head. */
const FADE_STEPS = 5;


function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function smallScreen(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(max-width: 767px), (pointer: coarse)").matches;
}

/** "Thu 14:00" from a Maldives wall hour. */
function shortHour(time: string): string {
  const [date, clock] = time.split("T");
  const day = new Date(`${date}T00:00:00Z`);
  return `${day.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })} ${clock?.slice(0, 5) ?? ""}`;
}

/**
 * The current-flow layer: particles with fading trails that drift through each atoll at the map's hour, fast through
 * the channels and along the walls, slow in the middle of the lagoon (lib/flow-raster.ts). Drawn on one canvas in its
 * own pane, under the pins. With reduced motion it draws still streamlines instead and redraws only when the map
 * moves. A legend keys the speeds and says how far to trust it.
 */
export function flowLayer(L: LeafletLib, map: LeafletMap, source: FlowSource | undefined): FlowLayer {
  const layer = new L.Layer();
  const paneName = "flowPane";
  let canvas: HTMLCanvasElement | null = null;
  let legend: Control | null = null;
  let parts: { time: HTMLElement; note: HTMLElement } | null = null;
  /** Whether the legend's key and note show; null until the viewer folds or opens it. */
  let legendOpen: boolean | null = null;
  let time: string | null = null;
  let arrows: FlowArrows = new Map();
  let field: FlowFieldView | null = null;
  let fieldFor: string | null = null;
  let loading: Promise<void> | null = null;
  let failed = false;
  /** Rasters built for the current field and arrows, by way id; null while one is being built. */
  let rasters = new Map<string, FlowRaster | null>();
  let active: FlowRaster[] = [];
  let particles: FlowParticles | null = null;
  let frame = 0;
  let last = 0;
  let sinceTrail = 0;
  let zooming = false;
  let buildQueue: string[] = [];
  let buildTimer: ReturnType<typeof setTimeout> | null = null;
  const shapes = new Map<string, Promise<FlowShapes | null>>();
  const motion = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

  const setNote = (text: string) => {
    if (parts) parts.note.textContent = text;
  };

  const shapesFor = (wayId: string): Promise<FlowShapes | null> => {
    let kept = shapes.get(wayId);
    if (!kept) {
      const asked = source ? source.shapes(wayId) : Promise.resolve(null);
      kept = asked;
      shapes.set(wayId, asked);
      asked.catch(() => {
        if (shapes.get(wayId) === asked) shapes.delete(wayId);
      });
    }
    return kept.catch(() => null);
  };

  const on = () => map.hasLayer(layer);

  const viewBox = () => {
    const bounds = map.getBounds();
    return { south: bounds.getSouth(), west: bounds.getWest(), north: bounds.getNorth(), east: bounds.getEast() };
  };

  const sizeCanvas = () => {
    if (!canvas) return;
    const size = map.getSize();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.x * ratio);
    canvas.height = Math.round(size.y * ratio);
    canvas.style.width = `${size.x}px`;
    canvas.style.height = `${size.y}px`;
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
  };

  const particleCount = () => {
    const size = map.getSize();
    const wanted = Math.round((size.x * size.y) / AREA_PER_PARTICLE);
    return Math.max(MIN_PARTICLES, Math.min(smallScreen() ? MAX_PARTICLES_SMALL : MAX_PARTICLES, wanted));
  };

  /** The atolls whose raster reaches into the view. */
  const inView = (): string[] => {
    if (!field) return [];
    const view = viewBox();
    const pad = 0.06;
    return field.atolls
      .filter((atoll) => {
        const box = atollBoxes.get(atoll.wayId);
        return !box || (box.north + pad >= view.south && box.south - pad <= view.north && box.east + pad >= view.west && box.west - pad <= view.east);
      })
      .map((atoll) => atoll.wayId);
  };
  /** Each atoll's outline box, once its shapes are in, so atolls far out of view are not built. */
  const atollBoxes = new Map<string, { south: number; north: number; west: number; east: number }>();

  const refreshActive = () => {
    const wanted = new Set(inView());
    active = [...rasters.values()].filter((raster): raster is FlowRaster => raster != null && wanted.has(raster.wayId));
    particles?.reset();
  };

  /** Builds the next raster in the queue, one per tick, so the map does not stall on a big atoll. */
  const buildNext = () => {
    buildTimer = null;
    const wayId = buildQueue.shift();
    if (!wayId || !field || !on()) return;
    const atoll = field.atolls.find((item) => item.wayId === wayId);
    const builtFor = field;
    if (!atoll || rasters.get(wayId)) {
      scheduleBuild();
      return;
    }
    rasters.set(wayId, null);
    void shapesFor(wayId).then((shape) => {
      if (field !== builtFor) return;
      if (!shape) {
        rasters.delete(wayId);
        scheduleBuild();
        return;
      }
      const box = shape.outline.reduce(
        (acc, [lat, lon]) => ({ south: Math.min(acc.south, lat), north: Math.max(acc.north, lat), west: Math.min(acc.west, lon), east: Math.max(acc.east, lon) }),
        { south: Infinity, north: -Infinity, west: Infinity, east: -Infinity },
      );
      atollBoxes.set(wayId, box);
      const view = viewBox();
      const near = box.north + 0.06 >= view.south && box.south - 0.06 <= view.north && box.east + 0.06 >= view.west && box.west - 0.06 <= view.east;
      if (!near) {
        rasters.delete(wayId);
        scheduleBuild();
        return;
      }
      const channels = atoll.channels.flatMap(({ id, widthM }) => {
        const arrow = arrows.get(id);
        return arrow ? [{ ...arrow, widthKm: widthM != null ? widthM / 1000 : DEFAULT_CHANNEL_KM }] : [];
      });
      const walls = atoll.walls.flatMap((id) => (arrows.get(id) ? [arrows.get(id) as FlowVector] : []));
      rasters.set(wayId, buildFlowRaster(atoll, shape, channels, walls));
      refreshActive();
      start();
      scheduleBuild();
    });
  };

  const scheduleBuild = () => {
    if (buildTimer || buildQueue.length === 0) return;
    buildTimer = setTimeout(buildNext, 0);
  };

  const queueVisible = () => {
    const missing = inView().filter((wayId) => !rasters.has(wayId));
    buildQueue = [...missing, ...buildQueue.filter((wayId) => !missing.includes(wayId))];
    scheduleBuild();
  };

  const loadField = async () => {
    if (!source || !time || fieldFor === time) return;
    const asked = time;
    fieldFor = asked;
    failed = false;
    setNote("Loading the flow…");
    try {
      const next = await source.load(asked);
      if (time !== asked) return;
      field = next;
      rasters = new Map();
      active = [];
      showTime();
      refresh();
    } catch {
      if (time === asked) {
        failed = true;
        fieldFor = null;
        setNote("The flow is unavailable right now");
      }
    }
  };

  const showTime = () => {
    if (parts) parts.time.textContent = field ? shortHour(field.time) : "";
  };

  /** After a move, zoom, new field or new arrows: what to build, and the words in the legend. */
  const refresh = () => {
    if (!on()) return;
    if (!source) return setNote("Not available here");
    if (failed) return;
    if (map.getZoom() < FLOW_MIN_ZOOM) {
      clear();
      return setNote("Zoom in on an atoll to see it");
    }
    if (!field) {
      if (!loading) loading = loadField().finally(() => (loading = null));
      return;
    }
    setNote(field.atolls.length === 0 ? "The flow for this hour is still loading. Move the map in a moment." : FLOW_NOTE);
    refreshActive();
    queueVisible();
    start();
  };

  const clear = () => {
    const context = canvas?.getContext("2d");
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
  };

  /** Canvas pixel offsets for the frame: world pixel (at this zoom) minus these is the canvas position. */
  const projection = () => {
    const zoom = map.getZoom();
    const scale = 256 * 2 ** zoom;
    const origin = map.getPixelOrigin();
    const offset = map.containerPointToLayerPoint([0, 0]);
    return { scale, ox: origin.x + offset.x, oy: origin.y + offset.y };
  };

  const projectX = (lon: number, scale: number) => (scale * (lon + 180)) / 360;
  const projectY = (lat: number, scale: number) => {
    const sin = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
    return scale * (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI));
  };

  /** Draws every particle's trail, grouped by speed class and fade step so it is a few strokes a frame. */
  const drawParticles = (context: CanvasRenderingContext2D, flock: FlowParticles) => {
    const { scale, ox, oy } = projection();
    const paths = FLOW_CLASSES.map(() => Array.from({ length: FADE_STEPS }, () => new Path2D()));
    const trail = flock.trail;
    for (let index = 0; index < flock.count; index += 1) {
      const filled = flock.filled[index];
      const shown = flock.opacity(index);
      if (filled < 1 || shown <= 0) continue;
      const group = paths[flowClass(flock.speed[index])];
      const head = flock.head[index];
      // Oldest first, ending at the particle itself.
      let x = 0;
      let y = 0;
      for (let step = filled - 1; step >= -1; step -= 1) {
        let lat: number;
        let lon: number;
        if (step === -1) {
          lat = flock.lat[index];
          lon = flock.lon[index];
        } else {
          const at = index * trail + ((head - step + trail) % trail);
          lat = flock.trailLat[at];
          lon = flock.trailLon[at];
        }
        const nx = projectX(lon, scale) - ox;
        const ny = projectY(lat, scale) - oy;
        if (step < filled - 1) {
          // The tail fades, and the whole trail with the particle's own fade in and out.
          const fade = Math.min(FADE_STEPS - 1, Math.floor(((filled - 1 - step) / filled) * shown * FADE_STEPS));
          const path = group[fade];
          path.moveTo(x, y);
          path.lineTo(nx, ny);
        }
        x = nx;
        y = ny;
      }
    }
    context.lineCap = "round";
    context.lineJoin = "round";
    FLOW_CLASSES.forEach((style, classIndex) => {
      context.lineWidth = style.width;
      paths[classIndex].forEach((path, fade) => {
        // Eased, so most of the trail is faint and the head is bright.
        const share = (fade + 1) / FADE_STEPS;
        context.strokeStyle = `rgba(${style.rgb}, ${style.alpha * share * share})`;
        context.stroke(path);
      });
    });
  };

  const tick = (now: number) => {
    frame = 0;
    if (!canvas || !on() || zooming || active.length === 0 || map.getZoom() < FLOW_MIN_ZOOM) {
      clear();
      return;
    }
    if (prefersReducedMotion()) {
      drawStill();
      return;
    }
    const seconds = last ? Math.min(MAX_STEP_S, (now - last) / 1000) : 0;
    last = now;
    const count = particleCount();
    if (!particles || particles.count !== count) particles = new FlowParticles(count, TRAIL);
    const view = viewBox();
    const height = map.getSize().y;
    const degPerKnotSecond = (PX_PER_KNOT * (view.north - view.south)) / Math.max(1, height);
    sinceTrail += seconds;
    const record = sinceTrail >= TRAIL_EVERY_S;
    if (record) sinceTrail = 0;
    particles.step(seconds, active, view, degPerKnotSecond, record);
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    const context = canvas.getContext("2d");
    if (!context) return;
    const ratio = canvas.width / Math.max(1, map.getSize().x);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawParticles(context, particles);
    frame = requestAnimationFrame(tick);
  };

  /** Reduced motion: still streamlines from a grid of seeds, each traced a second of animation forward. */
  const drawStill = () => {
    if (!canvas) return;
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    const context = canvas.getContext("2d");
    if (!context) return;
    const size = map.getSize();
    const ratio = canvas.width / Math.max(1, size.x);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const view = viewBox();
    const degPerKnotSecond = (PX_PER_KNOT * (view.north - view.south)) / Math.max(1, size.y);
    const lonScale = 1 / Math.cos((((view.south + view.north) / 2) * Math.PI) / 180);
    const { scale, ox, oy } = projection();
    const spacing = 26;
    const velocity = new Float64Array(2);
    context.lineCap = "round";
    for (let gridY = spacing / 2; gridY < size.y; gridY += spacing) {
      for (let gridX = spacing / 2; gridX < size.x; gridX += spacing) {
        // Seeds jittered by a fixed hash of their place, so the lines do not stand in rows and do not jump on a redraw.
        const hash = Math.sin(gridX * 12.9898 + gridY * 78.233) * 43758.5453;
        const jitter = hash - Math.floor(hash);
        const x = gridX + (jitter - 0.5) * spacing * 0.9;
        const y = gridY + ((jitter * 7.13) % 1 - 0.5) * spacing * 0.9;
        const start = map.containerPointToLatLng([x, y]);
        let lat = start.lat;
        let lon = start.lng;
        const raster = active.find((item) => {
          const cell = cellAt(item, lat, lon);
          return cell >= 0 && item.kind[cell] !== KIND_LAND;
        });
        if (!raster) continue;
        const points: [number, number][] = [[projectX(lon, scale) - ox, projectY(lat, scale) - oy]];
        let speed = 0;
        for (let step = 0; step < 20; step += 1) {
          if (!velocityAt(raster, lat, lon, velocity)) break;
          speed = Math.hypot(velocity[0], velocity[1]);
          const screen = speed > 1e-6 ? speed ** (SCREEN_EXPONENT - 1) : 0;
          const nextLat = lat + velocity[1] * screen * degPerKnotSecond * 0.05;
          const nextLon = lon + velocity[0] * screen * degPerKnotSecond * lonScale * 0.05;
          const from = cellAt(raster, lat, lon);
          const to = cellAt(raster, nextLat, nextLon);
          if (to < 0 || raster.kind[to] === KIND_LAND) break;
          if (from >= 0 && raster.kind[from] !== raster.kind[to] && !raster.gate[from] && !raster.gate[to]) break;
          lat = nextLat;
          lon = nextLon;
          points.push([projectX(lon, scale) - ox, projectY(lat, scale) - oy]);
        }
        if (points.length < 2) continue;
        const style = FLOW_CLASSES[flowClass(speed)];
        const gradient = context.createLinearGradient(points[0][0], points[0][1], points[points.length - 1][0], points[points.length - 1][1]);
        gradient.addColorStop(0, `rgba(${style.rgb}, 0)`);
        gradient.addColorStop(1, `rgba(${style.rgb}, ${style.alpha})`);
        context.strokeStyle = gradient;
        context.lineWidth = style.width;
        context.beginPath();
        context.moveTo(points[0][0], points[0][1]);
        for (const [px, py] of points.slice(1)) context.lineTo(px, py);
        context.stroke();
      }
    }
  };

  const start = () => {
    if (frame || !on() || zooming) return;
    last = 0;
    frame = requestAnimationFrame(tick);
  };

  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };

  const buildLegend = () => {
    const control = new L.Control({ position: "topright" });
    control.onAdd = () => {
      const box = L.DomUtil.create("div", "dive-atlas-legend dive-flow-legend");
      L.DomEvent.disableClickPropagation(box);
      L.DomEvent.disableScrollPropagation(box);
      // The title is a button that folds the key and note away: folded from the start on a phone, where the map is small.
      const head = L.DomUtil.create("button", "dive-atlas-legend-title dive-flow-head", box) as HTMLButtonElement;
      head.type = "button";
      head.append("Current flow ");
      const at = L.DomUtil.create("span", "dive-flow-time", head);
      const chevron = L.DomUtil.create("span", "dive-flow-chevron", head);
      chevron.setAttribute("aria-hidden", "true");
      const body = L.DomUtil.create("div", "dive-flow-body", box);
      body.id = "dive-flow-legend-body";
      head.setAttribute("aria-controls", body.id);
      const list = L.DomUtil.create("ul", "dive-flow-key", body);
      for (const item of FLOW_CLASSES) {
        const row = L.DomUtil.create("li", "", list);
        const swatch = L.DomUtil.create("span", "dive-flow-swatch", row);
        swatch.style.background = `rgb(${item.rgb})`;
        swatch.style.height = `${Math.max(2, Math.round(item.width + 0.5))}px`;
        row.append(item.label);
      }
      const note = L.DomUtil.create("p", "dive-atlas-legend-note dive-flow-note", body);
      const setOpen = (open: boolean) => {
        legendOpen = open;
        body.hidden = !open;
        head.setAttribute("aria-expanded", String(open));
        box.dataset.open = String(open);
      };
      setOpen(legendOpen ?? !smallScreen());
      L.DomEvent.on(head, "click", () => setOpen(!legendOpen));
      parts = { time: at, note };
      showTime();
      return box;
    };
    return control;
  };

  const onZoomStart = () => {
    zooming = true;
    stop();
    if (canvas) canvas.style.visibility = "hidden";
  };
  const onZoomEnd = () => {
    zooming = false;
    if (canvas) canvas.style.visibility = "";
    particles?.clearTrails();
    refresh();
  };
  const onResize = () => {
    sizeCanvas();
    refresh();
  };
  const onMotionChange = () => {
    stop();
    refresh();
  };
  const onMoveEnd = () => {
    if (prefersReducedMotion()) {
      start();
    }
    refresh();
  };

  layer.onAdd = () => {
    if (!map.getPane(paneName)) {
      const pane = map.createPane(paneName);
      pane.style.zIndex = "450";
      pane.style.pointerEvents = "none";
    }
    canvas = L.DomUtil.create("canvas", "dive-flow-canvas", map.getPane(paneName));
    canvas.setAttribute("aria-hidden", "true");
    sizeCanvas();
    legend = buildLegend();
    legend.addTo(map);
    map.on("zoomstart", onZoomStart);
    map.on("zoomend", onZoomEnd);
    map.on("moveend", onMoveEnd);
    map.on("resize", onResize);
    motion?.addEventListener?.("change", onMotionChange);
    refresh();
    return layer;
  };

  layer.onRemove = () => {
    stop();
    map.off("zoomstart", onZoomStart);
    map.off("zoomend", onZoomEnd);
    map.off("moveend", onMoveEnd);
    map.off("resize", onResize);
    motion?.removeEventListener?.("change", onMotionChange);
    if (buildTimer) clearTimeout(buildTimer);
    buildTimer = null;
    buildQueue = [];
    canvas?.remove();
    canvas = null;
    legend?.remove();
    legend = null;
    parts = null;
    particles = null;
    return layer;
  };

  const setArrows = (nextTime: string, next: FlowArrows) => {
    const changedTime = nextTime !== time;
    const changedArrows = !sameArrows(arrows, next);
    time = nextTime;
    arrows = next;
    if (changedTime) {
      field = null;
      fieldFor = null;
      failed = false;
    }
    if (changedTime || changedArrows) {
      rasters = new Map();
      active = [];
      buildQueue = [];
      refresh();
    }
  };

  return { layer, setArrows };
}

function sameArrows(a: FlowArrows, b: FlowArrows): boolean {
  if (a.size !== b.size) return false;
  for (const [id, value] of a) {
    const other = b.get(id);
    if (!other || other.headingDeg !== value.headingDeg || other.knots !== value.knots || other.lat !== value.lat || other.lon !== value.lon) return false;
  }
  return true;
}
