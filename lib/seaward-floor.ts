import { DEFAULT_SEAWARD_KM, SEAWARD_STEPS_KM } from "./floor-sample";
import { readDataFileIfPresent } from "./data-files";


export type SeawardStep = {
  km: number;
  lat: number;
  lon: number;
  elevationM: number;
  tid: number;
};

export type SeawardSite = {
  km: number;
  open: boolean;
  pinElevationM: number;
  pinTid: number;
  steps: SeawardStep[];
};

/** Written by scripts/sample-floors.ts from a GEBCO 2026 subset. Absent file: every site stays at 3 km. */
export type SeawardFloor = {
  grid: "GEBCO_2026";
  doi: string;
  openOceanM: number;
  sites: Record<string, SeawardSite>;
};

let cached: SeawardFloor | null | undefined;

export function readSeawardFloor(): SeawardFloor | null {
  if (cached !== undefined) return cached;
  const text = readDataFileIfPresent("seaward-floor.json");
  cached = text === null ? null : (JSON.parse(text) as SeawardFloor);
  return cached;
}

/** Kilometres seaward for a catalog site. Unknown ids, a closed shelf, and a bad table stay at 3 km. */
export function seawardKmFor(siteId: string): number {
  const site = readSeawardFloor()?.sites[siteId];
  if (!site?.open) return DEFAULT_SEAWARD_KM;
  const km = site.km;
  return (SEAWARD_STEPS_KM as readonly number[]).includes(km) ? km : DEFAULT_SEAWARD_KM;
}
