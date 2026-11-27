/**
 * The current-flow animation's field, built in the browser for one atoll at one hour, and the particles that drift
 * through it. Pure code (no DOM, no Leaflet), so tests can drive it.
 *
 * The field is a raster of about 200 m cells over the atoll and a few km of sea round it. Each cell holds a velocity in
 * knots and what is there: open sea, lagoon or land. It keeps to three physical rules: water does not cross the reef
 * except through a channel; what a channel carries is drawn in from a wide fan on its upstream side and leaves as a jet
 * that widens and slows downstream (momentum kept, as in a plane jet); and the lagoon's own currents are as slow as the
 * channels' flow spread over the lagoon makes them (continuity). Made of, in order:
 *  - inside the outline, the lagoon model's flow pattern (FlowAtoll.lagoon), scaled so that just inside each running
 *    channel it matches the speed that channel's water has once spread over a half circle (lagoonScale);
 *  - outside, the ocean model's surface current, blended from the ring points of this atoll and its neighbours (the
 *    points the forecast already fetches, so the open sea costs no extra requests);
 *  - on both sides of the reef, the part running at the reef taken away close to it, so the water slides along it;
 *    outside, within WALL_BAND_KM, turned to the along-reef model's current at the ring points (FlowAtoll.reef);
 *  - at each channel (every reef gap, and catalog channel sites in no gap), a sink fan upstream (speed falling as 1/r)
 *    and a jet downstream along its heading, both as wide as the gap. Only the channels are gates: a particle crosses
 *    the reef nowhere else.
 * The open sea between the atolls is one more, coarser raster (buildSeaRaster); particles pass between it and the
 * atolls' rasters.
 */
import { decodeVectors, type FlowAtoll } from "./flow-wire";
import type { RimRing } from "./rim";

export const KIND_SEA = 0;
export const KIND_LAGOON = 1;
export const KIND_LAND = 2;

const KM_PER_DEG_LAT = 110.57;
const KM_PER_DEG_LON = 111.32;
/** Sea drawn round the outline. */
export const SEA_MARGIN_KM = 6;
const CELL_KM = 0.2;
/** A raster never has more cells than this; a big atoll gets coarser cells. */
const MAX_CELLS = 160_000;
/** Within this of the reef, outside, the ocean current is turned to run along it. */
export const WALL_BAND_KM = 2.5;
/** Inside, the flow at the reef is turned along it over this distance: the rim is closed except at the channels. */
const LAGOON_EDGE_KM = 0.8;
/** With no along-reef samples (old saved fields), the ocean's along-reef part is sped up by this much near the reef. */
const WALL_GAIN = 1.4;
/** The open-sea raster's cells, km, and its most cells. The ring points are a few km apart round each atoll and tens of
 * km apart between them, so finer cells would show nothing more. */
const SEA_CELL_KM = 2;
const MAX_SEA_CELLS = 200_000;
/** A channel's width when the catalog has none, and the range a width is held to, km. */
export const DEFAULT_CHANNEL_KM = 0.4;
const CHANNEL_KM_RANGE: readonly [number, number] = [0.1, 2];
/** The upstream fan reaches this far, km. */
const FAN_KM = 2;
/** The downstream jet: how far it is drawn (km), and its half-width's growth per km (a plane jet's is about 0.1). */
const JET_DOWN_KM = 4;
const JET_SPREAD = 0.11;
/** Lagoon speeds are sampled this far inside each channel to scale the lagoon flow (km). */
const SCALE_AT_KM = 2;
/** The lagoon scale when no channel is running to set it, and the range it is held to. */
const DEFAULT_LAGOON_SCALE = 0.3;
const LAGOON_SCALE_RANGE: readonly [number, number] = [0.05, 1];
/** Channels slower than this feed no particles of their own: slack water has no stream to show. */
const FEED_MIN_KNOTS = 0.4;
/** The share of new particles fed into a channel's stream when one is in view. */
export const FEED_SHARE = 0.25;
/** A fed particle starts at most this far out in the channel's upstream fan, km. */
const FEED_KM = 0.6;
/**
 * Particles move on screen at knots^SCREEN_EXPONENT: the lagoon's few hundredths of a knot would otherwise stand still
 * beside a channel's two knots. Faster water still moves faster; the legend's colours give the band.
 */
export const SCREEN_EXPONENT = 0.6;
/** A particle fades in over this long after it appears, and out over FADE_OUT_S before it goes, seconds. */
const FADE_IN_S = 0.5;
const FADE_OUT_S = 0.7;

/** A site's forecast arrow on the map: where it is, where the water heads, and how fast (knots). */
export type FlowVector = { lat: number; lon: number; headingDeg: number; knots: number };
/** A channel's arrow and its width (km), from the catalog's measured width or DEFAULT_CHANNEL_KM. */
export type FlowChannel = FlowVector & { widthKm: number };
export type FlowShapes = { outline: RimRing; islands: readonly RimRing[] };

