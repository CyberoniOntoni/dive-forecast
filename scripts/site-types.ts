import { deriveSiteType, SITE_TYPE_LABEL } from "../lib/site-type";
import { pointInRing, rimEdgeKm, rimForAtoll } from "../lib/rim";
import { readCatalog } from "../lib/store";
import { openGeomorphic } from "./aca";
import { writeSites } from "./sites-file";

/**
 * Classifies each seeded site as pass, channel thila, outer reef or lagoon, and prints why.
 *
 *   npm run site-types              print the table
 *   npm run site-types -- --write   also store derived types in data/sites.json
 *
 * With the Allen Coral Atlas download in data/sources/aca/, the reef zone under each pin is shown as context for a
 * person checking the table. It does not decide the type (see lib/site-type.ts).
 * A type set by hand (siteTypeSource "manual") is never changed. To correct a derived type, set siteType and
 * siteTypeSource: "manual" on the site.
 */
function main(): void {
  const write = process.argv.includes("--write");
  const catalog = readCatalog();
  const geomorphic = openGeomorphic();
  let changed = 0;
  console.log("site".padEnd(34), "where".padEnd(16), "reef zone".padEnd(22), "derived".padEnd(14), "stored");
  for (const site of catalog.sites) {
    const ring = rimForAtoll(catalog.atolls.find((atoll) => atoll.id === site.atollId));
    const derived = deriveSiteType(site, ring);
    const where = ring
      ? `${pointInRing(site.lat, site.lon, ring) ? "inside" : "outside"} ${rimEdgeKm(site, ring).toFixed(2)} km`
      : "no outline";
    const stored = site.siteType ? `${SITE_TYPE_LABEL[site.siteType]} (${site.siteTypeSource ?? "derived"})` : "-";
    const zone = geomorphic ? (geomorphic.zoneAt(site.lat, site.lon) ?? "off the mapped reef") : "-";
    console.log(site.name.padEnd(34), where.padEnd(16), zone.padEnd(22), (derived ? SITE_TYPE_LABEL[derived] : "-").padEnd(14), stored);
    if (write && site.siteTypeSource !== "manual" && derived && site.siteType !== derived) {
      site.siteType = derived;
      site.siteTypeSource = "derived";
      changed += 1;
    }
  }
  geomorphic?.close();
  if (!write) return;
  writeSites(catalog.sites);
  console.log(`\n${changed} site types written to data/sites.json`);
}

main();
