import fs from "fs";
import path from "path";
import { resolveBearing } from "../lib/bearing";
import { ACA_MAX_DEPTH_M, pickSeawardKm, SEAWARD_STEPS_KM, sectionFromTransect } from "../lib/floor-sample";
import { gebcoCenter, gebcoIndex, parseDodsGrid } from "../lib/gebco-grid";
import { seawardPoint } from "../lib/marine";
import { rimForAtoll } from "../lib/rim";
import type { SeawardSite } from "../lib/seaward-floor";
import { readCatalog } from "../lib/store";

const ELEVATION_URL =
  "https://dap.ceda.ac.uk/thredds/dodsC/bodc/gebco/global/gebco_2026/ice_surface_elevation/netcdf/GEBCO_2026.nc.dods";
const TID_URL =
  "https://dap.ceda.ac.uk/thredds/dodsC/bodc/gebco/global/gebco_2026/type_identifier_grid/netcdf/gebco_2026_tid.nc.dods";
const OUT_PATH = path.join(process.cwd(), "data", "seaward-floor.json");
const BAA_TIF = path.join(process.cwd(), "data", "sources", "baa", "Algorithm_2_3ord_Baa.tif");
const ACA_DIR = path.join(process.cwd(), "data", "sources", "aca-bathy");

/** East of Malé, checked against the live grid: about -2490 m. A wrong index fails here. */
const CONTROL = { lat: 4.202083333333334, lon: 74.00208333333333, deeperThan: -2000 };

type SamplePoint = { km: number; lat: number; lon: number };

async function main(): Promise<void> {
  const catalog = readCatalog();
  const plans: { id: string; pin: SamplePoint; steps: SamplePoint[] }[] = [];
  for (const site of catalog.sites) {
    const atoll = catalog.atolls.find((item) => item.id === site.atollId);
    if (!atoll) continue;
    const outside = { lat: atoll.oceanLat, lon: atoll.oceanLon };
    const bearing = resolveBearing(site, catalog.sites, outside, rimForAtoll(atoll)).deg;
    const steps = SEAWARD_STEPS_KM.map((km) => {
      const point = seawardPoint(site.lat, site.lon, bearing, km);
      return { km, lat: point.lat, lon: point.lon };
    });
    plans.push({ id: site.id, pin: { km: 0, lat: site.lat, lon: site.lon }, steps });
  }

  let row0 = Infinity;
  let row1 = -Infinity;
  let col0 = Infinity;
  let col1 = -Infinity;
  const include = (lat: number, lon: number) => {
    const index = gebcoIndex(lat, lon);
    row0 = Math.min(row0, index.row);
    row1 = Math.max(row1, index.row);
    col0 = Math.min(col0, index.col);
    col1 = Math.max(col1, index.col);
  };
  include(CONTROL.lat, CONTROL.lon);
  for (const plan of plans) {
    include(plan.pin.lat, plan.pin.lon);
    for (const step of plan.steps) include(step.lat, step.lon);
  }
  row0 -= 1;
  row1 += 1;
  col0 -= 1;
  col1 += 1;
  const rows = row1 - row0 + 1;
  const cols = col1 - col0 + 1;
  if (rows < 1 || cols < 1 || rows > 4000 || cols > 2000) {
    throw new Error(`GEBCO window ${rows} by ${cols} is outside the Maldives subset`);
  }

  console.log(`Fetching GEBCO 2026 rows ${row0}..${row1}, cols ${col0}..${col1} (${rows} by ${cols}).`);
  const [elevation, tid] = await Promise.all([
    fetchGrid(ELEVATION_URL, "elevation", "int16", row0, row1, col0, col1),
    fetchGrid(TID_URL, "tid", "byte", row0, row1, col0, col1),
  ]);
  if (elevation.values.length !== tid.values.length) {
    throw new Error("Elevation and TID subsets do not cover the same cells");
  }
  const gridWindow = { row0, col0, rows, cols };
  const control = gebcoIndex(CONTROL.lat, CONTROL.lon);
  const controlValue = cell(elevation.values, gridWindow, control.row, control.col);
  if (controlValue > CONTROL.deeperThan) {
    throw new Error(
      `Control cell at ${CONTROL.lat}, ${CONTROL.lon} was ${controlValue} m, expected deeper than ${CONTROL.deeperThan} m`,
    );
  }
  console.log(`Control cell ${controlValue} m, TID ${cell(tid.values, gridWindow, control.row, control.col)}.`);

  const sites: Record<string, SeawardSite> = {};
  const moved: string[] = [];
  const closed: string[] = [];
  const pinOnLand: string[] = [];
  for (const plan of plans.sort((a, b) => a.id.localeCompare(b.id))) {
    const steps = plan.steps.map((step) => {
      const index = gebcoIndex(step.lat, step.lon);
      return {
        km: step.km,
        lat: round5(step.lat),
        lon: round5(step.lon),
        elevationM: cell(elevation.values, gridWindow, index.row, index.col),
        tid: cell(tid.values, gridWindow, index.row, index.col),
      };
    });
    const pinIndex = gebcoIndex(plan.pin.lat, plan.pin.lon);
    const picked = pickSeawardKm(steps);
    const pinElevationM = cell(elevation.values, gridWindow, pinIndex.row, pinIndex.col);
    sites[plan.id] = {
      km: picked.km,
      open: picked.open,
      pinElevationM,
      pinTid: cell(tid.values, gridWindow, pinIndex.row, pinIndex.col),
      steps,
    };
    if (!picked.open) closed.push(plan.id);
    else if (picked.km !== 3) moved.push(`${plan.id} ${picked.km} km`);
    if (pinElevationM >= 0) pinOnLand.push(plan.id);
  }

  const body = {
    grid: "GEBCO_2026" as const,
    doi: "10.5285/4f68d5c7-45eb-f999-e063-7086abc036fa",
    openOceanM: -50,
    window: { row0, row1, col0, col1 },
    note: "Open ocean is a GEBCO elevation of -50 m or deeper. The sample stays at 3 km when that cell is open, otherwise the first open step at 6, 9, 12, or 15 km. If none is open, it stays at 3 km. GEBCO is not a channel section. TID is stored so a gravity-predicted cell is not later treated as a sounding.",
    sites,
  };
  const tmp = `${OUT_PATH}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`);
  fs.renameSync(tmp, OUT_PATH);

  console.log(`${plans.length} sites. Stepped out: ${moved.length}. Still shallow at 15 km: ${closed.length}. Pin cell on land: ${pinOnLand.length}.`);
  for (const line of moved) console.log(`  ${line}`);
  if (closed.length > 0) console.log(`Still shallow: ${closed.join(", ")}`);
  if (pinOnLand.length > 0) console.log(`Pin cell >= 0 m: ${pinOnLand.join(", ")}`);
  reportLocalRasters();
}

