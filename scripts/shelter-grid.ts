import fs from "fs";
import path from "path";
import { readOpenings } from "../lib/openings";
import { allRims } from "../lib/rim";
import { exposureIslands, exposureRings } from "../lib/sea-state";
import {
  packExposure,
  SHELTER_CELL_BYTES,
  SHELTER_DIRECTIONS,
  SHELTER_STEP_DEG,
  type ShelterAtollGrid,
  type ShelterGridFile,
} from "../lib/shelter-grid";
import { siteExposure } from "../lib/wave-exposure";

/**
 * Builds data/shelter-grid.json for the sheltered-water map layer (lib/shelter-grid.ts): every 500 m cell of water
 * inside each atoll outline, with its exposure from the same ray tracing as the dive sites. Rerun after rims.json,
 * openings.json or islands.json change. Takes a few minutes.
 *
 *   npm run shelter-grid
 */
function main(): void {
  const rings = exposureRings();
  const islands = exposureIslands();
  const islandBoxes = islands.map(({ ring }) => ({ ring, ...box(ring) }));
  const openings = readOpenings();
  const atolls: Record<string, ShelterAtollGrid> = {};
  const started = Date.now();
  let total = 0;
  for (const [wayId, ring] of allRims()) {
    const { south: rimSouth, north, west: rimWest, east } = box(ring);
    const south = Math.floor(rimSouth / SHELTER_STEP_DEG) * SHELTER_STEP_DEG;
    const west = Math.floor(rimWest / SHELTER_STEP_DEG) * SHELTER_STEP_DEG;
    const rows = Math.ceil((north - south) / SHELTER_STEP_DEG);
    const columns = Math.ceil((east - west) / SHELTER_STEP_DEG);
    const runs: [number, number, number][] = [];
    const packed: Uint8Array[] = [];
    for (let row = 0; row < rows; row += 1) {
      const lat = south + (row + 0.5) * SHELTER_STEP_DEG;
      let run: [number, number, number] | null = null;
      for (let column = 0; column < columns; column += 1) {
        const lon = west + (column + 0.5) * SHELTER_STEP_DEG;
        const water =
          inside(lat, lon, ring) &&
          !islandBoxes.some((item) => lat >= item.south && lat <= item.north && lon >= item.west && lon <= item.east && inside(lat, lon, item.ring));
        if (!water) {
          run = null;
          continue;
        }
        const exposure = siteExposure({ lat, lon, kind: "lagoon", inwardBearingDeg: null, ownWayId: wayId }, rings, openings, islands);
        const bytes = new Uint8Array(SHELTER_CELL_BYTES);
        packExposure(exposure, bytes, 0);
        packed.push(bytes);
        if (run) run[2] += 1;
        else runs.push((run = [row, column, 1]));
      }
    }
    const cells = Buffer.concat(packed.map((bytes) => Buffer.from(bytes))).toString("base64");
    atolls[wayId] = { south: round(south), west: round(west), runs, cells };
    total += packed.length;
    console.log(`${wayId}: ${packed.length} cells (${Math.round((Date.now() - started) / 1000)} s)`);
  }
  const body: ShelterGridFile = { stepDeg: SHELTER_STEP_DEG, directions: SHELTER_DIRECTIONS, atolls };
  const out = path.join(process.cwd(), "data", "shelter-grid.json");
  fs.writeFileSync(out, `${JSON.stringify(body)}\n`);
  console.log(`${total} cells written to ${path.relative(process.cwd(), out)}`);
}

function box(ring: readonly (readonly [number, number])[]) {
  const lats = ring.map((point) => point[0]);
  const lons = ring.map((point) => point[1]);
  return { south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lons), east: Math.max(...lons) };
}

function inside(lat: number, lon: number, ring: readonly (readonly [number, number])[]): boolean {
  let within = false;
  for (let index = 0; index + 1 < ring.length; index += 1) {
    const [lat0, lon0] = ring[index];
    const [lat1, lon1] = ring[index + 1];
    if (lat0 > lat !== lat1 > lat && lon < lon0 + ((lat - lat0) * (lon1 - lon0)) / (lat1 - lat0)) within = !within;
  }
  return within;
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

main();
