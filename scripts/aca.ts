import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { gpkgPolygons, polygonContains } from "../lib/gpkg";

/**
 * The Allen Coral Atlas geomorphic map, from the region download unzipped into data/sources/aca/ (gitignored).
 * Scripts use it when it is there and carry on without it when it is not.
 */
export const GEOMORPHIC_PATH = path.join(process.cwd(), "data", "sources", "aca", "Geomorphic-Map", "geomorphic.gpkg");

/** About 20 m either side of the pin: the spatial index only has to return the polygons that could hold it. */
const PAD_DEG = 0.0002;

/** The reef zone under a point, or null when it is off the mapped reef. */
export type GeomorphicMap = { zoneAt: (lat: number, lon: number) => string | null; close: () => void };

export function openGeomorphic(file = GEOMORPHIC_PATH): GeomorphicMap | null {
  if (!fs.existsSync(file)) return null;
  const db = new DatabaseSync(file, { readOnly: true });
  const table = String((db.prepare("select table_name from gpkg_contents where data_type = 'features'").get() as { table_name: string }).table_name);
  const lookup = db.prepare(
    `select t.geom as geom, t.class as class from "${table}" t join "rtree_${table}_geom" r on r.id = t.fid
     where r.maxx >= ? and r.minx <= ? and r.maxy >= ? and r.miny <= ?`,
  );
  return {
    zoneAt(lat, lon) {
      const rows = lookup.all(lon - PAD_DEG, lon + PAD_DEG, lat - PAD_DEG, lat + PAD_DEG) as { geom: Uint8Array; class: string }[];
      for (const row of rows) {
        if (gpkgPolygons(row.geom).some((polygon) => polygonContains(polygon, lon, lat))) return row.class;
      }
      return null;
    },
    close: () => db.close(),
  };
}
