import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { gpkgPolygons } from "../lib/gpkg";
import {
  encodeRing,
  reefTileFile,
  REEF_ZONE_CLASSES,
  simplifyRing,
  type ReefTileEntry,
  type ReefZoneTile,
} from "../lib/reef-zones";
import { GEOMORPHIC_PATH } from "./aca";

/**
 * Builds the map's reef-zone overlay from the Allen Coral Atlas download (data/sources/aca/, gitignored).
 *
 *   npm run reef-zones
 *
 * Writes public/overlays/reef-zones/: one file per 0.25° tile holding the zones whose first point falls in it,
 * and index.json with each tile's bounds. Shapes are simplified to about 11 m, which is below a pixel from zoom 11
 * (where the map starts drawing them) to about zoom 14.
 */
const OUT = path.join(process.cwd(), "public", "overlays", "reef-zones");
/** The Maldives, with a margin. */
const AREA = { south: -0.8, north: 7.2, west: 72.5, east: 74 };
const TOLERANCE_DEG = 0.0001;

function main(): void {
  if (!fs.existsSync(GEOMORPHIC_PATH)) {
    console.error(`No Allen Coral Atlas download at ${path.relative(process.cwd(), GEOMORPHIC_PATH)} (see README).`);
    process.exit(1);
  }
  const db = new DatabaseSync(GEOMORPHIC_PATH, { readOnly: true });
  const table = String((db.prepare("select table_name from gpkg_contents where data_type = 'features'").get() as { table_name: string }).table_name);
  const rows = db
    .prepare(
      `select t.geom as geom, t.class as class from "${table}" t join "rtree_${table}_geom" r on r.id = t.fid
       where r.maxx >= ? and r.minx <= ? and r.maxy >= ? and r.miny <= ?`,
    )
    .all(AREA.west, AREA.east, AREA.south, AREA.north) as { geom: Uint8Array; class: string }[];
  db.close();

  const classIndex = new Map<string, number>(REEF_ZONE_CLASSES.map((item, index) => [item.name, index]));
  const tiles = new Map<string, { zones: ReefZoneTile; bounds: ReefTileEntry }>();
  let kept = 0;
  let dropped = 0;
  for (const row of rows) {
    const index = classIndex.get(row.class);
    if (index == null) throw new Error(`Unknown Atlas class "${row.class}": add it to REEF_ZONE_CLASSES`);
    for (const polygon of gpkgPolygons(row.geom)) {
      const rings = polygon.map((ring) => simplifyRing(ring, TOLERANCE_DEG)).filter((ring) => ring.length >= 4);
      if (rings.length === 0) {
        dropped += 1; // smaller than the tolerance: a speck at any zoom the map draws
        continue;
      }
      const [lon, lat] = rings[0][0];
      const file = reefTileFile(lat, lon);
      let tile = tiles.get(file);
      if (!tile) {
        tile = { zones: [], bounds: { file, south: 90, west: 180, north: -90, east: -180 } };
        tiles.set(file, tile);
      }
      for (const [x, y] of rings[0]) {
        tile.bounds.south = Math.min(tile.bounds.south, y);
        tile.bounds.north = Math.max(tile.bounds.north, y);
        tile.bounds.west = Math.min(tile.bounds.west, x);
        tile.bounds.east = Math.max(tile.bounds.east, x);
      }
      tile.zones.push([index, ...rings.map(encodeRing)]);
      kept += 1;
    }
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const round = (value: number) => Math.round(value * 1e5) / 1e5;
  const entries: ReefTileEntry[] = [];
  let bytes = 0;
  for (const [file, tile] of [...tiles.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const body = JSON.stringify(tile.zones);
    fs.writeFileSync(path.join(OUT, file), body);
    bytes += body.length;
    const { south, west, north, east } = tile.bounds;
    entries.push({ file, south: round(south), west: round(west), north: round(north), east: round(east) });
  }
  const index = {
    source: "Allen Coral Atlas geomorphic map (Central Indian Ocean), © 2018-2023 Allen Coral Atlas Partnership and Arizona State University, CC BY 4.0",
    classes: REEF_ZONE_CLASSES.map((item) => item.name),
    tiles: entries,
  };
  fs.writeFileSync(path.join(OUT, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  console.log(`${kept} zones in ${entries.length} tiles, ${(bytes / 1e6).toFixed(1)} MB; ${dropped} specks dropped.`);
}

main();