export type FlowRaster = {
  wayId: string;
  /** The open sea between the atolls (buildSeaRaster): a particle on it moves to an atoll's raster where one covers it. */
  regional?: boolean;
  south: number;
  west: number;
  north: number;
  east: number;
  stepLat: number;
  stepLon: number;
  rows: number;
  columns: number;
  /** Knots, row-major from the south-west cell. */
  vEast: Float32Array;
  vNorth: Float32Array;
  kind: Uint8Array;
  gate: Uint8Array;
  /** The channels running at least mild this hour: where particles are fed in, so each channel shows its stream. */
  jets: { lat: number; lon: number; east: number; north: number; widthKm: number }[];
};

type Frame = { refLat: number; kmLon: number };

/** The ocean model's surface current at ring sample points (FlowAtoll.ocean), knots: the open sea is blended from them. */
export type OceanPoint = FlowAtoll["ocean"][number];
/** Open-sea points farther than this from an atoll's box add nothing to its raster, km. */
const OCEAN_NEAR_KM = 80;
/**
 * Softening of the inverse-distance weights, km²: a point's pull falls as 1/(d² + this), so close to the reef each ring
 * point's own current shows and between the atolls the points on both sides blend smoothly.
 */
const OCEAN_SOFT_KM2 = 25;

type LagoonGrid = Omit<NonNullable<FlowAtoll["lagoon"]>, "vectors">;

function bilinear(grid: LagoonGrid, values: Float32Array, lat: number, lon: number): number {
  const y = (lat - grid.south) / grid.stepLat - 0.5;
  const x = (lon - grid.west) / grid.stepLon - 0.5;
  const row = Math.max(0, Math.min(grid.rows - 2, Math.floor(y)));
  const column = Math.max(0, Math.min(grid.columns - 2, Math.floor(x)));
  const fy = Math.max(0, Math.min(1, y - row));
  const fx = Math.max(0, Math.min(1, x - column));
  const at = (r: number, c: number) => values[r * grid.columns + c] ?? 0;
  const low = at(row, column) * (1 - fx) + at(row, column + 1) * fx;
  const high = at(row + 1, column) * (1 - fx) + at(row + 1, column + 1) * fx;
  return low * (1 - fy) + high * fy;
}

/** Marks the cells whose centres a ring encloses, row by row (even-odd crossings). */
function fillRing(raster: FlowRaster, ring: RimRing, value: number): void {
  const { south, west, stepLat, stepLon, rows, columns, kind } = raster;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lat] of ring) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  const firstRow = Math.max(0, Math.floor((minLat - south) / stepLat - 0.5));
  const lastRow = Math.min(rows - 1, Math.ceil((maxLat - south) / stepLat - 0.5));
  const crossings: number[] = [];
  for (let row = firstRow; row <= lastRow; row += 1) {
    const lat = south + (row + 0.5) * stepLat;
    crossings.length = 0;
    for (let index = 0; index + 1 < ring.length; index += 1) {
      const [lat1, lon1] = ring[index];
      const [lat2, lon2] = ring[index + 1];
      if (lat1 > lat !== lat2 > lat) crossings.push(lon1 + ((lon2 - lon1) * (lat - lat1)) / (lat2 - lat1));
    }
    crossings.sort((a, b) => a - b);
    for (let pair = 0; pair + 1 < crossings.length; pair += 2) {
      const from = Math.max(0, Math.ceil((crossings[pair] - west) / stepLon - 0.5));
      const to = Math.min(columns - 1, Math.floor((crossings[pair + 1] - west) / stepLon - 0.5));
      for (let column = from; column <= to; column += 1) kind[row * columns + column] = value;
    }
  }
}

/**
 * Distance (km) from each cell within `bandKm` of the ring to its nearest segment, and that segment's direction as a
 * unit east/north vector. Cells farther away keep Infinity.
 */
function reefBand(raster: FlowRaster, ring: RimRing, bandKm: number, frame: Frame) {
  const { south, west, stepLat, stepLon, rows, columns } = raster;
  const size = rows * columns;
  const distance = new Float32Array(size).fill(Infinity);
  const tangentEast = new Float32Array(size);
  const tangentNorth = new Float32Array(size);
  const padLat = bandKm / KM_PER_DEG_LAT;
  const padLon = bandKm / frame.kmLon;
  for (let index = 0; index + 1 < ring.length; index += 1) {
    const [lat1, lon1] = ring[index];
    const [lat2, lon2] = ring[index + 1];
    const ax = (lon2 - lon1) * frame.kmLon;
    const ay = (lat2 - lat1) * KM_PER_DEG_LAT;
    const length2 = ax * ax + ay * ay;
    if (!(length2 > 0)) continue;
    const length = Math.sqrt(length2);
    const rowFrom = Math.max(0, Math.floor((Math.min(lat1, lat2) - padLat - south) / stepLat));
    const rowTo = Math.min(rows - 1, Math.ceil((Math.max(lat1, lat2) + padLat - south) / stepLat));
    const columnFrom = Math.max(0, Math.floor((Math.min(lon1, lon2) - padLon - west) / stepLon));
    const columnTo = Math.min(columns - 1, Math.ceil((Math.max(lon1, lon2) + padLon - west) / stepLon));
    for (let row = rowFrom; row <= rowTo; row += 1) {
      const py = (south + (row + 0.5) * stepLat - lat1) * KM_PER_DEG_LAT;
      for (let column = columnFrom; column <= columnTo; column += 1) {
        const px = (west + (column + 0.5) * stepLon - lon1) * frame.kmLon;
        const share = Math.max(0, Math.min(1, (px * ax + py * ay) / length2));
        const d = Math.hypot(px - share * ax, py - share * ay);
        const cell = row * columns + column;
        if (d >= distance[cell] || d > bandKm) continue;
        distance[cell] = d;
        tangentEast[cell] = ax / length;
        tangentNorth[cell] = ay / length;
      }
    }
  }
  return { distance, tangentEast, tangentNorth };
}

