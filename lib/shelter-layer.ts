import type { Control, Layer, Map as LeafletMap } from "leaflet";
import type { RimRing } from "./rim";
import { seaDetail } from "./sea-text";
import { FIELD_LAND, FIELD_NONE, FIELD_OTHER, FIELD_OUTSIDE, FIELD_STEP_M, FIELD_UNKNOWN } from "./shelter-field";
import { SEA_BAND_LIMITS_M, type SeaStateHour } from "./types";

type LeafletLib = typeof import("leaflet");

/** One atoll's felt height on one of its grids, as the getShelter action sends it. */
export type ShelterAtollField = {
  wayId: string;
  layer: "coarse" | "fine";
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
const OPACITY = 0.85;
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

/** The sea outside the atolls fades out over this many 500 m cells toward the layer's edge. */
const SEA_FADE_STEPS = 4;
/** The 125 m cells fade out over their last cell, so where they end the 500 m field beneath takes over smoothly. */
const FINE_FADE_STEPS = 2;
/** How many cells deep the field is extended past the water's edge, so the smoothed edge is full colour up to the cut. */
const EDGE_FILL_STEPS = 3;

/**
 * One side of the outline's field (the lagoon, or the sea outside when `outside`) as RGBA pixels, one per cell, row 0
 * at the top (north). Islands and the other side's water take the mean of their neighbours on this side, a few cells
 * deep, so the shading runs right up to the coast and the reef before the map cuts it there. Cells of unknown sea
 * state, another atoll's water and cells past the grid stay clear. With `fadeSteps`, the shading fades out over that
 * many cells toward the grid's outer edge, so the open sea has no hard line where the layer ends.
 */
export function fieldPixels(rows: number, columns: number, values: Uint8Array, outside = false, fadeSteps = 0): Uint8ClampedArray {
  const felt = new Float32Array(rows * columns).fill(Number.NaN);
  const fillable = new Uint8Array(rows * columns);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === FIELD_NONE || value === FIELD_OTHER) continue;
    const mine = value !== FIELD_LAND && (value >= FIELD_OUTSIDE) === outside;
    const low = value & ~FIELD_OUTSIDE;
    if (!mine) fillable[index] = 1;
    else if (low !== FIELD_UNKNOWN) felt[index] = low * FIELD_STEP_M;
  }
  for (let step = 0; step < EDGE_FILL_STEPS; step += 1) {
    const next = felt.slice();
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;
        if (!fillable[index] || !Number.isNaN(felt[index])) continue;
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
  // Distance in cells from the grid's edge (0 on it), up to fadeSteps. Diagonal steps count √2, so the fade follows
  // the band's round edge rather than the cells' staircase.
  const fromEdge = new Float32Array(rows * columns).fill(fadeSteps);
  for (let index = 0; index < values.length; index += 1) if (values[index] === FIELD_NONE) fromEdge[index] = 0;
  for (let pass = 0; pass < 2 * fadeSteps; pass += 1) {
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        let best = fromEdge[row * columns + column];
        for (let dr = -1; dr <= 1; dr += 1) {
          for (let dc = -1; dc <= 1; dc += 1) {
            const r = row + dr;
            const c = column + dc;
            if (r < 0 || r >= rows || c < 0 || c >= columns || (dr === 0 && dc === 0)) continue;
            best = Math.min(best, fromEdge[r * columns + c] + (dr !== 0 && dc !== 0 ? Math.SQRT2 : 1));
          }
        }
        fromEdge[row * columns + column] = best;
      }
    }
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
      pixels[at + 3] = fadeSteps > 0 ? Math.round((255 * Math.min(fadeSteps, fromEdge[row * columns + column])) / fadeSteps) : 255;
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

/** A field drawn as two images, the lagoon and the sea outside, each cut to its side of the outline. */
type Drawn = { field: ShelterAtollField; inner: HTMLCanvasElement; outer: HTMLCanvasElement; shapes: ShelterShapes | null };

/**
 * The sheltered-water layer: each atoll's lagoon and the sea for a few km round it shaded by felt wave height at the
 * chosen hour, smoothed between the 500 m cells (125 m near islands once zoomed in) and cut exactly to water: islands
 * left clear, and the reef a sharp line between the lagoon and the sea. A legend steps through the hours; tapping the
 * water (through `read`, which the map's click handler calls) traces that exact spot and shows its sea state.
 */
/** The layer, and its tap readout for the map's click handler. */
export type ShelterLayer = { layer: Layer; read: (lat: number, lon: number) => boolean };

