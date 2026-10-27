import fs from "fs";
import path from "path";
import { ATLAS_OVERLAYS, decodeRing } from "../lib/atlas-overlays";
import { allRims, pointInRing, type RimRing } from "../lib/rim";
import { outlineKm } from "../lib/shelter-grid";
import type { ShoalKind } from "../lib/shoals";

/**
 * Builds data/shoals.json for the sea state: the shallow reef tops and sand shallows inside each atoll's lagoon, from
 * the Allen Coral Atlas reef zones already built for the map (public/overlays/reef-zones; npm run atlas-overlays).
 *
 *   npm run shoals
 *
 * Reef Crest and Outer and Inner Reef Flat are reef tops, awash or a metre or two down at low tide ("reef"); Shallow
 * Lagoon is sand a few metres down ("shallow"). Only shoals inside an outline are kept, and not the rim's own reef:
 * a shoal within RIM_TOUCH_KM of the outline, and every shoal that touches one of those in turn, is part of the rim,
 * whose reef the ray tracer already counts where a ray crosses the outline. Rerun after the overlays or rims change.
 */

const KINDS: Record<string, ShoalKind> = {
  "Reef Crest": "reef",
  "Outer Reef Flat": "reef",
  "Inner Reef Flat": "reef",
  "Shallow Lagoon": "shallow",
};
/** A shoal this close to its atoll's outline is the rim's own reef. */
const RIM_TOUCH_KM = 0.1;
/** Two shoals whose outlines come this close are one reef. */
const JOIN_KM = 0.03;

type Candidate = { kind: ShoalKind; ring: RimRing; wayId: string; rim: boolean };

function main(): void {
  const overlay = ATLAS_OVERLAYS.reefZones;
  const dir = path.join(process.cwd(), "public", overlay.path);
  const rims = [...allRims()];
  const candidates: Candidate[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (file === "index.json") continue;
    const tile = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as [number, ...number[][]][];
    for (const [classIndex, outer] of tile) {
      const kind = KINDS[overlay.classes[classIndex].name];
      if (!kind) continue;
      const ring = decodeRing(outer);
      if (ring.length < 4) continue;
      const owner = rims.find(([, rim]) => ring.every(([lat, lon]) => pointInRing(lat, lon, rim)));
      if (!owner) continue;
      const rim = ring.some(([lat, lon]) => outlineKm(lat, lon, owner[1]) <= RIM_TOUCH_KM);
      candidates.push({ kind, ring, wayId: owner[0], rim });
    }
  }

  // Spread "rim" to every shoal joined to one: the rim's flats run on into its reef crest, back reef and sand.
  const bucketDeg = 0.002;
  const buckets = new Map<string, number[]>();
  const key = (lat: number, lon: number) => `${Math.floor(lat / bucketDeg)},${Math.floor(lon / bucketDeg)}`;
  candidates.forEach(({ ring }, index) => {
    for (const [lat, lon] of ring) {
      const at = key(lat, lon);
      const list = buckets.get(at);
      if (!list) buckets.set(at, [index]);
      else if (list[list.length - 1] !== index) list.push(index);
    }
  });
  const queue = candidates.flatMap((candidate, index) => (candidate.rim ? [index] : []));
  while (queue.length > 0) {
    const from = candidates[queue.pop() as number];
    for (const [lat, lon] of from.ring) {
      const row = Math.floor(lat / bucketDeg);
      const column = Math.floor(lon / bucketDeg);
      for (let dRow = -1; dRow <= 1; dRow += 1) {
        for (let dColumn = -1; dColumn <= 1; dColumn += 1) {
          for (const index of buckets.get(`${row + dRow},${column + dColumn}`) ?? []) {
            const next = candidates[index];
            if (next.rim || !touches(from.ring, next.ring)) continue;
            next.rim = true;
            queue.push(index);
          }
        }
      }
    }
  }

  const kept = candidates.filter((candidate) => !candidate.rim);
  const shoals = kept.map(({ kind, ring }) => ({ kind, ring: ring.map(([lat, lon]) => [round(lat), round(lon)]) }));
  const out = path.join(process.cwd(), "data", "shoals.json");
  fs.writeFileSync(out, `${JSON.stringify({ source: "Allen Coral Atlas geomorphic zones, CC BY 4.0", shoals })}\n`);
  const perAtoll = new Map<string, number>();
  for (const { wayId } of kept) perAtoll.set(wayId, (perAtoll.get(wayId) ?? 0) + 1);
  console.log(
    `${candidates.length} shoals inside outlines, ${candidates.length - kept.length} part of a rim; ` +
      `${kept.length} (${kept.filter((item) => item.kind === "reef").length} reef, ` +
      `${kept.filter((item) => item.kind === "shallow").length} shallow) in ${perAtoll.size} lagoons written to ` +
      path.relative(process.cwd(), out),
  );
}

/** Whether some point of either outline comes within JOIN_KM of the other outline. */
function touches(a: RimRing, b: RimRing): boolean {
  return a.some(([lat, lon]) => outlineKm(lat, lon, b) <= JOIN_KM) || b.some(([lat, lon]) => outlineKm(lat, lon, a) <= JOIN_KM);
}

function round(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

main();
