import { ringLevelFromSeries, ringPoints } from "../lib/atoll-ring";
import { resolveBearing } from "../lib/bearing";
import { ALONG_REEF_BANDS_MS, alongReefHours, forecastHours, RANGE_BANDS_M } from "../lib/forecast";
import { seawardPoint } from "../lib/marine";
import { seawardKmFor } from "../lib/seaward-floor";
import { rimForAtoll } from "../lib/rim";
import { alongReefHeading, crossesRim, flowsAlongReef } from "../lib/site-type";
import { readCatalog } from "../lib/store";
import { limited, longSeries } from "./long-series";
import { STRENGTHS, type MarineHour, type RingLevel, type Site, type Strength } from "../lib/types";

/**
 * Calibrates the strength bands (RANGE_BANDS_M, HYDRODYNAMICS_PLAN §4.9) on about 99 days of ocean data.
 *
 *   npm run strength-calibrate
 *
 * The model runs on eight-day pieces, as the app does (one past day, seven ahead).
 * Fetches 92 past days and 7 forecast days for every channel's sample point and every atoll's ring points (the
 * longest the marine API gives) into its own cache under the OS temp directory, so the app's six-hour cache is not
 * touched. Runs the full model (tide, through-flow, head across the atoll) with each candidate set of bands and
 * prints the share of hours in each band, and the share of channel-days whose peak reaches very strong.
 */
const CANDIDATES: { name: string; bands: typeof RANGE_BANDS_M }[] = [
  { name: "before", bands: { slack: 0.35, mild: 0.6, strong: 0.85 } },
  { name: "strong 1.3", bands: { slack: 0.25, mild: 0.6, strong: 1.3 } },
  { name: "strong 1.7", bands: { slack: 0.25, mild: 0.6, strong: 1.7 } },
  { name: "strong 2.0", bands: { slack: 0.25, mild: 0.6, strong: 2.0 } },
  { name: "strong 2.3", bands: { slack: 0.25, mild: 0.6, strong: 2.3 } },
];

type Channel = { site: Site; bearing: number; hours: MarineHour[]; ring: RingLevel[] | undefined };
type Wall = { site: Site; heading: number; hours: MarineHour[] };

const ALONG_CANDIDATES: (typeof ALONG_REEF_BANDS_MS)[] = [
  { slack: 0.15, mild: 0.5, strong: 1.0 },
  { slack: 0.15, mild: 0.5, strong: 1.3 },
  { slack: 0.15, mild: 0.5, strong: 1.6 },
  { slack: 0.15, mild: 0.5, strong: 2.0 },
];

async function loadWalls(): Promise<Wall[]> {
  const catalog = readCatalog();
  const walls = catalog.sites.filter((site) => flowsAlongReef(site, catalog.sites));
  const loaded = await limited(
    walls.map((site) => async () => {
      const atoll = catalog.atolls.find((item) => item.id === site.atollId);
      if (!atoll) return null;
      const outside = { lat: atoll.oceanLat, lon: atoll.oceanLon };
      const { deg } = resolveBearing(site, catalog.sites, outside, rimForAtoll(atoll));
      const point = seawardPoint(site.lat, site.lon, deg, seawardKmFor(site.id));
      const hours = await longSeries(point.lat, point.lon);
      return hours ? { site, heading: alongReefHeading(deg), hours } : null;
    }),
  );
  return loaded.filter((wall): wall is Wall => wall != null);
}

function wallSweep(walls: readonly Wall[]): void {
  console.log(`
${walls.length} walls running along the reef.`);
  console.log("bands (slack/mild/strong)    |  hours: slack  mild strong  very  |  wall-days peaking very strong");
  for (const bands of ALONG_CANDIDATES) {
    Object.assign(ALONG_REEF_BANDS_MS, bands);
    const counts = new Map<Strength, number>(STRENGTHS.map((strength) => [strength, 0]));
    let days = 0;
    let veryDays = 0;
    for (const wall of walls) {
      const forecast = chunks(wall.hours).flatMap((piece) => alongReefHours({ hours: piece, alongHeadingDeg: wall.heading }));
      const peakByDay = new Map<string, boolean>();
      for (const hour of forecast) {
        counts.set(hour.strength, (counts.get(hour.strength) ?? 0) + 1);
        const day = hour.time.slice(0, 10);
        peakByDay.set(day, (peakByDay.get(day) ?? false) || hour.strength === "too_strong");
      }
      days += peakByDay.size;
      veryDays += [...peakByDay.values()].filter(Boolean).length;
    }
    const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
    console.log(
      `${bands.slack}/${bands.mild}/${bands.strong}`.padEnd(29) +
        `|  ${STRENGTHS.map((s) => pct(counts.get(s) ?? 0, total).padStart(5)).join(" ")}  |  ${pct(veryDays, days)}`,
    );
  }
}

