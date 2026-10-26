import type { Control, LeafletMouseEvent, Map as LeafletMap } from "leaflet";
import type { RimRing } from "./rim";
import { seaDetail } from "./sea-text";
import { FIELD_NONE, FIELD_STEP_M, FIELD_UNKNOWN } from "./shelter-field";
import { SEA_BAND_LIMITS_M, type SeaStateHour } from "./types";

type LeafletLib = typeof import("leaflet");

/** One atoll's felt height on its grid, as the getShelter action sends it. */
export type ShelterAtollField = {
  wayId: string;
  south: number;
  west: number;
  stepDeg: number;
  rows: number;
  columns: number;
  values: string;
};
export type ShelterFieldView = { time: string; hours: string[]; atolls: ShelterAtollField[]; stale: boolean };
export type ShelterShapes = { outline: RimRing; islands: RimRing[] };

/** The server actions the layer reads through, passed in by the map so this module stays free of server code. */
export type ShelterSource = {
  load: (view: { south: number; west: number; north: number; east: number }, time?: string) => Promise<ShelterFieldView>;
  shapes: (wayId: string) => Promise<ShelterShapes | null>;
  point: (lat: number, lon: number, time: string) => Promise<SeaStateHour | "unknown" | null>;
};

/** Below this zoom an atoll is a few pixels of shading and not worth the fetch. */
const MIN_ZOOM = 8;
/** Shading opacity over the satellite base: strong enough to read, light enough to see the reef through. */
const OPACITY = 0.75;
/** The colour scale's top, metres of felt height; anything higher is drawn as this. */
const SCALE_MAX_M = 2;

/**
 * Colour stops on felt height: green while calm, through yellow and orange at the band limits, to red when rough and
 * a deeper red past it. Between stops the colour is blended, so the shading shows how much calmer one place is than
 * the next, not only which band it falls in.
 */
const STOPS: { m: number; rgb: [number, number, number] }[] = [
  { m: 0, rgb: [38, 166, 120] },
  { m: SEA_BAND_LIMITS_M.calm, rgb: [226, 205, 64] },
  { m: SEA_BAND_LIMITS_M.moderate, rgb: [240, 140, 52] },
  { m: SEA_BAND_LIMITS_M.choppy, rgb: [220, 56, 60] },
  { m: SCALE_MAX_M, rgb: [150, 20, 50] },
];

export function feltColor(feltM: number): [number, number, number] {
  const m = Math.max(0, Math.min(SCALE_MAX_M, feltM));
  for (let index = 1; index < STOPS.length; index += 1) {
    const low = STOPS[index - 1];
    const high = STOPS[index];
    if (m > high.m) continue;
    const share = (m - low.m) / (high.m - low.m);
    return [0, 1, 2].map((channel) => Math.round(low.rgb[channel] + (high.rgb[channel] - low.rgb[channel]) * share)) as [
      number,
      number,
      number,
    ];
  }
  return STOPS[STOPS.length - 1].rgb;
}

