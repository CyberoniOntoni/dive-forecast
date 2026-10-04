/** GEBCO 2026 is a 15-arc-second grid, cell centres, south and west first. */

const GEBCO_CELLS_PER_DEGREE = 240;

/** Centre of row 0. One half-cell north of the south edge. */
const LAT0 = -90 + 1 / (GEBCO_CELLS_PER_DEGREE * 2);
/** Centre of column 0. One half-cell east of the date line. */
const LON0 = -180 + 1 / (GEBCO_CELLS_PER_DEGREE * 2);

export function gebcoIndex(lat: number, lon: number): { row: number; col: number } {
  return {
    row: Math.round((lat - LAT0) * GEBCO_CELLS_PER_DEGREE),
    col: Math.round((lon - LON0) * GEBCO_CELLS_PER_DEGREE),
  };
}

export function gebcoCenter(row: number, col: number): { lat: number; lon: number } {
  return {
    lat: LAT0 + row / GEBCO_CELLS_PER_DEGREE,
    lon: LON0 + col / GEBCO_CELLS_PER_DEGREE,
  };
}

export type DodsGrid = {
  /** Row-major. Int16 elevation, or TID bytes. */
  values: Int16Array | Uint8Array;
  lat: Float64Array;
  lon: Float64Array;
};

/**
 * THREDDS DODS data block. Each array is a repeated element count, then values.
 * Int16 is widened to a big-endian int32. Bytes are packed and padded to 4.
 * A Grid is the array, then its latitude map, then its longitude map.
 */
export function parseDodsGrid(body: Buffer, kind: "int16" | "byte"): DodsGrid {
  const marker = Buffer.from("Data:\n");
  const at = body.indexOf(marker);
  if (at < 0) throw new Error("DODS response has no data block");
  let offset = at + marker.length;
  const values = readArray(body, kind, offset);
  offset = values.offset;
  const lat = readArray(body, "float64", offset);
  offset = lat.offset;
  const lon = readArray(body, "float64", offset);
  if (values.data.length !== lat.data.length * lon.data.length) {
    throw new Error(`DODS size ${values.data.length} is not ${lat.data.length} by ${lon.data.length}`);
  }
  return { values: values.data, lat: lat.data, lon: lon.data };
}

type ArrayRead<T> = { data: T; offset: number };

function readArray(body: Buffer, kind: "float64", offset: number): ArrayRead<Float64Array>;
function readArray(body: Buffer, kind: "int16" | "byte", offset: number): ArrayRead<Int16Array | Uint8Array>;
function readArray(
  body: Buffer,
  kind: "int16" | "byte" | "float64",
  offset: number,
): ArrayRead<Int16Array | Uint8Array | Float64Array> {
  const count = readInt32(body, offset);
  const again = readInt32(body, offset + 4);
  if (count !== again || count < 0) throw new Error(`DODS count ${count} does not match ${again}`);
  offset += 8;
  if (kind === "byte") {
    const data = new Uint8Array(count);
    if (offset + count > body.length) throw new Error("DODS data ended early");
    body.copy(data, 0, offset, offset + count);
    const padded = count + ((4 - (count % 4)) % 4);
    return { data, offset: offset + padded };
  }
  if (kind === "float64") {
    const data = new Float64Array(count);
    for (let i = 0; i < count; i += 1) data[i] = readDouble(body, offset + i * 8);
    return { data, offset: offset + count * 8 };
  }
  const data = new Int16Array(count);
  for (let i = 0; i < count; i += 1) {
    const value = readInt32(body, offset + i * 4);
    if (value < -32768 || value > 32767) throw new Error(`DODS elevation ${value} does not fit in an int16`);
    data[i] = value;
  }
  return { data, offset: offset + count * 4 };
}

function readInt32(body: Buffer, offset: number): number {
  if (offset + 4 > body.length) throw new Error("DODS data ended early");
  return body.readInt32BE(offset);
}

function readDouble(body: Buffer, offset: number): number {
  if (offset + 8 > body.length) throw new Error("DODS data ended early");
  return body.readDoubleBE(offset);
}