const smooth = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

/** The ocean current at a point: inverse-distance-squared blend of the ring points. */
function oceanAt(points: readonly OceanPoint[], lat: number, lon: number, frame: Frame): [number, number] {
  let east = 0;
  let north = 0;
  let total = 0;
  for (const point of points) {
    const dx = (lon - point.lon) * frame.kmLon;
    const dy = (lat - point.lat) * KM_PER_DEG_LAT;
    const weight = 1 / (dx * dx + dy * dy + OCEAN_SOFT_KM2);
    east += point.east * weight;
    north += point.north * weight;
    total += weight;
  }
  return total > 0 ? [east / total, north / total] : [0, 0];
}

/**
 * The along-reef model's current at a point near the reef, signed knots (FlowReef): the ring points' values blended by
 * inverse distance squared. Null with no samples.
 */
function reefAlong(reef: readonly NonNullable<FlowAtoll["reef"]>[number][], lat: number, lon: number, frame: Frame): number | null {
  if (reef.length === 0) return null;
  let sum = 0;
  let total = 0;
  for (const point of reef) {
    const dx = (lon - point.lon) * frame.kmLon;
    const dy = (lat - point.lat) * KM_PER_DEG_LAT;
    const weight = 1 / (dx * dx + dy * dy + 1);
    sum += weight * point.knots;
    total += weight;
  }
  return sum / total;
}

/**
 * +1 when the ring runs anticlockwise on the map (interior on the left of each segment), -1 clockwise. A segment's
 * direction times this is the outline's inward normal turned 90° clockwise: the way a positive FlowReef value runs.
 */
function ringTurn(ring: RimRing, frame: Frame): number {
  let area = 0;
  for (let index = 0; index + 1 < ring.length; index += 1) {
    const [lat1, lon1] = ring[index];
    const [lat2, lon2] = ring[index + 1];
    area += lon1 * frame.kmLon * lat2 * KM_PER_DEG_LAT - lon2 * frame.kmLon * lat1 * KM_PER_DEG_LAT;
  }
  return area >= 0 ? 1 : -1;
}

/** Adds weighted vectors into running sums over a box of cells round a point. */
function forCellsNear(
  raster: FlowRaster,
  lat: number,
  lon: number,
  reachKm: number,
  frame: Frame,
  visit: (cell: number, dxKm: number, dyKm: number) => void,
): void {
  const { south, west, stepLat, stepLon, rows, columns } = raster;
  const rowFrom = Math.max(0, Math.floor((lat - reachKm / KM_PER_DEG_LAT - south) / stepLat));
  const rowTo = Math.min(rows - 1, Math.ceil((lat + reachKm / KM_PER_DEG_LAT - south) / stepLat));
  const columnFrom = Math.max(0, Math.floor((lon - reachKm / frame.kmLon - west) / stepLon));
  const columnTo = Math.min(columns - 1, Math.ceil((lon + reachKm / frame.kmLon - west) / stepLon));
  for (let row = rowFrom; row <= rowTo; row += 1) {
    const dy = (south + (row + 0.5) * stepLat - lat) * KM_PER_DEG_LAT;
    for (let column = columnFrom; column <= columnTo; column += 1) {
      visit(row * columns + column, (west + (column + 0.5) * stepLon - lon) * frame.kmLon, dy);
    }
  }
}

const widthOf = (channel: FlowChannel) =>
  Math.max(CHANNEL_KM_RANGE[0], Math.min(CHANNEL_KM_RANGE[1], channel.widthKm > 0 ? channel.widthKm : DEFAULT_CHANNEL_KM));

/**
 * Builds one atoll's raster for one hour. `channels` are the gates this hour: every reef gap and the catalog channel
 * sites in none, each with its heading, speed and width. `ocean` is every atoll's ring points (the field's), so the sea
 * round this atoll blends into its neighbours'; the atoll's own when not given.
 */
