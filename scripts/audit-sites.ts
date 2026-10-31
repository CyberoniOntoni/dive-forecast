import { atollForPin, resolveBearing } from "../lib/bearing";
import { distanceKm } from "../lib/geometry";
import { readIslands } from "../lib/islands";
import { seawardPoint } from "../lib/marine";
import { allRims, pointInRing, rimEdgeKm, rimForAtoll, ringBox } from "../lib/rim";
import { seawardKmFor } from "../lib/seaward-floor";
import { deriveSiteType } from "../lib/site-type";
import { readCatalog } from "../lib/store";

/**
 * Flags seeded sites whose catalog record disagrees with the geometry, for a person to check against imagery and
 * sources. Changes nothing.
 *
 *   npm run audit-sites
 *
 * Checks: pin on an island; pin inside or near another atoll's outline than its own; pin far from its outline
 * (outside, more than 3 km); seaward sample point inside the outline; a derived type unlike the one position and name
 * suggest; a "Kandu" typed lagoon; fallback bearings outside the lagoon; pins within 150 m of each other; two sites of one atoll with one name.
 * A type set by hand and a lagoon site's fallback bearing are deliberate and not flagged.
 */
function main(): void {
  const catalog = readCatalog();
  const islands = readIslands().map((island) => ({ island, box: ringBox(island.ring) }));
  const rims = allRims();
  const flags: string[] = [];
  const flag = (id: string, text: string) => flags.push(`${id.padEnd(30)} ${text}`);

  for (const site of catalog.sites) {
    const atoll = catalog.atolls.find((item) => item.id === site.atollId);
    if (!atoll) {
      flag(site.id, `unknown atoll ${site.atollId}`);
      continue;
    }
    const ring = rimForAtoll(atoll);
    const onIsland = islands.find(
      ({ island, box }) =>
        site.lat >= box.south && site.lat <= box.north && site.lon >= box.west && site.lon <= box.east &&
        pointInRing(site.lat, site.lon, island.ring),
    );
    if (onIsland) flag(site.id, `pin on an island (${onIsland.island.areaHa.toFixed(1)} ha)`);

    const byPin = atollForPin(site.lat, site.lon, catalog.atolls);
    if (byPin && byPin.id !== atoll.id && rimForAtoll(byPin) !== ring) {
      flag(site.id, `pin is in/near ${byPin.id}, catalog says ${atoll.id}`);
    }
    if (!ring) {
      flag(site.id, "atoll has no stored outline");
      continue;
    }
    const inside = pointInRing(site.lat, site.lon, ring);
    const edgeKm = rimEdgeKm(site, ring);
    if (!inside && edgeKm > 3) flag(site.id, `${edgeKm.toFixed(1)} km outside its outline`);
    for (const [wayId, other] of rims) {
      if (other === ring) continue;
      if (pointInRing(site.lat, site.lon, other)) flag(site.id, `inside outline ${wayId} (not its own)`);
    }

    const outside = { lat: atoll.oceanLat, lon: atoll.oceanLon };
    const { deg, source } = resolveBearing(site, catalog.sites, outside, ring);
    const sample = seawardPoint(site.lat, site.lon, deg, seawardKmFor(site.id));
    if (source === "fallback" && site.siteType !== "lagoon") flag(site.id, `fallback bearing ${deg.toFixed(0)}°`);
    if (pointInRing(sample.lat, sample.lon, ring) && site.siteType !== "lagoon") {
      flag(site.id, `seaward sample point (${source} ${deg.toFixed(0)}°) is inside the outline`);
    }

    // A channel the coarse outline puts inside the lagoon gets the lagoon model and a centroid bearing, unless set by hand.
    if (/\bkandu\b|\bkandoo\b|\bexpress\b/i.test(site.name) && site.siteType === "lagoon") {
      flag(site.id, `named as a channel but typed lagoon (${edgeKm.toFixed(2)} km inside); set "pass" by hand if it cuts the rim`);
    }
    const derived = deriveSiteType(site, ring);
    if (derived && site.siteType && derived !== site.siteType && site.siteTypeSource !== "manual") {
      flag(site.id, `type ${site.siteType} (${site.siteTypeSource}), position/name suggest ${derived}; ${inside ? "inside" : "outside"} ${edgeKm.toFixed(2)} km from rim`);
    }
  }

  const sites = catalog.sites;
  for (let i = 0; i < sites.length; i += 1) {
    for (let j = i + 1; j < sites.length; j += 1) {
      const km = distanceKm(sites[i], sites[j]);
      if (km < 0.15) flag(sites[i].id, `${(km * 1000).toFixed(0)} m from ${sites[j].id}`);
      const sameAtoll = sites[i].atollId === sites[j].atollId;
      if (sameAtoll && sites[i].name.toLowerCase() === sites[j].name.toLowerCase()) flag(sites[i].id, `same name as ${sites[j].id}`);
    }
  }
  console.log(flags.join("\n"));
  console.log(`\n${flags.length} flags over ${sites.length} sites`);
}

main();