/** The legend's colour bar as a CSS gradient over 0 to SCALE_MAX_M. */
export function scaleGradient(): string {
  const stops = STOPS.map(({ m, rgb }) => `rgb(${rgb.join(",")}) ${Math.round((m / SCALE_MAX_M) * 100)}%`);
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

/** How many cells deep the field is extended past the water's edge, so the smoothed edge is full colour up to the cut. */
const EDGE_FILL_STEPS = 3;

/**
 * The field as RGBA pixels, one per cell, row 0 at the top (north). Cells with no water (land, past the outline) take
 * the mean of their water neighbours, a few cells deep, so the shading runs right up to the coast before the map cuts
 * it there; cells of unknown sea state stay clear.
 */
export function fieldPixels(rows: number, columns: number, values: Uint8Array): Uint8ClampedArray {
  const felt = new Float32Array(rows * columns).fill(Number.NaN);
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] !== FIELD_NONE && values[index] !== FIELD_UNKNOWN) felt[index] = values[index] * FIELD_STEP_M;
  }
  for (let step = 0; step < EDGE_FILL_STEPS; step += 1) {
    const next = felt.slice();
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;
        if (values[index] !== FIELD_NONE || !Number.isNaN(felt[index])) continue;
        let sum = 0;
        let count = 0;
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
          const r = row + dr;
          const c = column + dc;
          if (r < 0 || r >= rows || c < 0 || c >= columns) continue;
          const value = felt[r * columns + c];
          if (Number.isNaN(value)) continue;
          sum += value;
          count += 1;
        }
        if (count > 0) next[index] = sum / count;
      }
    }
    felt.set(next);
  }
  const pixels = new Uint8ClampedArray(rows * columns * 4);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const value = felt[row * columns + column];
      if (Number.isNaN(value)) continue;
      const at = ((rows - 1 - row) * columns + column) * 4;
      const [r, g, b] = feltColor(value);
      pixels[at] = r;
      pixels[at + 1] = g;
      pixels[at + 2] = b;
      pixels[at + 3] = 255;
    }
  }
  return pixels;
}

/** "Mon", "26 Oct" and "14:00" from a Maldives wall hour. */
function hourParts(time: string): { weekday: string; dayMonth: string; clock: string } {
  const [date, clock] = time.split("T");
  const day = new Date(`${date}T00:00:00Z`);
  return {
    weekday: day.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }),
    dayMonth: day.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }),
    clock,
  };
}

/** "Mon 26 Oct, 14:00" from a Maldives wall hour. */
export function hourLabel(time: string): string {
  const { weekday, dayMonth, clock } = hourParts(time);
  return `${weekday} ${dayMonth}, ${clock}`;
}

type Drawn = { field: ShelterAtollField; image: HTMLCanvasElement; shapes: ShelterShapes | null };

/**
 * The sheltered-water layer: each atoll's lagoon shaded by felt wave height at the chosen hour, smoothed between the
 * 500 m cells and cut exactly to water (inside the atoll outline, islands left clear). A legend steps through the
 * hours; tapping the water traces that exact spot and shows its sea state.
 */
