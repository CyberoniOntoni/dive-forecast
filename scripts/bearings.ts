import { resolveBearing } from "../lib/bearing";
import { seawardPoint } from "../lib/marine";
import { seawardKmFor } from "../lib/seaward-floor";
import { rimForAtoll } from "../lib/rim";
import { readCatalog } from "../lib/store";

/** Prints how each seeded site's inward bearing resolves. Pass site ids to filter. */
function main(): void {
  const only = new Set(process.argv.slice(2));
  const catalog = readCatalog();
  console.log("site".padEnd(28), "source".padEnd(12), "bearing", "seaward sample point");
  for (const site of catalog.sites) {
    if (only.size > 0 && !only.has(site.id)) continue;
    const atoll = catalog.atolls.find((item) => item.id === site.atollId);
    if (!atoll) {
      console.log(site.id.padEnd(28), "NO ATOLL", site.atollId);
      continue;
    }
    const outside = { lat: atoll.oceanLat, lon: atoll.oceanLon };
    const { deg, source } = resolveBearing(site, catalog.sites, outside, rimForAtoll(atoll));
    const point = seawardPoint(site.lat, site.lon, deg, seawardKmFor(site.id));
    const at = `${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`;
    console.log(site.id.padEnd(28), source.padEnd(12), deg.toFixed(0).padStart(4), "   ", at);
  }
}

main();
