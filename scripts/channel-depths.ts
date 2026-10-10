import { spawnSync } from "child_process";
import path from "path";
import { resolveBearing } from "../lib/bearing";
import { rimForAtoll } from "../lib/rim";
import { readCatalog } from "../lib/store";

/**
 * Candidate channel depths from the Rasheed et al. (2021) Maldives bathymetry grid
 * (doi:10.1029/2020EA001207). Prints a table and writes nothing: values are reviewed before they go
 * into data/sites.json as gridDepthMeanM / gridDepthMaxM. The grid (Surface0_35s.nc, 3 GB) is linked
 * from the paper's data availability statement and goes in data/sources/rasheed-2021/.
 */
const DEPTHS_PY = path.join(process.cwd(), "scripts", "channel-depths.py");
const CHANNEL_TYPES = new Set(["pass", "channel-thila", "corner", "strait-wall"]);
/** The grid's satellite depths stop near 15-20 m; a floor shallower than this is probably that limit. */
const SATURATED_M = 15;
/** Deeper than this, the crossing has run onto the ocean slope rather than the channel floor. */
const OCEAN_SLOPE_M = 50;
/** Wider than this, the crossing is open lagoon rather than a channel. */
const OPEN_WATER_M = 2500;
/** Grid and Atlas widths further apart than this mean the two crossed different gaps. */
const WIDTH_MISMATCH = 0.35;

type Section = { id: string; widthM?: number; meanM?: number; maxM?: number };

function main(): void {
  const catalog = readCatalog();
  const sites = catalog.sites.filter((site) => CHANNEL_TYPES.has(String(site.siteType)));
  const input = sites.flatMap((site) => {
    const atoll = catalog.atolls.find((item) => item.id === site.atollId);
    if (!atoll) return [];
    const outside = { lat: atoll.oceanLat, lon: atoll.oceanLon };
    const inward = resolveBearing(site, catalog.sites, outside, rimForAtoll(atoll)).deg;
    return [{ id: site.id, lat: site.lat, lon: site.lon, inward }];
  });
  const result = spawnSync("python3", [DEPTHS_PY], { input: JSON.stringify(input), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || "channel-depths.py failed");
  const sections = JSON.parse(result.stdout) as Section[];

  console.log("site,type,atoll,atlas_width_m,grid_width_m,mean_m,max_m,confidence,reason");
  for (const section of sections) {
    const site = sites.find((item) => item.id === section.id)!;
    if (section.widthM == null || section.meanM == null || section.maxM == null) {
      console.log([site.id, site.siteType, site.atollId, site.atlasWidthM ?? "", "", "", "", "", "no closed crossing"].join(","));
      continue;
    }
    const reason = lowReason(section.widthM, section.maxM, site.atlasWidthM);
    console.log(
      [
        site.id,
        site.siteType,
        site.atollId,
        site.atlasWidthM ?? "",
        section.widthM,
        Math.round(section.meanM),
        Math.round(section.maxM),
        reason ? "low" : "ok",
        reason ?? "",
      ].join(","),
    );
  }
}

function lowReason(widthM: number, maxM: number, atlasWidthM?: number): string | null {
  if (maxM < SATURATED_M) return "floor at the satellite depth limit";
  if (maxM > OCEAN_SLOPE_M) return "crossing reaches the ocean slope";
  if (widthM > OPEN_WATER_M) return "crossing is open lagoon";
  if (atlasWidthM != null && Math.abs(widthM - atlasWidthM) / atlasWidthM > WIDTH_MISMATCH) return "width disagrees with the Atlas";
  return null;
}

main();
