import { ringLevelFromSeries, ringSamples, type AtollRing } from "../lib/atoll-ring";
import { resolveBearing } from "../lib/bearing";
import { CHANNEL_WEIGHT_KM, channelSource, LAGOON_BANDS, lagoonSink, lagoonVelocity, mainAxisDeg, rimSources, type LagoonSink, type LagoonSource } from "../lib/lagoon-flow";
import { seawardPoint } from "../lib/marine";
import { rimForAtoll } from "../lib/rim";
import { flowsAlongReef } from "../lib/site-type";
import { readCatalog } from "../lib/store";
import type { MarineHour, Site } from "../lib/types";
import { limited, longSeries } from "./long-series";

/**
 * Checks and calibrates the lagoon flow (HYDRODYNAMICS_PLAN §4.10) on about 99 days of ocean data.
 *
 *   npm run lagoon-calibrate
 *
 * For each atoll: the porous rim from its ring points and each channel dive site as an extra opening, then the
 * lagoon current at every lagoon site, hour by hour. For a sweep of CHANNEL_WEIGHT_KM it prints:
 * 1. turns per day along each site's main axis (the tide should turn it);
 * 2. whether sites across one lagoon point different ways at once, and whether thilas near the rim run away from
 *    it on the flood;
 * 3. whether the 99-day mean flow crosses the lagoon with the season's drift (eastward in the SW monsoon);
 * 4. the spread of the flow index, to set LAGOON_BANDS, and the thilas near channels.
 * Reads and fills the same long-series cache as strength-calibrate.
 */
const WEIGHTS = [0, 2, 5, 10];
/** LAGOON_TAU=Infinity switches the head across the atoll off for the openings, to see what drives the flow. */
const TAU = process.env.LAGOON_TAU ? Number(process.env.LAGOON_TAU) : undefined;
const KM_PER_DEG_LAT = 110.57;
const KM_PER_DEG_LON = 111.32;

type Atoll = {
  id: string;
  ring: AtollRing;
  sinks: Map<string, LagoonSink>;
  lagoon: Site[];
  channels: { site: Site; bearing: number; hours: MarineHour[] }[];
};

const quantile = (values: number[], q: number) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : Number.NaN;
};
const pct = (value: number) => (Number.isFinite(value) ? `${Math.round(100 * value)} %` : "n/a");
const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  Math.hypot((a.lat - b.lat) * KM_PER_DEG_LAT, (a.lon - b.lon) * KM_PER_DEG_LON * Math.cos((a.lat * Math.PI) / 180));

async function loadAtolls(): Promise<Atoll[]> {
  const catalog = readCatalog();
  const atolls: Atoll[] = [];
  for (const atoll of catalog.atolls) {
    const rim = rimForAtoll(atoll);
    if (!rim) continue;
    const lagoon = catalog.sites.filter((site) => site.atollId === atoll.id && site.siteType === "lagoon");
    if (lagoon.length === 0) continue;
    const samples = ringSamples(rim);
    const series = await limited(samples.map((sample) => () => longSeries(sample.seaward.lat, sample.seaward.lon)));
    const usable = series.filter((hours): hours is MarineHour[] => hours != null);
    if (usable.length < 9) continue;
    const ring: AtollRing = { samples, series, level: ringLevelFromSeries(usable) };
    const outside = { lat: atoll.oceanLat, lon: atoll.oceanLon };
    const across = catalog.sites.filter(
      (site) =>
        site.atollId === atoll.id && site.siteType && site.siteType !== "lagoon" && !flowsAlongReef(site, catalog.sites),
    );
    const channels = (
      await limited(
        across.map((site) => async () => {
          const { deg } = resolveBearing(site, catalog.sites, outside, rim);
          const point = seawardPoint(site.lat, site.lon, deg);
          const hours = await longSeries(point.lat, point.lon);
          return hours ? { site, bearing: deg, hours } : null;
        }),
      )
    ).filter((item): item is Atoll["channels"][number] => item != null);
    const sinks = new Map(lagoon.map((site) => [site.id, lagoonSink(site, rim)]));
    atolls.push({ id: atoll.id, ring, sinks, lagoon, channels });
  }
  return atolls;
}

/** Hours where the ring level rises fastest: the top quarter of its rising slopes. */
function floodHours(ring: AtollRing): Set<string> {
  const level = ring.level;
  const slopes = level.slice(1).map((item, index) => ({ time: level[index].time, slope: item.levelM - level[index].levelM }));
  const rising = slopes.filter((item) => item.slope > 0);
  const cut = quantile(rising.map((item) => item.slope), 0.75);
  return new Set(rising.filter((item) => item.slope >= cut).map((item) => item.time));
}

