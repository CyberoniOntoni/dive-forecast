import fs from "fs";
import path from "path";

/**
 * Builds data/islands.json from OpenStreetMap's land polygons (osmdata.openstreetmap.de, "land-polygons-split-4326",
 * a shapefile of every coastline-closed land area). Keeps the rings in the Maldives, with their area, for the sea
 * state's shelter (lib/islands.ts).
 *
 *   npm run islands -- <path to land_polygons.shp>
 */
const BOX = { south: -1.0, north: 7.3, west: 72.4, east: 74.0 };
const OUT = path.join(process.cwd(), "data", "islands.json");

function main(): void {
  const file = process.argv[2];
  if (!file) throw new Error("usage: npm run islands -- <land_polygons.shp>");
  const buffer = fs.readFileSync(file);
  const islands: { areaHa: number; ring: [number, number][] }[] = [];
  // Shapefile: a 100-byte header, then records of an 8-byte big-endian header and a little-endian shape.
  for (let offset = 100; offset + 8 <= buffer.length; ) {
    const length = buffer.readInt32BE(offset + 4) * 2;
    const at = offset + 8;
    offset = at + length;
    if (buffer.readInt32LE(at) !== 5) continue; // polygons only
    const [west, south, east, north] = [0, 1, 2, 3].map((index) => buffer.readDoubleLE(at + 4 + index * 8));
    if (east < BOX.west || west > BOX.east || north < BOX.south || south > BOX.north) continue;
    const partCount = buffer.readInt32LE(at + 36);
    const pointCount = buffer.readInt32LE(at + 40);
    const parts = Array.from({ length: partCount }, (_, index) => buffer.readInt32LE(at + 44 + index * 4));
    const points = at + 44 + partCount * 4;
    parts.push(pointCount);
    for (let part = 0; part < partCount; part += 1) {
      const ring: [number, number][] = [];
      for (let index = parts[part]; index < parts[part + 1]; index += 1) {
        const lon = buffer.readDoubleLE(points + index * 16);
        const lat = buffer.readDoubleLE(points + index * 16 + 8);
        ring.push([round(lat, 5), round(lon, 5)]);
      }
      if (ring.length >= 4) islands.push({ areaHa: round(areaHa(ring), 2), ring });
    }
  }
  islands.sort((a, b) => b.areaHa - a.areaHa);
  const body = {
    attribution:
      "Island outlines from OpenStreetMap land polygons (osmdata.openstreetmap.de), (c) OpenStreetMap contributors, ODbL. Ring is [lat, lon] pairs, closed.",
    islands,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(body)}\n`);
  console.log(`${islands.length} islands written to ${path.relative(process.cwd(), OUT)}`);
}

function areaHa(ring: readonly [number, number][]): number {
  const kmPerLon = 111.32 * Math.cos((ring[0][0] * Math.PI) / 180);
  let twice = 0;
  for (let index = 0; index + 1 < ring.length; index += 1) {
    const [lat0, lon0] = ring[index];
    const [lat1, lon1] = ring[index + 1];
    twice += lon0 * kmPerLon * lat1 * 110.574 - lon1 * kmPerLon * lat0 * 110.574;
  }
  return (Math.abs(twice) / 2) * 100;
}

function round(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

main();
