import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { readOpenings } from "../lib/openings";
import { allRims, KM_PER_DEG_LAT, pointInRing, type RimRing } from "../lib/rim";
import { exposureIslands, exposureRings, exposureShoals } from "../lib/sea-state";
import {
  encodeCells,
  outlineKm,
  packExposures,
  seaOwner,
  SHELTER_BAND_KM,
  SHELTER_DIRECTIONS,
  SHELTER_FINE_KM,
  SHELTER_FINE_STEP_DEG,
  SHELTER_STEP_DEG,
  type ShelterAtollGrid,
  type ShelterGridFile,
  type ShelterLayerGrid,
  type ShelterRuns,
} from "../lib/shelter-grid";
import { siteExposure, type SiteExposure } from "../lib/wave-exposure";

/**
 * Builds data/shelter-grid.json for the sheltered-water map layer (lib/shelter-grid.ts): for each atoll, every 500 m
 * cell of water it owns (inside its outline, and within SHELTER_BAND_KM outside it where no other outline is nearer:
 * seaOwner),
 * and every 125 m cell of that water within SHELTER_FINE_KM of an island, with its exposure from the same ray tracing
 * as the dive sites. Atolls are built in parallel, one process per core. Rerun after rims.json, openings.json,
 * islands.json or shoals.json change. Takes about seven minutes.
 *
 *   npm run shelter-grid
 */

const FINE_PER_COARSE = Math.round(SHELTER_STEP_DEG / SHELTER_FINE_STEP_DEG);

type Region = "inner" | "outer" | "land" | "other" | null;
type Box = { south: number; north: number; west: number; east: number };

function buildAtoll(wayId: string): ShelterAtollGrid {
  const outline = allRims().get(wayId) as RimRing;
  const padDeg = SHELTER_BAND_KM / KM_PER_DEG_LAT + 2 * SHELTER_STEP_DEG;
  const reach = padBox(boxOf(outline), padDeg);
  const allIslands = exposureIslands();
  const islands = allIslands.map(({ ring }) => ({ ring, box: boxOf(ring) })).filter(({ box }) => overlaps(box, reach));
  const rings = exposureRings();
  const openings = readOpenings();
  const shoals = exposureShoals();

  // Whose water each spot is follows the layer's one rule (seaOwner): this atoll's lagoon or sea, another atoll's
  // water, or nothing past the band.
  const region = (lat: number, lon: number): { kind: Region; blend?: { wayId: string; share: number } } => {
    const owner = seaOwner(lat, lon);
    if (!owner) return { kind: null };
    if (owner.wayId !== wayId) return { kind: "other" };
    if (owner.island) return { kind: "land" };
    return { kind: owner.outside ? "outer" : "inner", blend: owner.blend };
  };
  const exposureAt = (lat: number, lon: number) =>
    siteExposure({ lat, lon, kind: "lagoon", inwardBearingDeg: null, ownWayId: wayId }, rings, openings, allIslands, shoals);

  const south = Math.floor(reach.south / SHELTER_STEP_DEG) * SHELTER_STEP_DEG;
  const west = Math.floor(reach.west / SHELTER_STEP_DEG) * SHELTER_STEP_DEG;
  const rows = Math.ceil((reach.north - south) / SHELTER_STEP_DEG);
  const columns = Math.ceil((reach.east - west) / SHELTER_STEP_DEG);

  const coarse = new LayerBuilder(south, west, rows, columns);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const lat = south + (row + 0.5) * SHELTER_STEP_DEG;
      const lon = west + (column + 0.5) * SHELTER_STEP_DEG;
      const { kind, blend } = region(lat, lon);
      if (kind) coarse.add(row, column, kind, kind === "inner" || kind === "outer" ? exposureAt(lat, lon) : null, blend);
    }
  }

  // Fine cells: the water near each island, found island by island, then built in row order.
  const fineCells = new Set<number>();
  const fineColumns = columns * FINE_PER_COARSE;
  const fineRows = rows * FINE_PER_COARSE;
  const nearDeg = SHELTER_FINE_KM / KM_PER_DEG_LAT + SHELTER_FINE_STEP_DEG;
  for (const island of islands) {
    const box = padBox(island.box, nearDeg);
    const firstRow = Math.max(0, Math.floor((box.south - south) / SHELTER_FINE_STEP_DEG));
    const lastRow = Math.min(fineRows - 1, Math.ceil((box.north - south) / SHELTER_FINE_STEP_DEG));
    const firstColumn = Math.max(0, Math.floor((box.west - west) / SHELTER_FINE_STEP_DEG));
    const lastColumn = Math.min(fineColumns - 1, Math.ceil((box.east - west) / SHELTER_FINE_STEP_DEG));
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const key = row * fineColumns + column;
        if (fineCells.has(key)) continue;
        const lat = south + (row + 0.5) * SHELTER_FINE_STEP_DEG;
        const lon = west + (column + 0.5) * SHELTER_FINE_STEP_DEG;
        if (outlineKm(lat, lon, island.ring) <= SHELTER_FINE_KM || pointInRing(lat, lon, island.ring)) fineCells.add(key);
      }
    }
  }
  const fine = new LayerBuilder(south, west, fineRows, fineColumns);
  for (const key of [...fineCells].sort((a, b) => a - b)) {
    const row = Math.floor(key / fineColumns);
    const column = key % fineColumns;
    const lat = south + (row + 0.5) * SHELTER_FINE_STEP_DEG;
    const lon = west + (column + 0.5) * SHELTER_FINE_STEP_DEG;
    const { kind, blend } = region(lat, lon);
    if (kind) fine.add(row, column, kind, kind === "inner" || kind === "outer" ? exposureAt(lat, lon) : null, blend);
  }
  return { coarse: coarse.build(), fine: fine.build() };
}

