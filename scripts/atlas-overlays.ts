import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import {
  ATLAS_OVERLAYS,
  atlasTileFile,
  encodeRing,
  ringAreaM2,
  simplifyRing,
  type AtlasOverlay,
  type AtlasTile,
  type AtlasTileEntry,
} from "../lib/atlas-overlays";
import { gpkgPolygons } from "../lib/gpkg";

/**
 * Builds the map's Allen Coral Atlas overlays (reef zones, bottom types, reef outline) from the region download
 * unzipped into data/sources/aca/ (gitignored).
 *
 *   npm run atlas-overlays               all three
 *   npm run atlas-overlays -- reefZones  one of them
 *
 * Each overlay goes to public/overlays/<name>/: one file per 0.25° tile holding the shapes whose first point
 * falls in it, and index.json with each tile's bounds. Shapes are simplified (lib/atlas-overlays.ts sets how much)
 * and specks below the overlay's minimum area are dropped.
 */
const ACA = path.join(process.cwd(), "data", "sources", "aca");
/** The Maldives, with a margin. */
const AREA = { south: -0.8, north: 7.2, west: 72.5, east: 74 };

function build(overlay: AtlasOverlay): void {
  const source = path.join(ACA, overlay.source);
  if (!fs.existsSync(source)) {
    console.log(`${overlay.title}: no ${path.relative(process.cwd(), source)}, skipped (see README).`);
    return;
  }
  const db = new DatabaseSync(source, { readOnly: true });
  const table = String((db.prepare("select table_name from gpkg_contents where data_type = 'features'").get() as { table_name: string }).table_name);
  const rows = db
    .prepare(
      `select t.geom as geom, t.class as class from "${table}" t join "rtree_${table}_geom" r on r.id = t.fid
       where r.maxx >= ? and r.minx <= ? and r.maxy >= ? and r.miny <= ?`,
    )
    .all(AREA.west, AREA.east, AREA.south, AREA.north) as { geom: Uint8Array; class: string }[];
  db.close();

  const classIndex = new Map<string, number>(overlay.classes.map((item, index) => [item.name, index]));
  const tiles = new Map<string, { shapes: AtlasTile; bounds: AtlasTileEntry }>();
  let kept = 0;
  let dropped = 0;
  for (const row of rows) {
    const index = classIndex.get(row.class);
    if (index == null) throw new Error(`${overlay.title}: unknown Atlas class "${row.class}"; add it in lib/atlas-overlays.ts`);
    for (const polygon of gpkgPolygons(row.geom)) {
      const rings = polygon.map((ring) => simplifyRing(ring, overlay.tolerance)).filter((ring) => ring.length >= 4);
      if (rings.length === 0 || ringAreaM2(rings[0]) < overlay.minAreaM2) {
        dropped += 1;
        continue;
      }
      const [lon, lat] = rings[0][0];
      const file = atlasTileFile(lat, lon);
      let tile = tiles.get(file);
      if (!tile) {
        tile = { shapes: [], bounds: { file, south: 90, west: 180, north: -90, east: -180 } };
        tiles.set(file, tile);
      }
      for (const [x, y] of rings[0]) {
        tile.bounds.south = Math.min(tile.bounds.south, y);
        tile.bounds.north = Math.max(tile.bounds.north, y);
        tile.bounds.west = Math.min(tile.bounds.west, x);
        tile.bounds.east = Math.max(tile.bounds.east, x);
      }
      tile.shapes.push([index, ...rings.map(encodeRing)]);
      kept += 1;
    }
  }

  const out = path.join(process.cwd(), "public", overlay.path);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const round = (value: number) => Math.round(value * 1e5) / 1e5;
  const entries: AtlasTileEntry[] = [];
  let bytes = 0;
  let largest = 0;
  for (const [file, tile] of [...tiles.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const body = JSON.stringify(tile.shapes);
    fs.writeFileSync(path.join(out, file), body);
    bytes += body.length;
    largest = Math.max(largest, body.length);
    const { south, west, north, east } = tile.bounds;
    entries.push({ file, south: round(south), west: round(west), north: round(north), east: round(east) });
  }
  const index = {
    source: `Allen Coral Atlas (${overlay.source.split("/")[0]}, Central Indian Ocean), © 2018-2023 Allen Coral Atlas Partnership and Arizona State University, CC BY 4.0`,
    classes: overlay.classes.map((item) => item.name),
    tiles: entries,
  };
  fs.writeFileSync(path.join(out, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  console.log(
    `${overlay.title}: ${kept} shapes in ${entries.length} tiles, ${(bytes / 1e6).toFixed(1)} MB (largest ${(largest / 1e3).toFixed(0)} KB); ${dropped} specks dropped.`,
  );
}

function main(): void {
  const only = process.argv.slice(2);
  for (const overlay of Object.values(ATLAS_OVERLAYS)) {
    if (only.length === 0 || only.includes(overlay.id)) build(overlay);
  }
}

main();