export function shelterLayer(L: LeafletLib, map: LeafletMap, source: ShelterSource | undefined) {
  const layer = new L.Layer();
  let canvas: HTMLCanvasElement | null = null;
  let legend: Control | null = null;
  let parts: { time: HTMLElement; note: HTMLElement; back: HTMLButtonElement; next: HTMLButtonElement; now: HTMLButtonElement } | null = null;
  let drawn: Drawn[] = [];
  let view: ShelterFieldView | null = null;
  let chosen: string | undefined;
  let request = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const shapes = new Map<string, Promise<ShelterShapes | null>>();
  const images = new Map<string, HTMLCanvasElement>();

  const setNote = (text: string) => {
    if (parts) parts.note.textContent = text;
  };

  const shapesFor = (wayId: string) => {
    let kept = shapes.get(wayId);
    if (!kept) {
      kept = source ? source.shapes(wayId).catch(() => null) : Promise.resolve(null);
      shapes.set(wayId, kept);
    }
    return kept;
  };

  const imageFor = (field: ShelterAtollField, time: string) => {
    const key = `${field.wayId}|${time}|${field.values.length}|${field.values.slice(0, 32)}`;
    let image = images.get(key);
    if (image) return image;
    const bytes = Uint8Array.from(atob(field.values), (char) => char.charCodeAt(0));
    image = document.createElement("canvas");
    image.width = field.columns;
    image.height = field.rows;
    const context = image.getContext("2d");
    if (context) {
      context.putImageData(new ImageData(fieldPixels(field.rows, field.columns, bytes) as ImageDataArray, field.columns, field.rows), 0, 0);
    }
    if (images.size > 40) images.clear();
    images.set(key, image);
    return image;
  };

  const draw = () => {
    if (!canvas) return;
    const size = map.getSize();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.x * ratio);
    canvas.height = Math.round(size.y * ratio);
    canvas.style.width = `${size.x}px`;
    canvas.style.height = `${size.y}px`;
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.x, size.y);
    context.globalAlpha = OPACITY;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    for (const { field, image, shapes: shape } of drawn) {
      if (!shape) continue;
      context.save();
      context.beginPath();
      for (const ring of [shape.outline, ...shape.islands]) {
        ring.forEach(([lat, lon], index) => {
          const point = map.latLngToContainerPoint([lat, lon]);
          if (index === 0) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        });
        context.closePath();
      }
      // Islands sit inside the outline, so even-odd leaves them as holes.
      context.clip("evenodd");
      const northWest = map.latLngToContainerPoint([field.south + field.rows * field.stepDeg, field.west]);
      const southEast = map.latLngToContainerPoint([field.south, field.west + field.columns * field.stepDeg]);
      context.drawImage(image, northWest.x, northWest.y, southEast.x - northWest.x, southEast.y - northWest.y);
      context.restore();
    }
  };

  const showTime = () => {
    if (!parts) return;
    const hours = view?.hours ?? [];
    const at = view ? hours.indexOf(view.time) : -1;
    parts.time.textContent = "";
    if (view) {
      // On a phone the date drops out (CSS), leaving "Mon 14:00".
      const { weekday, dayMonth, clock } = hourParts(view.time);
      const date = document.createElement("span");
      date.className = "dive-shelter-date";
      date.textContent = ` ${dayMonth},`;
      parts.time.append(weekday, date, ` ${clock}`);
    }
    parts.back.disabled = at <= 0;
    parts.next.disabled = at < 0 || at >= hours.length - 1;
    parts.now.disabled = at <= 0;
  };

  const refresh = async () => {
    if (!map.hasLayer(layer)) return;
    if (!source) return setNote("Not available here");
    if (map.getZoom() < MIN_ZOOM) {
      drawn = [];
      draw();
      return setNote("Zoom in on an atoll to see it");
    }
    const mine = ++request;
    const bounds = map.getBounds();
    let next: ShelterFieldView;
    try {
      next = await source.load({ south: bounds.getSouth(), west: bounds.getWest(), north: bounds.getNorth(), east: bounds.getEast() }, chosen);
    } catch {
      if (mine === request) setNote("Sea state is unavailable right now");
      return;
    }
    const withShapes = await Promise.all(
      next.atolls.map(async (field) => ({ field, image: imageFor(field, next.time), shapes: await shapesFor(field.wayId) })),
    );
    if (mine !== request || !map.hasLayer(layer)) return;
    view = next;
    drawn = withShapes;
    draw();
    showTime();
    const unknown = next.atolls.some((field) => atob(field.values).includes(String.fromCharCode(FIELD_UNKNOWN)));
    setNote(
      next.atolls.length === 0
        ? "Waves for this area are still loading. Move the map in a moment."
        : [next.stale ? "From old wave data." : "", unknown ? "Clear patches: no wave or wind data for that hour." : "", "Tap the water for details."]
            .filter(Boolean)
            .join(" "),
    );
  };

  const soon = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 120);
  };

  const step = (by: number) => {
    const hours = view?.hours ?? [];
    const at = view ? hours.indexOf(view.time) : -1;
    const target = hours[at + by];
    if (!target) return;
    chosen = target;
    void refresh();
  };

  const onClick = async (event: LeafletMouseEvent) => {
    if (!source || !view || map.getZoom() < MIN_ZOOM) return;
    const { lat, lng } = event.latlng;
    const time = view.time;
    const hour = await source.point(lat, lng, time).catch(() => "unknown" as const);
    if (hour == null || !map.hasLayer(layer)) return;
    const box = document.createElement("div");
    box.className = "dive-shelter-popup";
    const head = document.createElement("p");
    head.className = "dive-shelter-popup-head";
    const body = document.createElement("p");
    if (hour === "unknown") {
      head.textContent = "Sea state unknown";
      body.textContent = `No wave or wind data here for ${hourLabel(time)}.`;
    } else {
      head.textContent = `${hour.band[0].toUpperCase()}${hour.band.slice(1)} · ${hour.feltM.toFixed(1)} m felt`;
      body.textContent = `${seaDetail(hour)}. ${hourLabel(time)}.`;
    }
    box.append(head, body);
    L.popup({ maxWidth: 260 }).setLatLng(event.latlng).setContent(box).openOn(map);
  };

  const buildLegend = () => {
    const control = new L.Control({ position: "topright" });
    control.onAdd = () => {
      const box = L.DomUtil.create("div", "dive-atlas-legend dive-shelter-legend");
      L.DomEvent.disableClickPropagation(box);
      L.DomEvent.disableScrollPropagation(box);
      const title = L.DomUtil.create("p", "dive-atlas-legend-title", box);
      title.textContent = "Sea state in the atolls";
      const row = L.DomUtil.create("div", "dive-shelter-time", box);
      const back = L.DomUtil.create("button", "", row) as HTMLButtonElement;
      back.type = "button";
      back.textContent = "‹";
      back.setAttribute("aria-label", "Earlier hour");
      const time = L.DomUtil.create("span", "", row);
      const next = L.DomUtil.create("button", "", row) as HTMLButtonElement;
      next.type = "button";
      next.textContent = "›";
      next.setAttribute("aria-label", "Later hour");
      const now = L.DomUtil.create("button", "dive-shelter-now", row) as HTMLButtonElement;
      now.type = "button";
      now.textContent = "Now";
      back.onclick = () => step(-1);
      next.onclick = () => step(1);
      now.onclick = () => {
        chosen = undefined;
        void refresh();
      };
      const bar = L.DomUtil.create("div", "dive-shelter-bar", box);
      bar.style.background = scaleGradient();
      const ticks = L.DomUtil.create("div", "dive-shelter-ticks", box);
      for (const [label, m] of [
        ["Calm", 0],
        ["Moderate", SEA_BAND_LIMITS_M.calm],
        ["Choppy", SEA_BAND_LIMITS_M.moderate],
        ["Rough", SEA_BAND_LIMITS_M.choppy],
      ] as const) {
        // On a phone only the scale's ends are named; the colours between speak for themselves.
        const tick = L.DomUtil.create("span", m > 0 && m < SEA_BAND_LIMITS_M.choppy ? "dive-shelter-tick-mid" : "", ticks);
        tick.style.left = `${(m / SCALE_MAX_M) * 100}%`;
        tick.textContent = label;
        if (m > 0) L.DomUtil.create("small", "", tick).textContent = `${m.toFixed(1)} m`;
      }
      const note = L.DomUtil.create("p", "dive-atlas-legend-note dive-shelter-note", box);
      parts = { time, note, back, next, now };
      showTime();
      return box;
    };
    return control;
  };

  layer.onAdd = () => {
    canvas = L.DomUtil.create("canvas", "leaflet-zoom-hide dive-shelter-canvas", map.getPane("overlayPane"));
    canvas.style.pointerEvents = "none";
    legend = buildLegend();
    legend.addTo(map);
    map.on("moveend resize", soon);
    map.on("zoomend", draw);
    map.on("click", onClick);
    void refresh();
    return layer;
  };
  layer.onRemove = () => {
    canvas?.remove();
    canvas = null;
    legend?.remove();
    legend = null;
    parts = null;
    drawn = [];
    view = null;
    chosen = undefined;
    request += 1;
    map.off("moveend resize", soon);
    map.off("zoomend", draw);
    map.off("click", onClick);
    return layer;
  };
  return layer;
}
