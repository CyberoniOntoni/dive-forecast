import fs from "fs/promises";
import path from "path";
import { workerEnv, type R2Bucket } from "./cloudflare";

/**
 * Satellite tiles made from Copernicus Sentinel-2 (scripts/imagery/sentinel2.py), which the app may save for use
 * without signal: Esri's World Imagery, the map's live satellite layer, may not be downloaded ahead of time. Kept in
 * R2 (DATA) under imagery/<version>/<z>/<x>/<y>.webp, or data/imagery/ on Node, and uploaded with
 * `npm run imagery:upload`. A new build goes under a new version, so a cached tile never needs to change.
 */
export const IMAGERY_VERSION = "s2-v1";
export const IMAGERY_MIN_ZOOM = 8;
export const IMAGERY_MAX_ZOOM = 14;
export const IMAGERY_ATTRIBUTION = "Contains modified Copernicus Sentinel data 2023–2026";

/** The Maldives, with room round it: tiles are only ever made inside. West, south, east, north. */
export const IMAGERY_BOUNDS: readonly [number, number, number, number] = [72.4, -0.9, 74.0, 7.3];

/** The tile's place, or null for anything that is not a tile we could have made. */
export function imageryTile(version: string, z: string, x: string, file: string): { z: number; x: number; y: number } | null {
  if (version !== IMAGERY_VERSION || !/^\d{1,2}$/.test(z) || !/^\d{1,6}$/.test(x)) return null;
  const match = /^(\d{1,6})\.webp$/.exec(file);
  if (!match) return null;
  const zoom = Number(z);
  const tile = { z: zoom, x: Number(x), y: Number(match[1]) };
  if (zoom < IMAGERY_MIN_ZOOM || zoom > IMAGERY_MAX_ZOOM || tile.x >= 2 ** zoom || tile.y >= 2 ** zoom) return null;
  return tile;
}

function key({ z, x, y }: { z: number; x: number; y: number }): string {
  return `imagery/${IMAGERY_VERSION}/${z}/${x}/${y}.webp`;
}

function bucket(): R2Bucket | null {
  return workerEnv()?.DATA ?? null;
}

function imageryDir(): string {
  return process.env.IMAGERY_DIR || path.join(process.cwd(), "data", "imagery");
}

/** The tile's bytes, or null where none was made (open ocean). */
export async function readImageryTile(tile: { z: number; x: number; y: number }): Promise<Uint8Array | null> {
  const r2 = bucket();
  if (r2) {
    const object = await r2.get(key(tile));
    return object ? new Uint8Array(await object.arrayBuffer()) : null;
  }
  try {
    return new Uint8Array(await fs.readFile(path.join(imageryDir(), key(tile).slice("imagery/".length))));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * A MapLibre style holding only the imagery, for the app's offline download (its region definition needs a style URL).
 * The tile URL must be the one the app's own map style uses, so the saved tiles are found when it draws.
 */
export function imageryStyle(origin: string) {
  return {
    version: 8,
    sources: {
      sentinel2: {
        type: "raster",
        tiles: [`${origin}/imagery/${IMAGERY_VERSION}/{z}/{x}/{y}.webp`],
        tileSize: 256,
        minzoom: IMAGERY_MIN_ZOOM,
        maxzoom: IMAGERY_MAX_ZOOM,
        bounds: IMAGERY_BOUNDS,
        attribution: IMAGERY_ATTRIBUTION,
      },
    },
    layers: [{ id: "sentinel2", type: "raster", source: "sentinel2" }],
  };
}