export function buildFlowRaster(
  atoll: FlowAtoll,
  shapes: FlowShapes,
  channels: readonly FlowChannel[],
  ocean: readonly OceanPoint[] = atoll.ocean,
): FlowRaster {
  const outline = shapes.outline;
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const [lat, lon] of outline) {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lon);
    east = Math.max(east, lon);
  }
  const refLat = (south + north) / 2;
  const frame: Frame = { refLat, kmLon: KM_PER_DEG_LON * Math.cos((refLat * Math.PI) / 180) };
  south -= SEA_MARGIN_KM / KM_PER_DEG_LAT;
  north += SEA_MARGIN_KM / KM_PER_DEG_LAT;
  west -= SEA_MARGIN_KM / frame.kmLon;
  east += SEA_MARGIN_KM / frame.kmLon;
  const areaKm2 = (north - south) * KM_PER_DEG_LAT * (east - west) * frame.kmLon;
  const cellKm = Math.max(CELL_KM, Math.sqrt(areaKm2 / MAX_CELLS));
  const stepLat = cellKm / KM_PER_DEG_LAT;
  const stepLon = cellKm / frame.kmLon;
  const rows = Math.max(1, Math.ceil((north - south) / stepLat));
  const columns = Math.max(1, Math.ceil((east - west) / stepLon));
  const size = rows * columns;
  const raster: FlowRaster = {
    wayId: atoll.wayId,
    south,
    west,
    north: south + rows * stepLat,
    east: west + columns * stepLon,
    stepLat,
    stepLon,
    rows,
    columns,
    vEast: new Float32Array(size),
    vNorth: new Float32Array(size),
    kind: new Uint8Array(size),
    gate: new Uint8Array(size),
    jets: channels
      .filter((site) => site.knots >= FEED_MIN_KNOTS)
      .map((site) => ({
        lat: site.lat,
        lon: site.lon,
        east: Math.sin((site.headingDeg * Math.PI) / 180),
        north: Math.cos((site.headingDeg * Math.PI) / 180),
        widthKm: widthOf(site),
      })),
  };
  fillRing(raster, outline, KIND_LAGOON);
  for (const island of shapes.islands) fillRing(raster, island, KIND_LAND);
  const band = reefBand(raster, outline, WALL_BAND_KM, frame);
  const reef = atoll.reef ?? [];
  const turn = ringTurn(outline, frame);
  const lagoon = atoll.lagoon ? { grid: atoll.lagoon, ...decodeVectors(atoll.lagoon.vectors) } : null;
  const scale = lagoon ? lagoonScale(raster, lagoon, channels, frame) : DEFAULT_LAGOON_SCALE;
  const nearLat = OCEAN_NEAR_KM / KM_PER_DEG_LAT;
  const nearLon = OCEAN_NEAR_KM / frame.kmLon;
  const seaPoints = ocean.filter(
    (point) => point.lat >= south - nearLat && point.lat <= north + nearLat && point.lon >= west - nearLon && point.lon <= east + nearLon,
  );

  for (let row = 0; row < rows; row += 1) {
    const lat = south + (row + 0.5) * stepLat;
    for (let column = 0; column < columns; column += 1) {
      const cell = row * columns + column;
      const lon = west + (column + 0.5) * stepLon;
      const kind = raster.kind[cell];
      if (kind === KIND_LAND) continue;
      let ve = 0;
      let vn = 0;
      if (kind === KIND_LAGOON) {
        if (lagoon) {
          ve = bilinear(lagoon.grid, lagoon.east, lat, lon) * scale;
          vn = bilinear(lagoon.grid, lagoon.north, lat, lon) * scale;
        }
      } else {
        [ve, vn] = oceanAt(seaPoints, lat, lon, frame);
      }
      const d = band.distance[cell];
      const reach = kind === KIND_LAGOON ? LAGOON_EDGE_KM : WALL_BAND_KM;
      if (d <= reach) {
        // The reef stops the part running at it: close to it the water slides along it (outside, faster: the wall).
        const te = band.tangentEast[cell];
        const tn = band.tangentNorth[cell];
        const modelled = kind === KIND_LAGOON ? null : reefAlong(reef, lat, lon, frame);
        const along = modelled != null ? modelled * turn : (ve * te + vn * tn) * (kind === KIND_LAGOON ? 1 : WALL_GAIN);
        const share = 1 - smooth(d / reach);
        ve = ve * (1 - share) + along * te * share;
        vn = vn * (1 - share) + along * tn * share;
      }
      raster.vEast[cell] = ve;
      raster.vNorth[cell] = vn;
    }
  }

  // Channels: the fan that feeds them, added to whatever runs past, then the jet they make.
  addFans(raster, channels, frame);
  applyBlend(raster, jetBlend(raster, channels, frame));
  return raster;
}

/**
 * How much to scale the lagoon model's flow, which has no physical unit, so it agrees with the channels: the water a
 * running channel carries (speed × width) spread over a half circle inside it runs at speed × width / (π r), and the
 * lagoon model's own flow SCALE_AT_KM inside the channel (before the fans and jets go on top) is set to that. The
 * median over the channels, held to LAGOON_SCALE_RANGE; DEFAULT_LAGOON_SCALE when none runs.
 */