/** Collects one layer's cells in row order into runs per region. */
class LayerBuilder {
  private runs: Record<"inner" | "outer" | "land" | "other", ShelterRuns> = { inner: [], outer: [], land: [], other: [] };
  private exposures: Record<"inner" | "outer", SiteExposure[]> = { inner: [], outer: [] };
  private blend: Record<string, [number, number, number][]> = {};

  constructor(
    private south: number,
    private west: number,
    private rows: number,
    private columns: number,
  ) {}

  add(
    row: number,
    column: number,
    kind: Exclude<Region, null>,
    exposure: SiteExposure | null,
    blend?: { wayId: string; share: number },
  ): void {
    if (blend) (this.blend[blend.wayId] ??= []).push([row, column, Math.round(blend.share * 100)]);
    const runs = this.runs[kind];
    const last = runs[runs.length - 1];
    if (last && last[0] === row && last[1] + last[2] === column) last[2] += 1;
    else runs.push([row, column, 1]);
    if ((kind === "inner" || kind === "outer") && exposure) this.exposures[kind].push(exposure);
  }

  build(): ShelterLayerGrid {
    return {
      south: round(this.south),
      west: round(this.west),
      rows: this.rows,
      columns: this.columns,
      inner: this.runs.inner,
      outer: this.runs.outer,
      land: this.runs.land,
      other: this.runs.other,
      blend: this.blend,
      cells: encodeCells(packExposures([...this.exposures.inner, ...this.exposures.outer])),
    };
  }
}

function boxOf(ring: RimRing): Box {
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const [lat, lon] of ring) {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lon);
    east = Math.max(east, lon);
  }
  return { south, north, west, east };
}

function padBox(box: Box, by: number): Box {
  return { south: box.south - by, north: box.north + by, west: box.west - by, east: box.east + by };
}

function overlaps(a: Box, b: Box): boolean {
  return a.north >= b.south && a.south <= b.north && a.east >= b.west && a.west <= b.east;
}


function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function cellCount(layer: ShelterLayerGrid): number {
  return [...layer.inner, ...layer.outer].reduce((sum, run) => sum + run[2], 0);
}

/** Builds one atoll in a child process, writing its grid to `out`. */
function runChild(wayId: string, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [process.argv[1], __filename, "--atoll", wayId, "--out", out], {
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`atoll ${wayId}: exit ${code}`))));
  });
}

async function main(): Promise<void> {
  const flag = (name: string) => {
    const at = process.argv.indexOf(name);
    return at >= 0 ? process.argv[at + 1] : undefined;
  };
  const only = flag("--atoll");
  if (only) {
    const started = Date.now();
    const grid = buildAtoll(only);
    fs.writeFileSync(flag("--out") as string, JSON.stringify(grid));
    console.log(
      `${only}: ${cellCount(grid.coarse)} cells, ${cellCount(grid.fine)} fine (${Math.round((Date.now() - started) / 1000)} s)`,
    );
    return;
  }
  const ids = [...allRims().keys()];
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "shelter-grid-"));
  const queue = [...ids];
  const workers = Array.from({ length: Math.min(os.cpus().length, ids.length) }, async () => {
    for (let wayId = queue.shift(); wayId; wayId = queue.shift()) await runChild(wayId, path.join(scratch, `${wayId}.json`));
  });
  await Promise.all(workers);
  const atolls: Record<string, ShelterAtollGrid> = {};
  for (const wayId of ids) atolls[wayId] = JSON.parse(fs.readFileSync(path.join(scratch, `${wayId}.json`), "utf8"));
  fs.rmSync(scratch, { recursive: true, force: true });
  const body: ShelterGridFile = {
    stepDeg: SHELTER_STEP_DEG,
    fineStepDeg: SHELTER_FINE_STEP_DEG,
    bandKm: SHELTER_BAND_KM,
    fineKm: SHELTER_FINE_KM,
    directions: SHELTER_DIRECTIONS,
    atolls,
  };
  const out = path.join(process.cwd(), "data", "shelter-grid.json");
  fs.writeFileSync(out, `${JSON.stringify(body)}\n`);
  const coarse = Object.values(atolls).reduce((sum, atoll) => sum + cellCount(atoll.coarse), 0);
  const fine = Object.values(atolls).reduce((sum, atoll) => sum + cellCount(atoll.fine), 0);
  console.log(`${coarse} cells and ${fine} fine cells written to ${path.relative(process.cwd(), out)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
