import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { openingsFromCrestArcs } from "../lib/openings";
import { readCatalog } from "../lib/store";
import type { SiteType } from "../lib/types";

/**
 * Mouths walked around the reef crest of every atoll. A mouth that reef flat still bridges is marked and kept.
 * Writes data/openings.json only when North Malé has at least 35 mouths. The lagoon model does not read the file.
 */
const SAMPLE_PY = path.join(process.cwd(), "scripts", "atoll-openings.py");
const BRIDGE_PY = path.join(process.cwd(), "scripts", "reef-flat-bridge.py");
const OUT = path.join(process.cwd(), "data", "openings.json");
const MATCH_KM = 0.8;
const NORTH_MALE_MIN = 35;
const CHANNEL_TYPES = new Set<SiteType>(["pass", "channel-thila", "corner"]);

type Crest = { startM: number; endM: number; points: [number, number][] };
type WayCrests = { wayId: string; atollIds: string[]; perimeterM: number; crests: Crest[] };

function main(): void {
  const result = spawnSync("python", [SAMPLE_PY], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || "crest projection failed");
  const measured = JSON.parse(result.stdout) as { ways: WayCrests[] };

  const catalog = readCatalog();
  const candidates: Candidate[] = [];
  for (const way of measured.ways) {
    const gaps = openingsFromCrestArcs(
      way.crests.map((crest) => ({ startM: crest.startM, endM: crest.endM })),
      way.perimeterM,
    );
    for (const gap of gaps) {
      const mouth = mouthBetween(way.crests, gap.startM, gap.endM, way.perimeterM);
      if (!mouth || mouth.widthM < 100 || mouth.widthM > 3000) continue;
      candidates.push({
        atollIds: way.atollIds,
        wayId: way.wayId,
        lat: round5(mouth.lat),
        lon: round5(mouth.lon),
        widthM: Math.round(mouth.widthM),
        alongM: Math.round(gap.alongM),
        a: [mouth.aLon, mouth.aLat],
        b: [mouth.bLon, mouth.bLat],
      });
    }
  }
  const blocked = reefFlatBridges(candidates);
  const openings = [];
  const matched = new Set<string>();
  for (let index = 0; index < candidates.length; index += 1) {
    const mouth = candidates[index];
    const sites = catalog.sites
      .filter(
        (site) =>
          mouth.atollIds.includes(site.atollId) &&
          site.siteType != null &&
          CHANNEL_TYPES.has(site.siteType) &&
          km(mouth.lat, mouth.lon, site.lat, site.lon) <= MATCH_KM,
      )
      .map((site) => site.id);
    for (const id of sites) matched.add(id);
    openings.push({
      atollIds: mouth.atollIds,
      wayId: mouth.wayId,
      lat: mouth.lat,
      lon: mouth.lon,
      widthM: mouth.widthM,
      alongM: mouth.alongM,
      reefFlatBridges: blocked[index],
      sites,
    });
  }
  const northMale = openings.filter((row) => row.atollIds.includes("north-male")).length;
  if (northMale < NORTH_MALE_MIN) {
    throw new Error(
      `North Malé has ${northMale} crest mouths, under ${NORTH_MALE_MIN}. data/openings.json was not replaced.`,
    );
  }

  const unseen = catalog.sites
    .filter((site) => site.siteType != null && CHANNEL_TYPES.has(site.siteType) && !matched.has(site.id))
    .map((site) => site.id);
  const body = {
    source: "Allen Coral Atlas reef crest, walked around each atoll by bearing from the rim centre",
    minM: 100,
    maxM: 3000,
    note: "Planform mouths between reef-crest shoulders. The outline only assigns crest to an atoll. reefFlatBridges marks a shallow sill and does not remove the mouth. The lagoon model does not read this file. A mouth has no depth and is not a channel section.",
    openings,
    openCoast: [],
    unseen,
  };
  fs.writeFileSync(OUT, JSON.stringify(body, null, 2) + "\n");
  const bridged = blocked.filter(Boolean).length;
  console.log(
    `${openings.length} openings (${northMale} on North Malé), ${bridged} bridged by reef flat and kept, ${unseen.length} channel sites not in an opening.`,
  );
  console.log(`Wrote ${path.relative(process.cwd(), OUT)}.`);
}

type Candidate = {
  atollIds: string[];
  wayId: string;
  lat: number;
  lon: number;
  widthM: number;
  alongM: number;
  a: [number, number];
  b: [number, number];
};

function reefFlatBridges(mouths: readonly Candidate[]): boolean[] {
  if (mouths.length === 0) return [];
  const result = spawnSync("python", [BRIDGE_PY], {
    input: JSON.stringify(mouths.map((mouth) => ({ a: mouth.a, b: mouth.b }))),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(result.stderr || "reef-flat bridge check failed");
  const flags = JSON.parse(result.stdout) as boolean[];
  if (flags.length !== mouths.length) throw new Error("reef-flat bridge check returned the wrong number of rows");
  return flags;
}

function mouthBetween(
  crests: readonly Crest[],
  startM: number,
  endM: number,
  perimeterM: number,
): { widthM: number; lat: number; lon: number; aLon: number; aLat: number; bLon: number; bLat: number } | null {
  const left = crests.filter((crest) => touches(crest, startM, perimeterM));
  const right = crests.filter((crest) => touches(crest, endM, perimeterM));
  let best = Number.POSITIVE_INFINITY;
  let lat = 0;
  let lon = 0;
  let aLon = 0;
  let aLat = 0;
  let bLon = 0;
  let bLat = 0;
  for (const a of left) {
    for (const b of right) {
      for (const [alon, alat] of a.points) {
        for (const [blon, blat] of b.points) {
          const distance = km(alat, alon, blat, blon) * 1000;
          if (distance < best) {
            best = distance;
            lat = (alat + blat) / 2;
            lon = (alon + blon) / 2;
            aLon = alon;
            aLat = alat;
            bLon = blon;
            bLat = blat;
          }
        }
      }
    }
  }
  if (!Number.isFinite(best)) return null;
  return { widthM: best, lat, lon, aLon, aLat, bLon, bLat };
}

function touches(crest: Crest, atM: number, perimeterM: number): boolean {
  const start = crest.endM < crest.startM ? crest.startM - perimeterM : crest.startM;
  const end = crest.endM < crest.startM ? crest.endM : crest.endM;
  return Math.min(Math.abs(end - atM), Math.abs(start - atM), Math.abs(end - perimeterM - atM)) < 150;
}

function km(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const mid = ((lat1 + lat2) / 2) * (Math.PI / 180);
  return Math.hypot((lat2 - lat1) * 110.57, (lon2 - lon1) * 111.32 * Math.cos(mid));
}

function round5(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

main();
