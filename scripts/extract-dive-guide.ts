import fs from "fs";
import path from "path";
import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";

/**
 * Rebuilds data/sources/dive-guide-sites.json from the "Dive Sites" layer of the Maldives Marine Spatial
 * Planning project on SeaSketch (source: Tim Godfrey, Dive Maldives).
 *
 *   npm run extract-dive-guide
 *
 * Only facts are kept: name, atoll code, position, depth range and experience level. Positions come from the
 * record's own X/Y fields; the tile geometry is rounded to the tile grid, about 140 m at the layer's zoom.
 */

const TILES = "https://tiles.seasketch.org/projects/maldives/public/bb9cfc88-5021-434c-a585-5723dd98cf0f";
const LAYER = "REC_divesites_timgoddfrey";
const ZOOM = 5; // the layer's maxzoom: every record is present at this zoom
const OUT = path.join(process.cwd(), "data", "sources", "dive-guide-sites.json");

export type GuideSite = {
  /** SeaSketch record id (OBJECTID_1), stable across extractions. */
  guideId: number;
  name: string;
  /** Maldives administrative atoll code as the guide gives it, e.g. "K", "AA", "V". */
  atollCode: string;
  lat: number;
  lon: number;
  /** Depth range as printed, e.g. "6m - 25m". Null when blank. */
  depth: string | null;
  /** 1 (any diver) to 3 (advanced). Null when blank. */
  experience: number | null;
};

function tileRange(zoom: number): { xs: number[]; ys: number[] } {
  const n = 2 ** zoom;
  const x = (lon: number) => Math.floor(((lon + 180) / 360) * n);
  const y = (lat: number) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  };
  const span = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  // The Maldives: about 0.8S to 7.2N, 72.5E to 74E.
  return { xs: span(x(72.5), x(74)), ys: span(y(7.2), y(-0.8)) };
}

function text(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : null;
}

async function main(): Promise<void> {
  const byId = new Map<number, GuideSite>();
  const { xs, ys } = tileRange(ZOOM);
  for (const x of xs) {
    for (const y of ys) {
      const response = await fetch(`${TILES}/${ZOOM}/${x}/${y}.mvt`);
      if (!response.ok) continue;
      const layer = new VectorTile(new Pbf(new Uint8Array(await response.arrayBuffer()))).layers[LAYER];
      if (!layer) continue;
      for (let index = 0; index < layer.length; index += 1) {
        const props = layer.feature(index).properties;
        const guideId = Number(props.OBJECTID_1);
        const name = text(props.DiveSite);
        const lat = Number(props.Y);
        const lon = Number(props.X);
        if (!Number.isFinite(guideId) || !name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const experience = Number(props.DiveExperi);
        byId.set(guideId, {
          guideId,
          name,
          atollCode: text(props.Atoll) ?? "",
          lat: Math.round(lat * 1e6) / 1e6,
          lon: Math.round(lon * 1e6) / 1e6,
          depth: text(props.DiveDepth),
          experience: experience >= 1 && experience <= 3 ? experience : null,
        });
      }
    }
  }
  const sites = [...byId.values()].sort((a, b) => a.guideId - b.guideId);
  if (sites.length === 0) throw new Error("No dive sites read; the SeaSketch layer may have moved.");
  const file = {
    source: "Dive Maldives by Tim Godfrey, via the Maldives Marine Spatial Planning project on SeaSketch",
    sourceUrl: "https://www.seasketch.org/maldives/app/overlays",
    note: "Names, positions, depth ranges and experience levels only. Regenerate with npm run extract-dive-guide.",
    sites,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(file, null, 2)}\n`);
  console.log(`${sites.length} sites written to ${path.relative(process.cwd(), OUT)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
