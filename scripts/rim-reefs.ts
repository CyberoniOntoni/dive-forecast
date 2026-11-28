import fs from "fs";
import path from "path";
import { ATLAS_OVERLAYS, decodeRing, encodeRing, ringAreaM2, simplifyRing } from "../lib/atlas-overlays";
import { allRims, padBox, rimEdgeKm, ringBox } from "../lib/rim";

/**
 * Builds data/rim-reefs.json for the map's current-flow layer: the reef tops along each atoll's rim, from the Allen
 * Coral Atlas reef zones already built for the map (public/overlays/reef-zones; npm run atlas-overlays).
 *
 *   npm run rim-reefs
 *
 * Reef Crest and Outer and Inner Reef Flat are awash or a metre or two down at low tide: the flow layer stops water
 * there, and lets it through the rim everywhere else (lib/flow-raster.ts). A shape is kept when some point of it lies
 * within RIM_KM of an outline, inside or out, and goes with the nearest outline. Rerun after the overlays or rims
 * change. Where the Atlas has not mapped a rim (parts of the north), only the islands stop the water there.
 *
 * Each outline's reef tops are shapes, each its outer ring then any pools in it (holes), as rings in the map tiles'
 * encoding (encodeRing in lib/atlas-overlays.ts: integer steps of 1e-5 degrees), which keeps the file about half the
 * size of plain coordinates.
 */

const KINDS = new Set(["Reef Crest", "Outer Reef Flat", "Inner Reef Flat"]);
/** A reef top this close to an outline is part of the rim. */
const RIM_KM = 1;
/** Simplified to about 45 m: the flow layer's cells are about 200 m. */
const TOLERANCE_DEG = 0.0004;
/** Reef tops smaller than this (about 70 m across) are left out: a 200 m cell would not show them. */
const MIN_AREA_M2 = 5000;
/** Pools inside a reef top are kept from this size (half a 200 m cell), so the flow layer leaves them water. */
const MIN_HOLE_M2 = 20000;

function main(): void {
  const overlay = ATLAS_OVERLAYS.reefZones;
  const dir = path.join(process.cwd(), "public", overlay.path);
  const rims = [...allRims()].map(([wayId, ring]) => ({ wayId, ring, box: padBox(ringBox(ring), RIM_KM / 100) }));
  const byWay = new Map<string, number[][][]>();
  let points = 0;
  for (const file of fs.readdirSync(dir)) {
    if (file === "index.json") continue;
    const tile = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as [number, ...number[][]][];
    for (const [classIndex, outer, ...holes] of tile) {
      if (!KINDS.has(overlay.classes[classIndex].name)) continue;
      const ring = decodeRing(outer);
      if (ring.length < 4 || ringAreaM2(ring.map(([lat, lon]) => [lon, lat])) < MIN_AREA_M2) continue;
      let best: { wayId: string; km: number } | null = null;
      for (const rim of rims) {
        if (!ring.some(([lat, lon]) => lat >= rim.box.south && lat <= rim.box.north && lon >= rim.box.west && lon <= rim.box.east)) continue;
        for (const [lat, lon] of ring) {
          const km = rimEdgeKm({ lat, lon }, rim.ring);
          if (km <= RIM_KM && (!best || km < best.km)) best = { wayId: rim.wayId, km };
        }
      }
      if (!best) continue;
      const simple = simplifyRing(
        ring.map(([lat, lon]) => [lon, lat]),
        TOLERANCE_DEG,
      );
      if (simple.length < 4) continue;
      const pools = holes.flatMap((flat) => {
        const hole = decodeRing(flat).map(([lat, lon]) => [lon, lat] as [number, number]);
        if (hole.length < 4 || ringAreaM2(hole) < MIN_HOLE_M2) return [];
        const kept = simplifyRing(hole, TOLERANCE_DEG);
        return kept.length < 4 ? [] : [kept];
      });
      points += simple.length + pools.reduce((sum, hole) => sum + hole.length, 0);
      byWay.set(best.wayId, [...(byWay.get(best.wayId) ?? []), [encodeRing(simple), ...pools.map(encodeRing)]]);
    }
  }
  const reefs = Object.fromEntries([...byWay].sort(([a], [b]) => a.localeCompare(b)));
  const out = path.join(process.cwd(), "data", "rim-reefs.json");
  fs.writeFileSync(out, `${JSON.stringify({ source: "Allen Coral Atlas geomorphic zones (reef crest and reef flats), CC BY 4.0", reefs })}\n`);
  console.log(
    `${[...byWay.values()].reduce((sum, list) => sum + list.length, 0)} rim reef tops, ${points} points, on ` +
      `${byWay.size} outlines written to ${path.relative(process.cwd(), out)}`,
  );
}

main();
