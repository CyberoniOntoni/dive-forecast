import fs from "fs";
import path from "path";
import { resolveBearing } from "../lib/bearing";
import { ALONG_REEF_TIDE_GAIN, alongReefHours } from "../lib/forecast";
import { marineCacheDir, seawardPoint } from "../lib/marine";
import { seawardKmFor } from "../lib/seaward-floor";
import { rimForAtoll } from "../lib/rim";
import { alongReefHeading, flowsAlongReef } from "../lib/site-type";
import { readCatalog } from "../lib/store";
import { STRENGTHS, type MarineHour } from "../lib/types";

/**
 * Checks the along-reef current at outer walls.
 *
 *   npm run along-reef-calibrate
 *
 * For each along-reef site with a cached series it projects the hourly Open-Meteo current (SMOC: FES2014 tide plus
 * drift) onto the reef line and splits it into the 25-hour mean (drift) and the rest (tidal stream). It reports:
 * - how often the tidal stream turns per day (about four for M2) and how closely it follows the sea level;
 * - turns per day and the one-way share of the forecast series, after ALONG_REEF_TIDE_GAIN;
 * - how the forecast's strength bands fall.
 * Reads only the local marine cache.
 */
function cachedHours(lat: number, lon: number): MarineHour[] | null {
  const name = `${(lat === 0 ? 0 : lat).toFixed(4)}_${(lon === 0 ? 0 : lon).toFixed(4)}.json`.replace(/[^0-9.+_-]/g, "");
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(marineCacheDir(), name), "utf8")) as { hours?: MarineHour[] };
    return Array.isArray(parsed.hours) && parsed.hours.length > 0 ? parsed.hours : null;
  } catch {
    return null;
  }
}

function alongComponent(hour: MarineHour, headingDeg: number): number | null {
  const speed = hour.currentVelocityMs;
  const toward = hour.currentDirectionDeg;
  if (speed == null || toward == null || !Number.isFinite(speed) || !Number.isFinite(toward)) return null;
  return speed * Math.cos(((toward - headingDeg) * Math.PI) / 180);
}

function correlation(left: readonly number[], right: readonly number[]): number {
  const n = left.length;
  const meanLeft = left.reduce((sum, value) => sum + value, 0) / n;
  const meanRight = right.reduce((sum, value) => sum + value, 0) / n;
  let cross = 0;
  let varLeft = 0;
  let varRight = 0;
  for (let index = 0; index < n; index += 1) {
    cross += (left[index] - meanLeft) * (right[index] - meanRight);
    varLeft += (left[index] - meanLeft) ** 2;
    varRight += (right[index] - meanRight) ** 2;
  }
  return cross / Math.sqrt(varLeft * varRight);
}

const turnsPerDay = (signs: readonly unknown[]) =>
  (signs.slice(1).filter((value, index) => value !== signs[index]).length * 24) / signs.length;

const quantile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : Number.NaN;
};

function main(): void {
  const catalog = readCatalog();
  const tideTurns: number[] = [];
  const tideFit: number[] = [];
  const forecastTurns: number[] = [];
  const oneWay: number[] = [];
  const bands = new Map<string, number>(STRENGTHS.map((strength) => [strength, 0]));
  let sites = 0;
  for (const site of catalog.sites) {
    if (!flowsAlongReef(site, catalog.sites)) continue;
    const atoll = catalog.atolls.find((item) => item.id === site.atollId);
    if (!atoll) continue;
    const { deg } = resolveBearing(site, catalog.sites, { lat: atoll.oceanLat, lon: atoll.oceanLon }, rimForAtoll(atoll));
    const point = seawardPoint(site.lat, site.lon, deg, seawardKmFor(site.id));
    const hours = cachedHours(point.lat, point.lon);
    if (!hours) continue;
    const heading = alongReefHeading(deg);
    const usable = hours.filter((hour) => alongComponent(hour, heading) != null && hour.seaLevelM != null);
    if (usable.length < 72) continue;
    sites += 1;

    const along = usable.map((hour) => alongComponent(hour, heading) as number);
    const tide: number[] = [];
    const level: number[] = [];
    for (let index = 12; index < along.length - 12; index += 1) {
      const mean = along.slice(index - 12, index + 13).reduce((sum, value) => sum + value, 0) / 25;
      tide.push(along[index] - mean);
      level.push(usable[index].seaLevelM as number);
    }
    tideTurns.push(turnsPerDay(tide.map(Math.sign)));
    tideFit.push(Math.abs(correlation(tide, level)));

    const forecast = alongReefHours({ hours, alongHeadingDeg: heading });
    forecastTurns.push(turnsPerDay(forecast.map((hour) => hour.direction)));
    const incoming = forecast.filter((hour) => hour.direction === "incoming").length / forecast.length;
    oneWay.push(Math.max(incoming, 1 - incoming));
    for (const hour of forecast) bands.set(hour.strength, (bands.get(hour.strength) ?? 0) + 1);
  }
  const fmt = (value: number) => value.toFixed(2);
  const total = [...bands.values()].reduce((sum, value) => sum + value, 0);
  console.log(`${sites} along-reef sites with a cached series.\n`);
  console.log("Tidal stream (hour less its 25-hour mean):");
  console.log(`  turns per day, quartiles ${fmt(quantile(tideTurns, 0.25))} / ${fmt(quantile(tideTurns, 0.5))} / ${fmt(quantile(tideTurns, 0.75))}`);
  console.log(`  |correlation| with sea level, median ${fmt(quantile(tideFit, 0.5))}\n`);
  console.log(`Forecast, tidal part ×${ALONG_REEF_TIDE_GAIN}:`);
  console.log(`  turns per day, median ${fmt(quantile(forecastTurns, 0.5))}; sites turning at least twice a day: ${forecastTurns.filter((value) => value >= 2).length} of ${sites}`);
  console.log(`  share of hours running the more common way, median ${Math.round(100 * quantile(oneWay, 0.5))} %`);
  console.log(`  bands: ${STRENGTHS.map((strength) => `${strength} ${Math.round((100 * (bands.get(strength) ?? 0)) / total)} %`).join(", ")}`);
}

main();
