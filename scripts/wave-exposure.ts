import { resolveBearing } from "../lib/bearing";
import { rimForAtoll } from "../lib/rim";
import { exposureForSite, exposureKind } from "../lib/sea-state";
import { readCatalog } from "../lib/store";
import { exposureAt } from "../lib/wave-exposure";

/**
 * Prints each seeded site's share of the offshore swell and wind waves from eight directions (lib/wave-exposure.ts),
 * for a person to check the shelter against what they know of the site. It writes nothing.
 *
 *   npm run wave-exposure              every site
 *   npm run wave-exposure -- <id>...   only these sites
 */
const SIDES = [0, 45, 90, 135, 180, 225, 270, 315];
const NAMES = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

function main(): void {
  const only = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  const catalog = readCatalog();
  console.log("site".padEnd(32), "kind".padEnd(8), "in°".padStart(4), " swell from", NAMES.map((name) => name.padStart(5)).join(""), " | wind from", NAMES.map((name) => name.padStart(5)).join(""));
  for (const site of catalog.sites) {
    if (only.length > 0 && !only.includes(site.id)) continue;
    const atoll = catalog.atolls.find((item) => item.id === site.atollId);
    if (!atoll) continue;
    const bearing = resolveBearing(site, catalog.sites, { lat: atoll.oceanLat, lon: atoll.oceanLon }, rimForAtoll(atoll)).deg;
    const exposure = exposureForSite(site, catalog.sites, atoll, bearing);
    const row = (table: number[]) => SIDES.map((deg) => exposureAt(table, deg).toFixed(2).padStart(5)).join("");
    console.log(
      site.name.slice(0, 31).padEnd(32),
      exposureKind(site, catalog.sites).padEnd(8),
      String(Math.round(bearing)).padStart(4),
      "           ",
      row(exposure.swell),
      " |          ",
      row(exposure.wind),
    );
  }
}

main();