function lagoonScale(
  raster: FlowRaster,
  lagoon: { grid: LagoonGrid; east: Float32Array; north: Float32Array },
  channels: readonly FlowChannel[],
  frame: Frame,
): number {
  const ratios: number[] = [];
  for (const channel of channels) {
    if (channel.knots < FEED_MIN_KNOTS) continue;
    const radians = (channel.headingDeg * Math.PI) / 180;
    // Inside is downstream on the flood and upstream on the ebb: of the two points SCALE_AT_KM along the channel's
    // heading, use the one in the lagoon. A channel with both or neither there (an island, off the raster) is skipped.
    const inside = [1, -1]
      .map((sign) => ({
        lat: channel.lat + (sign * SCALE_AT_KM * Math.cos(radians)) / KM_PER_DEG_LAT,
        lon: channel.lon + (sign * SCALE_AT_KM * Math.sin(radians)) / frame.kmLon,
      }))
      .filter((point) => {
        const cell = cellAt(raster, point.lat, point.lon);
        return cell >= 0 && raster.kind[cell] === KIND_LAGOON;
      });
    if (inside.length !== 1) continue;
    const [{ lat, lon }] = inside;
    const model = Math.hypot(bilinear(lagoon.grid, lagoon.east, lat, lon), bilinear(lagoon.grid, lagoon.north, lat, lon));
    if (!(model > 0.02)) continue;
    ratios.push((channel.knots * widthOf(channel)) / (Math.PI * SCALE_AT_KM) / model);
  }
  if (ratios.length === 0) return DEFAULT_LAGOON_SCALE;
  ratios.sort((a, b) => a - b);
  const median = ratios[Math.floor(ratios.length / 2)];
  return Math.max(LAGOON_SCALE_RANGE[0], Math.min(LAGOON_SCALE_RANGE[1], median));
}

type Blend = { weight: Float32Array; east: Float32Array; north: Float32Array };

function newBlend(raster: FlowRaster): Blend {
  const size = raster.rows * raster.columns;
  return { weight: new Float32Array(size), east: new Float32Array(size), north: new Float32Array(size), };
}

const inRaster = (raster: FlowRaster, site: { lat: number; lon: number }) =>
  site.lat >= raster.south && site.lat <= raster.north && site.lon >= raster.west && site.lon <= raster.east;

/**
 * The upstream fan: the water a channel carries comes from all round its mouth on the upstream side, so toward the
 * mouth at speed × (width / 2) / r, the channel's own speed at its edge and less with distance, fading out at FAN_KM.
 * Added to the flow already there: a current running past the mouth is bent toward it, more the closer it passes.
 * Cells within the channel's width of the mouth are gates.
 */
function addFans(raster: FlowRaster, channels: readonly FlowChannel[], frame: Frame): void {
  for (const site of channels) {
    if (!inRaster(raster, site)) continue;
    const half = widthOf(site) / 2;
    const radians = (site.headingDeg * Math.PI) / 180;
    const he = Math.sin(radians);
    const hn = Math.cos(radians);
    forCellsNear(raster, site.lat, site.lon, FAN_KM, frame, (cell, dx, dy) => {
      if (raster.kind[cell] === KIND_LAND) return;
      const r = Math.hypot(dx, dy);
      if (r <= Math.max(half, 0.15)) raster.gate[cell] = 1;
      const along = dx * he + dy * hn;
      if (along > 0 || r > FAN_KM) return;
      const speed = (site.knots * half) / Math.max(r, half);
      // Toward the mouth, turning to the channel's own heading as it gets there.
      const toward = r > 0 ? [-dx / r, -dy / r] : [he, hn];
      const settle = smooth(1 - r / (2 * half));
      const fade = 1 - smooth(r / FAN_KM);
      const de = toward[0] * (1 - settle) + he * settle;
      const dn = toward[1] * (1 - settle) + hn * settle;
      raster.vEast[cell] += speed * de * fade;
      raster.vNorth[cell] += speed * dn * fade;
    });
  }
}

/**
 * The downstream jet: a plane jet from the mouth along the heading, its half-width growing by JET_SPREAD per km and its
 * speed falling so momentum (speed² × width) is kept. Blended over what is there, so it hands over to the lagoon or the
 * sea as it slows. Cells close behind the mouth, where the jet is still the channel's own width, are gates.
 */
function jetBlend(raster: FlowRaster, channels: readonly FlowChannel[], frame: Frame): Blend {
  const blend = newBlend(raster);
  for (const site of channels) {
    if (!inRaster(raster, site)) continue;
    const half0 = widthOf(site) / 2;
    const radians = (site.headingDeg * Math.PI) / 180;
    const he = Math.sin(radians);
    const hn = Math.cos(radians);
    forCellsNear(raster, site.lat, site.lon, JET_DOWN_KM, frame, (cell, dx, dy) => {
      if (raster.kind[cell] === KIND_LAND) return;
      const along = dx * he + dy * hn;
      if (along < -half0 || along > JET_DOWN_KM) return;
      const across = -dx * hn + dy * he;
      const s = Math.max(0, along);
      const half = half0 + JET_SPREAD * s;
      const weight = Math.exp(-((across / half) ** 2)) * (1 - smooth(s / JET_DOWN_KM));
      if (weight < 0.01) return;
      const speed = site.knots * Math.sqrt(half0 / half);
      if (s < half0 && Math.abs(across) < half0) raster.gate[cell] = 1;
      blend.weight[cell] += weight;
      blend.east[cell] += weight * speed * he;
      blend.north[cell] += weight * speed * hn;
    });
  }
  return blend;
}

