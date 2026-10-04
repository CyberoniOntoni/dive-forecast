import fs from "fs";
import path from "path";
import { resolveBearing } from "../lib/bearing";
import { seaLevelSlopeAt, throughflowAt, THROUGHFLOW_SLOPE_PER_MS } from "../lib/forecast";
import { marineCacheDir, seawardPoint } from "../lib/marine";
import { seawardKmFor } from "../lib/seaward-floor";
import { rimForAtoll } from "../lib/rim";
import { readCatalog } from "../lib/store";
import type { MarineHour } from "../lib/types";

/**
 * Calibrates THROUGHFLOW_SLOPE_PER_MS against the owner's description: a channel facing the monsoon current runs in
 * most of the day (about 70–80 % of hours), slackening or briefly reversing near high and low water.
 *
 *   npm run throughflow-calibrate
 *
 * Reads only the local marine cache (no fetching). For each rim site (pass, channel thila, outer reef) with a cached
 * series, it takes the tide slope and the drift along the channel's inward axis for every hour, then for a sweep of
 * the constant prints how often sites facing the current run in and sites on the far side run out.
 */
const SWEEP = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.0, 1.5];

function cachedHours(lat: number, lon: number): MarineHour[] | null {
  const name = `${(lat === 0 ? 0 : lat).toFixed(4)}_${(lon === 0 ? 0 : lon).toFixed(4)}.json`.replace(/[^0-9.+_-]/g, "");
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(marineCacheDir(), name), "utf8")) as { hours?: MarineHour[] };
    return Array.isArray(parsed.hours) && parsed.hours.length > 0 ? parsed.hours : null;
  } catch {
    return null;
  }
}

type SiteSample = { id: string; flux: number; slopes: number[] };

function main(): void {
  const catalog = readCatalog();
  const samples: SiteSample[] = [];
  let missing = 0;
  for (const site of catalog.sites) {
    if (site.siteType === "lagoon" || !site.siteType) continue;
    const atoll = catalog.atolls.find((item) => item.id === site.atollId);
    if (!atoll) continue;
    const { deg } = resolveBearing(site, catalog.sites, { lat: atoll.oceanLat, lon: atoll.oceanLon }, rimForAtoll(atoll));
    const point = seawardPoint(site.lat, site.lon, deg, seawardKmFor(site.id));
    const hours = cachedHours(point.lat, point.lon);
    if (!hours) {
      missing += 1;
      continue;
    }
    const slopes: number[] = [];
    const fluxes: number[] = [];
    for (const hour of hours) {
      const slope = seaLevelSlopeAt(hours, hour.time);
      const through = throughflowAt(hours, hour.time, deg);
      if (slope == null || through == null) continue;
      slopes.push(slope);
      fluxes.push(through / THROUGHFLOW_SLOPE_PER_MS);
    }
    if (slopes.length < 24) continue;
    samples.push({ id: site.id, flux: fluxes.reduce((sum, value) => sum + value, 0) / fluxes.length, slopes });
  }

  const facing = samples.filter((item) => item.flux > 0).sort((a, b) => a.flux - b.flux);
  const away = samples.filter((item) => item.flux < 0).sort((a, b) => b.flux - a.flux);
  const median = (list: SiteSample[]) => (list.length ? Math.abs(list[Math.floor(list.length / 2)].flux) : 0);
  const strongFacing = facing.filter((item) => item.flux >= median(facing));
  const strongAway = away.filter((item) => -item.flux >= median(away));
  const peak = (item: SiteSample) => Math.max(...item.slopes.map(Math.abs));

  console.log(`${samples.length} rim sites with a cached series (${missing} without).`);
  console.log(`Drift along the inward axis: ${facing.length} sites facing the current (median ${median(facing).toFixed(3)} m/s), ${away.length} facing away (median ${median(away).toFixed(3)} m/s).`);
  console.log(`Steepest tide slope per site: median ${median(samples.map((item) => ({ ...item, flux: peak(item) })).sort((a, b) => a.flux - b.flux)).toFixed(3)} m/h.\n`);
  console.log("K (m/h per m/s)  facing current: share of hours in   far side: share of hours out");
  for (const k of SWEEP) {
    const share = (list: SiteSample[], sign: 1 | -1) => {
      let hits = 0;
      let total = 0;
      for (const item of list) {
        for (const slope of item.slopes) {
          total += 1;
          if (sign * (slope + k * item.flux) > 0) hits += 1;
        }
      }
      return total ? `${Math.round((100 * hits) / total)} %` : "n/a";
    };
    console.log(`${k.toFixed(2).padStart(6)}            ${share(strongFacing, 1).padStart(6)}                          ${share(strongAway, -1).padStart(6)}`);
  }
  console.log(`\nCurrent THROUGHFLOW_SLOPE_PER_MS: ${THROUGHFLOW_SLOPE_PER_MS}. Pick the K that gives about 70–80 % on both sides.`);
}

main();