type GridWindow = { row0: number; col0: number; rows: number; cols: number };

function cell(values: Int16Array | Uint8Array, window: GridWindow, row: number, col: number): number {
  const r = row - window.row0;
  const c = col - window.col0;
  if (r < 0 || c < 0 || r >= window.rows || c >= window.cols) {
    throw new Error(`Cell ${row}, ${col} is outside the downloaded window`);
  }
  return values[r * window.cols + c];
}

async function fetchGrid(
  base: string,
  variable: string,
  kind: "int16" | "byte",
  row0: number,
  row1: number,
  col0: number,
  col1: number,
): Promise<{ values: Int16Array | Uint8Array }> {
  const url = `${base}?${variable}[${row0}:1:${row1}][${col0}:1:${col1}]`;
  const response = await fetch(url, {
    headers: { "User-Agent": "dive-current-sample-floors" },
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`${variable} subset returned HTTP ${response.status}`);
  const grid = parseDodsGrid(Buffer.from(await response.arrayBuffer()), kind);
  const expectedLat = gebcoCenter(row0, col0).lat;
  const expectedLon = gebcoCenter(row0, col0).lon;
  if (Math.abs(grid.lat[0] - expectedLat) > 1e-6 || Math.abs(grid.lon[0] - expectedLon) > 1e-6) {
    throw new Error(`${variable} origin ${grid.lat[0]}, ${grid.lon[0]} is not ${expectedLat}, ${expectedLon}`);
  }
  if (grid.lat.length !== row1 - row0 + 1 || grid.lon.length !== col1 - col0 + 1) {
    throw new Error(`${variable} map is ${grid.lat.length} by ${grid.lon.length}, not the requested window`);
  }
  return { values: grid.values };
}

function reportLocalRasters(): void {
  // sectionFromTransect is the acceptance rule for these files. It is not applied until a raster is here:
  // an unobserved Allen Coral Atlas pixel is not a deep channel, and GEBCO's 450 m cell is not a pass section.
  const rule = `${sectionFromTransect.name}, Allen Coral Atlas capped at ${ACA_MAX_DEPTH_M} m`;
  if (fs.existsSync(BAA_TIF)) {
    console.log(`Baa mosaic is on disk. Depth sign is not confirmed, so no channel section was written (${rule}).`);
  } else {
    console.log("Baa mosaic is not on disk (data/sources/baa/Algorithm_2_3ord_Baa.tif).");
    console.log("Harvard Dataverse 10.7910/DVN/LP7YXK keeps that file restricted. Request access, then re-run.");
  }
  const acaTifs = fs.existsSync(ACA_DIR)
    ? fs.readdirSync(ACA_DIR).filter((name) => name.toLowerCase().endsWith(".tif"))
    : [];
  if (acaTifs.length > 0) {
    console.log(`Allen Coral Atlas bathymetry is on disk (${acaTifs.length} tif). No section written until the encoding is confirmed (${rule}).`);
  } else {
    console.log("Allen Coral Atlas bathymetry is not on disk (data/sources/aca-bathy/).");
    console.log("The Atlas serves that 10 m GeoTIFF only as a logged-in download. Drop it there, then re-run.");
  }
  console.log("No channel section was written from GEBCO, the Atlas, or the Baa mosaic.");
}

function round5(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