function applyBlend(raster: FlowRaster, blend: Blend): void {
  for (let cell = 0; cell < blend.weight.length; cell += 1) {
    const total = blend.weight[cell];
    if (total <= 0) continue;
    const share = Math.min(1, total);
    raster.vEast[cell] = raster.vEast[cell] * (1 - share) + (blend.east[cell] / total) * share;
    raster.vNorth[cell] = raster.vNorth[cell] * (1 - share) + (blend.north[cell] / total) * share;
  }
}

/** The open-sea raster reaches this far past the outermost ring points, km. */
const SEA_REACH_KM = 30;

/**
 * The open sea between the atolls: the ring points' current (every atoll's, `points`) blended on cells of about
 * SEA_CELL_KM, all sea, no gates. Particles drift through it and pass to an atoll's raster where one covers them
 * (FlowParticles.step), so the ocean current shows between the atolls and carries on along their reefs and into their
 * channels. Null with no points.
 */
export function buildSeaRaster(points: readonly OceanPoint[]): FlowRaster | null {
  if (points.length === 0) return null;
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const point of points) {
    south = Math.min(south, point.lat);
    north = Math.max(north, point.lat);
    west = Math.min(west, point.lon);
    east = Math.max(east, point.lon);
  }
  const refLat = (south + north) / 2;
  const frame: Frame = { refLat, kmLon: KM_PER_DEG_LON * Math.cos((refLat * Math.PI) / 180) };
  south -= SEA_REACH_KM / KM_PER_DEG_LAT;
  north += SEA_REACH_KM / KM_PER_DEG_LAT;
  west -= SEA_REACH_KM / frame.kmLon;
  east += SEA_REACH_KM / frame.kmLon;
  const areaKm2 = (north - south) * KM_PER_DEG_LAT * (east - west) * frame.kmLon;
  const cellKm = Math.max(SEA_CELL_KM, Math.sqrt(areaKm2 / MAX_SEA_CELLS));
  const stepLat = cellKm / KM_PER_DEG_LAT;
  const stepLon = cellKm / frame.kmLon;
  const rows = Math.max(1, Math.ceil((north - south) / stepLat));
  const columns = Math.max(1, Math.ceil((east - west) / stepLon));
  const size = rows * columns;
  const raster: FlowRaster = {
    wayId: "sea",
    regional: true,
    south,
    west,
    north: south + rows * stepLat,
    east: west + columns * stepLon,
    stepLat,
    stepLon,
    rows,
    columns,
    vEast: new Float32Array(size),
    vNorth: new Float32Array(size),
    kind: new Uint8Array(size),
    gate: new Uint8Array(size),
    jets: [],
  };
  for (let row = 0; row < rows; row += 1) {
    const lat = south + (row + 0.5) * stepLat;
    for (let column = 0; column < columns; column += 1) {
      const [ve, vn] = oceanAt(points, lat, west + (column + 0.5) * stepLon, frame);
      raster.vEast[row * columns + column] = ve;
      raster.vNorth[row * columns + column] = vn;
    }
  }
  return raster;
}

/** Whether an atoll's raster (not the open sea's) covers a point. */
function coveredByAtoll(rasters: readonly FlowRaster[], lat: number, lon: number): boolean {
  return rasters.some((raster) => !raster.regional && cellAt(raster, lat, lon) >= 0);
}

/** The cell index at a point, or -1 off the raster. */
export function cellAt(raster: FlowRaster, lat: number, lon: number): number {
  const row = Math.floor((lat - raster.south) / raster.stepLat);
  const column = Math.floor((lon - raster.west) / raster.stepLon);
  if (row < 0 || row >= raster.rows || column < 0 || column >= raster.columns) return -1;
  return row * raster.columns + column;
}

/** On screen, speed goes as knots^SCREEN_EXPONENT: the factor to scale a velocity of `speed` knots by. */
export const screenFactor = (speed: number) => (speed > 1e-6 ? speed ** (SCREEN_EXPONENT - 1) : 0);

/**
 * Whether water moving from cell `from` to cell `to` must stop: off the raster, on an island, or across the reef
 * anywhere but a channel's gate. Particles and the reduced-motion streamlines share it.
 */
export function stopsBetween(raster: FlowRaster, from: number, to: number): boolean {
  return (
    to < 0 ||
    raster.kind[to] === KIND_LAND ||
    (from >= 0 && raster.kind[from] !== raster.kind[to] && !raster.gate[from] && !raster.gate[to])
  );
}