async function loadChannels(): Promise<Channel[]> {
  const catalog = readCatalog();
  const channels: Channel[] = [];
  for (const atoll of catalog.atolls) {
    const rim = rimForAtoll(atoll);
    if (!rim) continue;
    const ringSeries = await limited(ringPoints(rim).map((point) => () => longSeries(point.lat, point.lon)));
    const usable = ringSeries.filter((series): series is MarineHour[] => series != null);
    const ring = usable.length >= 9 ? ringLevelFromSeries(usable) : undefined;
    const outside = { lat: atoll.oceanLat, lon: atoll.oceanLon };
    const sites = catalog.sites.filter(
      (site) =>
        site.atollId === atoll.id && crossesRim(site, catalog.sites),
    );
    const loaded = await limited(
      sites.map((site) => async () => {
        const { deg } = resolveBearing(site, catalog.sites, outside, rim);
        const point = seawardPoint(site.lat, site.lon, deg, seawardKmFor(site.id));
        const hours = await longSeries(point.lat, point.lon);
        return hours ? { site, bearing: deg, hours, ring } : null;
      }),
    );
    for (const channel of loaded) if (channel) channels.push(channel);
  }
  return channels;
}

const CHUNK_HOURS = 8 * 24;

function chunks(hours: readonly MarineHour[]): MarineHour[][] {
  const pieces: MarineHour[][] = [];
  for (let start = 0; start + 48 <= hours.length; start += CHUNK_HOURS) pieces.push(hours.slice(start, start + CHUNK_HOURS));
  return pieces;
}

const pct = (part: number, total: number) => `${total > 0 ? Math.round((100 * part) / total) : 0} %`;

async function main(): Promise<void> {
  const channels = await loadChannels();
  const first = channels[0]?.hours[0]?.time ?? "?";
  const last = channels[0]?.hours.at(-1)?.time ?? "?";
  console.log(`${channels.length} channels, ${first} to ${last}.\n`);
  console.log("bands (slack/mild/strong m)  |  hours: slack  mild strong  very  |  channel-days peaking very strong");
  for (const candidate of CANDIDATES) {
    Object.assign(RANGE_BANDS_M, candidate.bands);
    const counts = new Map<Strength, number>(STRENGTHS.map((strength) => [strength, 0]));
    let days = 0;
    let veryDays = 0;
    const bySite: { name: string; days: number; narrowed: boolean }[] = [];
    for (const channel of channels) {
      // Eight-day pieces, as the app sees them; the model's windows grow with the square of a series' length.
      const forecast = chunks(channel.hours).flatMap((piece) =>
        forecastHours({
          hours: piece,
          inwardBearingDeg: channel.bearing,
          ringLevel: channel.ring,
          channelWidthM: channel.site.channelWidthM,
          channelDepthM: channel.site.channelDepthM,
        }),
      );
      const peakByDay = new Map<string, boolean>();
      for (const hour of forecast) {
        counts.set(hour.strength, (counts.get(hour.strength) ?? 0) + 1);
        const day = hour.time.slice(0, 10);
        peakByDay.set(day, (peakByDay.get(day) ?? false) || hour.strength === "too_strong");
      }
      days += peakByDay.size;
      const siteVery = [...peakByDay.values()].filter(Boolean).length;
      veryDays += siteVery;
      bySite.push({ name: channel.site.name, days: siteVery, narrowed: channel.site.channelWidthM != null });
    }
    const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
    const b = candidate.bands;
    console.log(
      `${candidate.name.padEnd(11)} ${b.slack}/${b.mild}/${b.strong}`.padEnd(29) +
        `|  ${STRENGTHS.map((s) => pct(counts.get(s) ?? 0, total).padStart(5)).join(" ")}  |  ${pct(veryDays, days)}`,
    );
    const top = bySite.filter((item) => item.days > 0).sort((a, b) => b.days - a.days).slice(0, 6);
    if (top.length) {
      console.log(`    most very-strong days: ${top.map((item) => `${item.name}${item.narrowed ? " (measured)" : ""} ${item.days}`).join(", ")}`);
    }
  }
}

void main().then(async () => wallSweep(await loadWalls()));