export function shelterLayer(L: LeafletLib, map: LeafletMap, source: ShelterSource | undefined): ShelterLayer {
  const layer = new L.Layer();
  let canvas: HTMLCanvasElement | null = null;
  let work: HTMLCanvasElement | null = null;
  let legend: Control | null = null;
  let parts: { time: HTMLElement; note: HTMLElement; back: HTMLButtonElement; next: HTMLButtonElement; now: HTMLButtonElement } | null = null;
  let drawn: Drawn[] = [];
  let view: ShelterFieldView | null = null;
  let chosen: string | undefined;
  let request = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const shapes = new Map<string, Promise<ShelterShapes | null>>();

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

  // The images drawn for the current response; a new response always paints afresh.
  const imageFor = (field: ShelterAtollField, outside: boolean) => {
    const bytes = Uint8Array.from(atob(field.values), (char) => char.charCodeAt(0));
    const image = document.createElement("canvas");
    image.width = field.columns;
    image.height = field.rows;
    const context = image.getContext("2d");
    if (context) {
      const fade = field.layer === "fine" ? FINE_FADE_STEPS : outside ? SEA_FADE_STEPS : 0;
      const pixels = fieldPixels(field.rows, field.columns, bytes, outside, fade);
      context.putImageData(new ImageData(pixels as ImageDataArray, field.columns, field.rows), 0, 0);
    }
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
    work ??= document.createElement("canvas");
    work.width = canvas.width;
    work.height = canvas.height;
    const scratch = work.getContext("2d");
    if (!context || !scratch) return;
    scratch.setTransform(ratio, 0, 0, ratio, 0, 0);
    scratch.imageSmoothingEnabled = true;
    scratch.imageSmoothingQuality = "high";
    const trace = (ring: RimRing) => {
      ring.forEach(([lat, lon], index) => {
        const point = map.latLngToContainerPoint([lat, lon]);
        if (index === 0) scratch.moveTo(point.x, point.y);
        else scratch.lineTo(point.x, point.y);
      });
      scratch.closePath();
    };
    const screen = () => scratch.rect(-size.x, -size.y, 3 * size.x, 3 * size.y);
    const paint = ({ field, inner, outer, shapes: shape }: Drawn, outside: boolean) => {
      if (!shape) return;
      scratch.save();
      // Islands are holes in the screen; the lagoon is inside the outline, the sea is the screen less the outline.
      scratch.beginPath();
      screen();
      shape.islands.forEach(trace);
      scratch.clip("evenodd");
      scratch.beginPath();
      if (outside) screen();
      trace(shape.outline);
      scratch.clip("evenodd");
      const northWest = map.latLngToContainerPoint([field.south + field.rows * field.stepDeg, field.west]);
      const southEast = map.latLngToContainerPoint([field.south, field.west + field.columns * field.stepDeg]);
      scratch.drawImage(outside ? outer : inner, northWest.x, northWest.y, southEast.x - northWest.x, southEast.y - northWest.y);
      scratch.restore();
    };
    const coarse = drawn.filter(({ field }) => field.layer === "coarse");
    const fine = drawn.filter(({ field }) => field.layer === "fine");
    // Neighbouring atolls' seas meet where each fades out; added together the two fades make one even shade.
    scratch.globalCompositeOperation = "lighter";
    for (const item of coarse) paint(item, true);
    scratch.globalCompositeOperation = "source-over";
    for (const item of coarse) paint(item, false);
    // The 125 m cells near islands over the 500 m ones; they fade out where they end.
    for (const item of fine) {
      paint(item, true);
      paint(item, false);
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.globalAlpha = OPACITY;
    context.drawImage(work, 0, 0);
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
      next.atolls.map(async (field) => ({
        field,
        inner: imageFor(field, false),
        outer: imageFor(field, true),
        shapes: await shapesFor(field.wayId),
      })),
    );
    if (mine !== request || !map.hasLayer(layer)) return;
    view = next;
    drawn = withShapes;
    draw();
    showTime();
    const unknown = next.atolls.some((field) =>
      Array.from(atob(field.values)).some((char) => (char.charCodeAt(0) & ~FIELD_OUTSIDE) === FIELD_UNKNOWN),
    );
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

  /**
   * Reads the sea state at a tapped spot and shows it in a popup. The map's own click handler calls this (it decides
   * what a click means: placing a pin, dismissing a ring, or this). True when the layer took the tap.
   */
  const read = (lat: number, lon: number): boolean => {
    if (!source || !view || !map.hasLayer(layer) || map.getZoom() < MIN_ZOOM) return false;
    const time = view.time;
    void source
      .point(lat, lon, time)
      .catch(() => "unknown" as const)
      .then((hour) => {
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
        L.popup({ maxWidth: 260 }).setLatLng([lat, lon]).setContent(box).openOn(map);
      });
    return true;
  };

  const buildLegend = () => {
    const control = new L.Control({ position: "topright" });
    control.onAdd = () => {
      const box = L.DomUtil.create("div", "dive-atlas-legend dive-shelter-legend");
      L.DomEvent.disableClickPropagation(box);
      L.DomEvent.disableScrollPropagation(box);
      const title = L.DomUtil.create("p", "dive-atlas-legend-title", box);
      title.textContent = "Sea state";
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
    void refresh();
    return layer;
  };
  layer.onRemove = () => {
    canvas?.remove();
    canvas = null;
    work = null;
    legend?.remove();
    legend = null;
    parts = null;
    drawn = [];
    view = null;
    chosen = undefined;
    request += 1;
    map.off("moveend resize", soon);
    map.off("zoomend", draw);
    return layer;
  };
  return { layer, read };
}