/** Bilinear velocity (knots) at a point into `out` [east, north]; false off the raster. */
export function velocityAt(raster: FlowRaster, lat: number, lon: number, out: Float64Array | number[]): boolean {
  const y = (lat - raster.south) / raster.stepLat - 0.5;
  const x = (lon - raster.west) / raster.stepLon - 0.5;
  if (y < -0.5 || x < -0.5 || y > raster.rows - 0.5 || x > raster.columns - 0.5) return false;
  const row = Math.max(0, Math.min(raster.rows - 2, Math.floor(y)));
  const column = Math.max(0, Math.min(raster.columns - 2, Math.floor(x)));
  const fy = Math.max(0, Math.min(1, y - row));
  const fx = Math.max(0, Math.min(1, x - column));
  const c00 = row * raster.columns + column;
  const c01 = c00 + 1;
  const c10 = c00 + raster.columns;
  const c11 = c10 + 1;
  const mix = (values: Float32Array) =>
    (values[c00] * (1 - fx) + values[c01] * fx) * (1 - fy) + (values[c10] * (1 - fx) + values[c11] * fx) * fy;
  out[0] = mix(raster.vEast);
  out[1] = mix(raster.vNorth);
  return true;
}

/**
 * Particles drifting through a set of rasters. Positions are lat/lon; each keeps a short trail of past positions.
 * A particle is reborn somewhere new when it runs out of life, leaves every raster, lands on an island, or would cross
 * the reef anywhere but a channel's gate.
 */
export class FlowParticles {
  readonly count: number;
  readonly trail: number;
  readonly lat: Float64Array;
  readonly lon: Float64Array;
  readonly speed: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  /** Trail ring buffers: trail positions per particle, newest at `head`. `filled` is how many are set. */
  readonly trailLat: Float64Array;
  readonly trailLon: Float64Array;
  readonly head: Uint16Array;
  readonly filled: Uint16Array;
  private readonly rasterOf: Int16Array;
  private readonly velocity = new Float64Array(2);

  constructor(count: number, trail: number, private readonly random: () => number = Math.random) {
    this.count = count;
    this.trail = trail;
    this.lat = new Float64Array(count);
    this.lon = new Float64Array(count);
    this.speed = new Float32Array(count);
    this.age = new Float32Array(count);
    this.life = new Float32Array(count);
    this.trailLat = new Float64Array(count * trail);
    this.trailLon = new Float64Array(count * trail);
    this.head = new Uint16Array(count);
    this.filled = new Uint16Array(count);
    this.rasterOf = new Int16Array(count).fill(-1);
  }

