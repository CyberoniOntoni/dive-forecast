import fs from "fs";
import path from "path";
import { resolveBearing } from "../lib/bearing";
import { GAP_STEP_M, gapWidthM } from "../lib/channel-gap";
import { rimForAtoll } from "../lib/rim";
import { readCatalog } from "../lib/store";

/**
 * Candidate channel widths from the Allen Coral Atlas geomorphic map. Prints a table and writes nothing:
 * each candidate is reviewed on the Atlas satellite mosaic before it goes into data/sites.json as atlasWidthM.
 * The map is the GeoJSON from an Atlas download (Geomorphic-Map/geomorphic.geojson), too large to commit.
 */
const GEOMORPHIC = path.join(process.cwd(), "data", "sources", "aca-bathy", "Geomorphic-Map", "geomorphic.geojson");
const REEF_TOP = new Set(["Reef Crest", "Outer Reef Flat", "Inner Reef Flat"]);
const CHANNEL_TYPES = new Set(["pass", "channel-thila", "corner", "strait-wall"]);
/** Half the transect, metres. */
const HALF_M = 2500;
/** Turns tried either side of square to the inward bearing. The narrowest crossing is the width. */
const TURNS_DEG = Array.from({ length: 25 }, (_, i) => -60 + i * 5);
const BOX_DEG = 0.03;

type Ring = number[][];
type Reef = { box: [number, number, number, number]; rings: Ring[] };

function main(): void {
  if (!fs.existsSync(GEOMORPHIC)) {
    console.log(`No geomorphic map at ${path.relative(process.cwd(), GEOMORPHIC)}. Download it from the Allen Coral Atlas.`);
    return;
  }
  const catalog = readCatalog();
  const sites = catalog.sites.filter((site) => CHANNEL_TYPES.has(String(site.siteType)));
  const near = (box: Reef["box"], lat: number, lon: number) =>
    box[2] > lon - BOX_DEG && box[0] < lon + BOX_DEG && box[3] > lat - BOX_DEG && box[1] < lat + BOX_DEG;

  const map = JSON.parse(fs.readFileSync(GEOMORPHIC, "utf8")) as {
    features: { properties: { class: string }; geometry: { type: string; coordinates: unknown } }[];
  };
  const reefs: Reef[] = [];
  for (const feature of map.features) {
    if (!REEF_TOP.has(feature.properties.class)) continue;
    const polygons = (feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates) as Ring[][];
    for (const rings of polygons) {
      const box: Reef["box"] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [lon, lat] of rings[0]) {
        box[0] = Math.min(box[0], lon);
        box[1] = Math.min(box[1], lat);
        box[2] = Math.max(box[2], lon);
        box[3] = Math.max(box[3], lat);
      }
      if (sites.some((site) => near(box, site.lat, site.lon))) reefs.push({ box, rings });
    }
  }

  console.log("site,type,atoll,published_m,atlas_m");
  for (const site of sites) {
    const atoll = catalog.atolls.find((item) => item.id === site.atollId);
    if (!atoll) continue;
    const outside = { lat: atoll.oceanLat, lon: atoll.oceanLon };
    const inward = resolveBearing(site, catalog.sites, outside, rimForAtoll(atoll)).deg;
    const local = reefs.filter((reef) => near(reef.box, site.lat, site.lon));
    let best: number | null = null;
    for (const turn of TURNS_DEG) {
      const width = gapWidthM(transect(site.lat, site.lon, inward + 90 + turn, local));
      if (width != null && (best == null || width < best)) best = width;
    }
    console.log([site.id, site.siteType, site.atollId, site.channelWidthM ?? "", best ?? ""].join(","));
  }
}

function transect(lat: number, lon: number, bearingDeg: number, reefs: readonly Reef[]): boolean[] {
  // Flat-earth steps: a 5 km transect is short enough.
  const rad = (bearingDeg * Math.PI) / 180;
  const metresPerDegLon = 111_320 * Math.cos((lat * Math.PI) / 180);
  const samples: boolean[] = [];
  for (let d = -HALF_M; d <= HALF_M; d += GAP_STEP_M) {
    const y = lat + (d * Math.cos(rad)) / 111_320;
    const x = lon + (d * Math.sin(rad)) / metresPerDegLon;
    samples.push(reefs.some((reef) => onReef(reef, x, y)));
  }
  return samples;
}

function onReef(reef: Reef, x: number, y: number): boolean {
  if (x < reef.box[0] || x > reef.box[2] || y < reef.box[1] || y > reef.box[3]) return false;
  return inRing(x, y, reef.rings[0]) && !reef.rings.slice(1).some((hole) => inRing(x, y, hole));
}

function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

main();