async function main(): Promise<void> {
  const atolls = await loadAtolls();
  const sites = atolls.reduce((sum, atoll) => sum + atoll.lagoon.length, 0);
  console.log(`${atolls.length} atolls, ${sites} lagoon sites, ${atolls.reduce((s, a) => s + a.channels.length, 0)} channels.\n`);
  for (const weight of WEIGHTS) {
    const turns: number[] = [];
    const coherence: number[] = [];
    let awayHits = 0;
    let awayTotal = 0;
    let eastward = 0;
    let atollCount = 0;
    const hourly: number[] = [];
    const peaks: number[] = [];
    const nearChannel: string[] = [];
    for (const atoll of atolls) {
      const sources: LagoonSource[] = [
        ...rimSources(atoll.ring, TAU),
        ...atoll.channels.map((item) => channelSource(item.site, item.hours, item.bearing, atoll.ring.level, weight, TAU)),
      ];
      const times = atoll.ring.level.map((item) => item.time);
      const flood = floodHours(atoll.ring);
      const rimPoints = atoll.ring.samples.map((sample) => sample.on);
      const vectors = new Map<string, Map<string, { east: number; north: number }>>();
      let meanEast = 0;
      let meanCount = 0;
      for (const site of atoll.lagoon) {
        const byTime = new Map<string, { east: number; north: number }>();
        for (const time of times) {
          const u = lagoonVelocity(site, sources, time, atoll.sinks.get(site.id));
          if (u) byTime.set(time, u);
        }
        vectors.set(site.id, byTime);
        const list = [...byTime.values()];
        if (list.length < 48) continue;
        const axis = (mainAxisDeg(list) * Math.PI) / 180;
        const along = list.map((u) => u.east * Math.sin(axis) + u.north * Math.cos(axis));
        turns.push((along.slice(1).filter((v, i) => Math.sign(v) !== Math.sign(along[i])).length * 24) / along.length);
        for (const v of along) hourly.push(Math.abs(v));
        const days = new Map<string, number>();
        [...byTime.keys()].forEach((time, index) => {
          const day = time.slice(0, 10);
          days.set(day, Math.max(days.get(day) ?? 0, Math.abs(along[index])));
        });
        peaks.push(...days.values());
        for (const u of list) {
          meanEast += u.east;
          meanCount += 1;
        }
        // Thilas near the rim on the flood: away from their nearest rim point means a positive dot product.
        const nearest = rimPoints.reduce((best, point) => (km(site, point) < km(site, best) ? point : best), rimPoints[0]);
        if (km(site, nearest) <= 3) {
          const awayEast = (site.lon - nearest.lon) * KM_PER_DEG_LON * Math.cos((site.lat * Math.PI) / 180);
          const awayNorth = (site.lat - nearest.lat) * KM_PER_DEG_LAT;
          for (const time of flood) {
            const u = byTime.get(time);
            if (!u) continue;
            awayTotal += 1;
            if (u.east * awayEast + u.north * awayNorth > 0) awayHits += 1;
          }
        }
        if (weight === CHANNEL_WEIGHT_KM) {
          const channel = atoll.channels.reduce<{ name: string; d: number } | null>((best, item) => {
            const d = km(site, item.site);
            return d < 2 && (!best || d < best.d) ? { name: item.site.name, d } : best;
          }, null);
          if (channel) nearChannel.push(`${site.name} (${channel.name} ${channel.d.toFixed(1)} km): peak p50 ${quantile([...days.values()], 0.5).toFixed(3)}`);
        }
      }
      if (meanCount > 0) {
        atollCount += 1;
        if (meanEast > 0) eastward += 1;
      }
      if (atoll.lagoon.length >= 3) {
        for (const time of times) {
          let east = 0;
          let north = 0;
          let n = 0;
          for (const site of atoll.lagoon) {
            const u = vectors.get(site.id)?.get(time);
            if (!u) continue;
            const length = Math.hypot(u.east, u.north);
            if (length === 0) continue;
            east += u.east / length;
            north += u.north / length;
            n += 1;
          }
          if (n >= 3) coherence.push(Math.hypot(east, north) / n);
        }
      }
    }
    console.log(`CHANNEL_WEIGHT_KM ${weight}`);
    console.log(`  1. turns per day along the main axis: median ${quantile(turns, 0.5).toFixed(1)}, p25 ${quantile(turns, 0.25).toFixed(1)} (gate: median ≥ 2)`);
    console.log(`  2. sites across a lagoon pointing the same way (1 = all one way): median ${quantile(coherence, 0.5).toFixed(2)}`);
    console.log(`     thilas within 3 km of the rim running away from it at mid-flood: ${pct(awayHits / awayTotal)} of ${awayTotal} site-hours`);
    console.log(`  3. atolls whose 99-day mean lagoon flow heads east (SW monsoon): ${eastward} of ${atollCount}`);
    console.log(`  4. flow index |v|: hourly p25 ${quantile(hourly, 0.25).toFixed(3)}, p50 ${quantile(hourly, 0.5).toFixed(3)}, p90 ${quantile(hourly, 0.9).toFixed(3)}`);
    console.log(`     daily peak p50 ${quantile(peaks, 0.5).toFixed(3)}, p90 ${quantile(peaks, 0.9).toFixed(3)}, p97 ${quantile(peaks, 0.97).toFixed(3)}, p99 ${quantile(peaks, 0.99).toFixed(3)}`);
    const band = (v: number) => (v < LAGOON_BANDS.slack ? 0 : v < LAGOON_BANDS.mild ? 1 : v < LAGOON_BANDS.strong ? 2 : 3);
    const shares = [0, 1, 2, 3].map((b) => pct(hourly.filter((v) => band(v) === b).length / hourly.length));
    const veryDays = pct(peaks.filter((v) => v >= LAGOON_BANDS.strong).length / peaks.length);
    console.log(`     bands ${LAGOON_BANDS.slack}/${LAGOON_BANDS.mild}/${LAGOON_BANDS.strong}: hours slack ${shares[0]}, mild ${shares[1]}, strong ${shares[2]}, very ${shares[3]}; days peaking very strong ${veryDays}`);
    for (const line of nearChannel.slice(0, 8)) console.log(`     near a channel: ${line}`);
    console.log("");
  }
}

void main();