  /**
   * Places particle `index` at a random water point of the view on some raster: up to a few tries, after which it
   * waits (no raster) and tries again next step.
   */
  spawn(index: number, rasters: readonly FlowRaster[], view: { south: number; west: number; north: number; east: number }): void {
    this.filled[index] = 0;
    this.age[index] = 0;
    this.life[index] = 2 + this.random() * 5;
    this.rasterOf[index] = -1;
    if (this.random() < FEED_SHARE && this.feed(index, rasters, view)) return;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const lat = view.south + this.random() * (view.north - view.south);
      const lon = view.west + this.random() * (view.east - view.west);
      for (let at = 0; at < rasters.length; at += 1) {
        const cell = cellAt(rasters[at], lat, lon);
        if (cell < 0 || rasters[at].kind[cell] === KIND_LAND) continue;
        // The open sea only where no atoll's raster is: over an atoll that one decides (an island there is land).
        if (rasters[at].regional && coveredByAtoll(rasters, lat, lon)) break;
        this.lat[index] = lat;
        this.lon[index] = lon;
        this.rasterOf[index] = at;
        this.pushTrail(index);
        return;
      }
    }
  }

  /** Places particle `index` upstream of a random channel in view; false when no channel is. */
  private feed(index: number, rasters: readonly FlowRaster[], view: { south: number; west: number; north: number; east: number }): boolean {
    const inView = (jet: { lat: number; lon: number }) =>
      jet.lat >= view.south && jet.lat <= view.north && jet.lon >= view.west && jet.lon <= view.east;
    let total = 0;
    for (const raster of rasters) for (const jet of raster.jets) if (inView(jet)) total += 1;
    if (total === 0) return false;
    let pick = Math.floor(this.random() * total);
    for (let at = 0; at < rasters.length; at += 1) {
      for (const jet of rasters[at].jets) {
        if (!inView(jet) || pick-- > 0) continue;
        // In the upstream fan: within 60° either side of straight upstream, from the mouth's edge out to FEED_KM.
        const angle = Math.PI + (this.random() - 0.5) * ((2 * Math.PI) / 3);
        const distance = jet.widthKm / 2 + this.random() * FEED_KM;
        const along = distance * Math.cos(angle);
        const across = distance * Math.sin(angle);
        const kmLon = KM_PER_DEG_LON * Math.cos((jet.lat * Math.PI) / 180);
        const lat = jet.lat + (along * jet.north + across * jet.east) / KM_PER_DEG_LAT;
        const lon = jet.lon + (along * jet.east - across * jet.north) / kmLon;
        const cell = cellAt(rasters[at], lat, lon);
        if (cell < 0 || rasters[at].kind[cell] === KIND_LAND) return false;
        this.lat[index] = lat;
        this.lon[index] = lon;
        this.rasterOf[index] = at;
        this.pushTrail(index);
        return true;
      }
    }
    return false;
  }

  /**
   * The raster a particle on raster `at` moves onto at a point: from the open sea, an atoll's raster that has open sea
   * there; from an atoll's raster (leaving its edge), the open sea's. -1 when there is none.
   */
  private handOff(rasters: readonly FlowRaster[], at: number, lat: number, lon: number): number {
    const fromRegional = rasters[at].regional === true;
    for (let other = 0; other < rasters.length; other += 1) {
      if (other === at || (rasters[other].regional === true) === fromRegional) continue;
      const cell = cellAt(rasters[other], lat, lon);
      if (cell >= 0 && rasters[other].kind[cell] === KIND_SEA) return other;
    }
    return -1;
  }

  private pushTrail(index: number): void {
    const head = (this.head[index] + 1) % this.trail;
    this.head[index] = head;
    this.trailLat[index * this.trail + head] = this.lat[index];
    this.trailLon[index * this.trail + head] = this.lon[index];
    if (this.filled[index] < this.trail) this.filled[index] += 1;
  }

  /** How visible particle `index` is now, 0 to 1: fading in after it appears and out before it goes. */
  opacity(index: number): number {
    const age = this.age[index];
    return Math.max(0, Math.min(1, age / FADE_IN_S, (this.life[index] - age) / FADE_OUT_S));
  }

  /** Which raster particle `index` is on (-1 none). For tests. */
  rasterOf_(index: number): number {
    return this.rasterOf[index];
  }

  /** Forgets every trail (after the map jumps), keeping the particles where they are. */
  clearTrails(): void {
    for (let index = 0; index < this.count; index += 1) {
      this.filled[index] = 0;
      if (this.rasterOf[index] >= 0) this.pushTrail(index);
    }
  }

  /** Forgets every particle's raster, so each is placed again (after the rasters change). */
  reset(): void {
    this.rasterOf.fill(-1);
    this.filled.fill(0);
  }

  /**
   * Moves every particle `seconds` on: `degPerKnotSecond` turns knots into degrees of latitude per second on screen
   * (the animation runs much faster than the water), longitude scaled for the latitude. `record` adds the new position
   * to the trail.
   */
  step(
    seconds: number,
    rasters: readonly FlowRaster[],
    view: { south: number; west: number; north: number; east: number },
    degPerKnotSecond: number,
    record: boolean,
  ): void {
    const lonScale = 1 / Math.cos((((view.south + view.north) / 2) * Math.PI) / 180);
    for (let index = 0; index < this.count; index += 1) {
      const at = this.rasterOf[index];
      this.age[index] += seconds;
      if (at < 0 || at >= rasters.length || this.age[index] > this.life[index]) {
        this.spawn(index, rasters, view);
        continue;
      }
      const raster = rasters[at];
      const lat = this.lat[index];
      const lon = this.lon[index];
      if (!velocityAt(raster, lat, lon, this.velocity)) {
        this.spawn(index, rasters, view);
        continue;
      }
      const speed = Math.hypot(this.velocity[0], this.velocity[1]);
      this.speed[index] = speed;
      // The slow lagoon still creeps visibly, the order is kept.
      const screen = screenFactor(speed);
      const ve = this.velocity[0] * screen;
      const vn = this.velocity[1] * screen;
      const nextLat = lat + vn * degPerKnotSecond * seconds;
      const nextLon = lon + ve * degPerKnotSecond * lonScale * seconds;
      const from = cellAt(raster, lat, lon);
      const to = cellAt(raster, nextLat, nextLon);
      // Between rasters: from the open sea onto an atoll's raster where one covers the point, and off the edge of an
      // atoll's raster onto the open sea. Only onto water of the same kind it is on (sea), so no reef is crossed.
      const handed = raster.regional || to < 0 ? this.handOff(rasters, at, nextLat, nextLon) : -1;
      if (handed >= 0) {
        this.rasterOf[index] = handed;
        this.lat[index] = nextLat;
        this.lon[index] = nextLon;
        if (record) this.pushTrail(index);
        continue;
      }
      // An island, or the reef away from a channel's gate: the water cannot go on, so the particle stops and fades
      // out where it is rather than vanishing (the field turns along the reef, so few get here). On the open sea, an
      // atoll's raster with no sea at the point (its reef, lagoon or land) stops it the same way.
      if (stopsBetween(raster, from, to) || (raster.regional && coveredByAtoll(rasters, nextLat, nextLon))) {
        this.life[index] = Math.min(this.life[index], this.age[index] + FADE_OUT_S);
        this.speed[index] = 0;
        continue;
      }
      if (nextLat < view.south || nextLat > view.north || nextLon < view.west || nextLon > view.east) {
        this.spawn(index, rasters, view);
        continue;
      }
      this.lat[index] = nextLat;
      this.lon[index] = nextLon;
      if (record) this.pushTrail(index);
    }
  }
}
