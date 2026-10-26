import { readOpenings } from "./openings";
import { allRims, rimForAtoll, rimWayId } from "./rim";
import { crossesRim } from "./site-type";
import {
  angleBetween,
  exposureAt,
  offshorePoints,
  ringCentre,
  siteExposure,
  snapToWaveGrid,
  type ExposureIsland,
  type ExposureKind,
  type ExposureRing,
  type SiteExposure,
} from "./wave-exposure";
import { readIslands, WOODED_MIN_HA } from "./islands";
import { fetchWaves, type WaveComponent, type WaveHour } from "./waves";
import { fetchWind, type WindHour } from "./wind";
import type { FetchOptions } from "./marine";
import { SEA_BAND_LIMITS_M, type Atoll, type ForecastRoute, type HourForecast, type SeaBand, type SeaStateHour, type Site, type SiteWave } from "./types";

export { SEA_BAND_LIMITS_M, SEA_BANDS, type SeaBand, type SeaStateHour, type SiteWave } from "./types";

/**
 * Sea state at a dive site. Offshore waves come from Open-Meteo's wave model on the side of the atoll each sea comes
 * from; how much reaches the site comes from the atoll geometry (lib/wave-exposure.ts). It never touches the current
 * forecast or FORECAST_MODEL_VERSION.
 */

/** Short wind waves feel this much bigger than swell of the same height. */
export const WIND_WAVE_WEIGHT = 1.4;
/** Swell at least this high, running into a strong outgoing current, stands up at a channel mouth. */
export const AGAINST_CURRENT_SWELL_M = 0.8;
/**
 * Fetch-limited wind-sea growth (Shore Protection Manual, deep water): height = CHOP_GROWTH × wind speed × sqrt(fetch / g),
 * never above the fully developed sea for that wind. 10 m/s over 20 km of lagoon gives about 0.7 m. A first guess, to
 * tune from reports.
 */
export const CHOP_GROWTH = 0.0016;
const FULLY_DEVELOPED = 0.2433;
const GRAVITY = 9.81;
/** Swell within this many degrees of straight in through the channel counts as running against the outgoing current. */
const AGAINST_CURRENT_DEG = 60;

export type SeaState = { hours: SeaStateHour[]; unavailable: boolean; fetchedAt: number | null; stale: boolean };

/** The offshore sample for one side of the atoll: the side's compass bearing from the atoll and its wave hours. */
export type OffshoreSide = { sideDeg: number; hours: readonly WaveHour[] };

/**
 * Each hour's sea state at the site. For each wave component, the offshore side used is the one the sea comes from
 * (its own direction closest to the side's bearing). Wind chop is the bigger of the wave model's wind sea let through
 * the reef and what the atoll's wind raises over the open water upwind of the site. Hours missing from every side are
 * left out. When a component's upwind sample or the hour's wind is missing, the hour is still shown if what is known
 * is already rough, and left out otherwise.
 */
export function seaStateHours(input: {
  sides: readonly OffshoreSide[];
  exposure: SiteExposure;
  /**
   * 10 m wind over the atoll. Raises chop over the open water upwind of the site (exposure.fetchKm), which the wave
   * model is too coarse to see. An hour missing here makes that chop unknown.
   */
  wind: readonly WindHour[];
  /** The current forecast's hours, for the swell-against-current check. Only "channel" hours are checked. */
  current?: readonly HourForecast[];
  route?: ForecastRoute;
  /** The channel's inward bearing: swell from the opposite way runs in through it, against an outgoing current. */
  inwardBearingDeg?: number | null;
}): SeaStateHour[] {
  const byTime = input.sides.map((side) => ({ sideDeg: side.sideDeg, at: new Map(side.hours.map((hour) => [hour.time, hour])) }));
  const times = [...new Set(input.sides.flatMap((side) => side.hours.map((hour) => hour.time)))].sort();
  const windAt = new Map(input.wind.map((hour) => [hour.time, hour]));
  const currentAt = new Map((input.current ?? []).map((hour) => [hour.time, hour]));
  const result: SeaStateHour[] = [];
  for (const time of times) {
    const swellPick = upstream(byTime, time, "swell");
    const secondaryPick = upstream(byTime, time, "secondarySwell");
    const windPick = upstream(byTime, time, "windWave");
    const windHour = windAt.get(time);
    // No wind that hour: the chop it raises over the lagoon is as unknown as a missing upwind wave sample.
    const unknown = windHour == null || [swellPick, secondaryPick, windPick].some((pick) => pick.kind === "unknown");
    const swells = [swellPick, secondaryPick]
      .flatMap((pick) => (pick.kind === "value" ? [pick.wave] : []))
      .map((wave) => ({ ...wave, heightM: wave.heightM * exposureAt(input.exposure.swell, wave.fromDeg) }));
    const wind = windPick.kind === "value" ? windPick.wave : null;
    const windWaveM = Math.max(
      wind ? wind.heightM * exposureAt(input.exposure.wind, wind.fromDeg) : 0,
      windHour ? localChopM(input.exposure, windHour) : 0,
    );
    const swellSquares = swells.reduce((sum, wave) => sum + wave.heightM ** 2, 0);
    const feltM = Math.sqrt(swellSquares + (WIND_WAVE_WEIGHT * windWaveM) ** 2);
    // A sea of unknown height can only add to the felt height. Already rough stays rough; anything less could be
    // any band, so the hour is left out rather than drawn from what is known.
    if (unknown && seaBand(feltM) !== "rough") continue;
    const biggest = swells.reduce<SiteWave | null>((best, wave) => (best == null || wave.heightM > best.heightM ? wave : best), null);
    result.push({
      time,
      band: seaBand(feltM),
      feltM: round2(feltM),
      swell: biggest && biggest.heightM >= 0.05 ? { ...biggest, heightM: round2(biggest.heightM) } : null,
      windWaveM: round2(windWaveM),
      wind: windHour ? { speedMs: round2(windHour.speedMs), fromDeg: Math.round(windHour.fromDeg) } : null,
      againstCurrent:
        input.route === "channel" && input.inwardBearingDeg != null
          ? againstCurrent(swells, currentAt.get(time), input.inwardBearingDeg)
          : false,
    });
  }
  return result;
}

/** Wind sea raised by this wind over this much open water, metres. */
export function fetchLimitedChopM(speedMs: number, fetchKm: number): number {
  if (!(speedMs > 0) || !(fetchKm > 0)) return 0;
  const limited = CHOP_GROWTH * speedMs * Math.sqrt((fetchKm * 1000) / GRAVITY);
  return Math.min(limited, (FULLY_DEVELOPED * speedMs ** 2) / GRAVITY);
}

/** Wind direction spread for local chop: the wind is never one bearing, so chop is averaged over this much each side. */
const WIND_SPREAD_DEG = 45;

/**
 * Chop the wind raises over the open water upwind of the site. The wind's direction wanders, so the chop is the
 * energy mean (cos² weights, as for the swell) over WIND_SPREAD_DEG each side of it, each direction's fetch read
 * between the table's entries. A direction whose ray runs out to sea adds nothing here: the wave model covers it.
 */
function localChopM(exposure: SiteExposure, wind: WindHour): number {
  const count = exposure.fetchKm.length;
  const stepDeg = 360 / count;
  const chopAt = (index: number) => {
    const fetchKm = exposure.fetchKm[((index % count) + count) % count];
    return fetchKm == null ? 0 : fetchLimitedChopM(wind.speedMs, fetchKm);
  };
  let energy = 0;
  let weights = 0;
  for (let offset = -WIND_SPREAD_DEG; offset <= WIND_SPREAD_DEG; offset += 5) {
    const weight = Math.cos((offset * Math.PI) / 180) ** 2;
    const position = (wind.fromDeg + offset) / stepDeg;
    const low = Math.floor(position);
    const share = position - low;
    const chop = chopAt(low) * (1 - share) + chopAt(low + 1) * share;
    energy += weight * chop ** 2;
    weights += weight;
  }
  return Math.sqrt(energy / weights);
}

export function seaBand(feltM: number): SeaBand {
  if (feltM < SEA_BAND_LIMITS_M.calm) return "calm";
  if (feltM < SEA_BAND_LIMITS_M.moderate) return "moderate";
  if (feltM < SEA_BAND_LIMITS_M.choppy) return "choppy";
  return "rough";
}

/** Swell coming from outside, in through the channel, while the channel runs strongly out. */
function againstCurrent(swells: readonly SiteWave[], hour: HourForecast | undefined, inwardBearingDeg: number): boolean {
  if (!hour || hour.direction !== "outgoing") return false;
  if (hour.strength !== "strong" && hour.strength !== "too_strong") return false;
  const seaward = (inwardBearingDeg + 180) % 360;
  return swells.some((wave) => wave.heightM >= AGAINST_CURRENT_SWELL_M && angleBetween(wave.fromDeg, seaward) <= AGAINST_CURRENT_DEG);
}

/**
 * A side counts for a sea only within this angle of where the sea comes from: the side facing it or a neighbour
 * (sides are 45° apart). Past that the sample is in the atoll's lee, already damped by the wave model.
 */
const UPSTREAM_MAX_DEG = 67.5;

type Component = "swell" | "secondarySwell" | "windWave";

/** One component at one hour: its upwind value, absent (upwind says there is none), or unknown (upwind sample missing). */
type Pick = { kind: "value"; wave: WaveComponent } | { kind: "absent" } | { kind: "unknown" };

/**
 * The component from the side it comes from. Absent when no side within UPSTREAM_MAX_DEG of any copy has it: an
 * upwind side that has the hour but no such component is the model saying there is none, a real answer. Unknown
 * when some copy is only on lee sides and no side within UPSTREAM_MAX_DEG of its direction has that hour at all: the
 * upwind sample failed or is missing, so the only copies are lee samples the wave model has already damped.
 */
function upstream(sides: readonly { sideDeg: number; at: Map<string, WaveHour> }[], time: string, key: Component): Pick {
  let best: { wave: WaveComponent; off: number } | null = null;
  const lee: WaveComponent[] = [];
  for (const side of sides) {
    const wave = side.at.get(time)?.[key];
    if (!wave) continue;
    const off = angleBetween(wave.fromDeg, side.sideDeg);
    if (off > UPSTREAM_MAX_DEG) {
      lee.push(wave);
      continue;
    }
    if (best == null || off < best.off) best = { wave, off };
  }
  if (best) return { kind: "value", wave: best.wave };
  const upwindMissing = (wave: WaveComponent) =>
    !sides.some((side) => side.at.has(time) && angleBetween(wave.fromDeg, side.sideDeg) <= UPSTREAM_MAX_DEG);
  return lee.some(upwindMissing) ? { kind: "unknown" } : { kind: "absent" };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** How the site's own rim shelters it. Channel sites cross the rim; outer reef and strait walls sit on it. */
export function exposureKind(site: Site, mates: readonly Site[]): ExposureKind {
  if (crossesRim(site, mates)) return "channel";
  if (site.siteType === "outer-reef" || site.siteType === "strait-wall") return "wall";
  if (site.siteType === "lagoon") return "lagoon";
  return "channel";
}

const exposureMemo = new Map<string, SiteExposure>();

/** Every atoll outline, for the ray tracer. */
export function exposureRings(): ExposureRing[] {
  return [...allRims()].map(([wayId, ring]) => ({ wayId, ring }));
}

/** Every island, for the ray tracer. Reads data/islands.json, so a corrupt file throws here. */
export function exposureIslands(): ExposureIsland[] {
  return readIslands().map((island) => ({ ring: island.ring, wooded: island.areaHa >= WOODED_MIN_HA }));
}

export function exposureForSite(
  site: Site,
  mates: readonly Site[],
  atoll: Atoll | undefined,
  inwardBearingDeg: number | null,
): SiteExposure {
  const kind = exposureKind(site, mates);
  const ownWayId = atoll ? rimWayId(atoll) : null;
  const key = `${site.id}|${site.lat}|${site.lon}|${kind}|${inwardBearingDeg}|${ownWayId}`;
  const kept = exposureMemo.get(key);
  if (kept) return kept;
  // Read first: a corrupt openings or islands file throws here and nothing is memoised.
  const openings = readOpenings();
  const exposure = siteExposure({ lat: site.lat, lon: site.lon, kind, inwardBearingDeg, ownWayId }, exposureRings(), openings, exposureIslands());
  exposureMemo.set(key, exposure);
  return exposure;
}

/** An atoll's offshore samples: ok sides only. fetchedAt is the oldest side's, so the page never claims fresher data. */
export type Offshore = { sides: OffshoreSide[]; wind: WindHour[] | null; fetchedAt: number | null; stale: boolean };

/**
 * The eight offshore samples round the site's atoll, or null when the atoll has no outline. They do not depend on the
 * current forecast, so a page can fetch them alongside it.
 */
export async function loadOffshore(atoll: Atoll | undefined, options: FetchOptions = {}): Promise<Offshore | null> {
  const ring = rimForAtoll(atoll);
  if (!ring) return null;
  const centre = snapToWaveGrid(ringCentre(ring));
  const [fetched, windFetch] = await Promise.all([
    Promise.all(offshorePoints(ring).map(async (point) => ({ point, waves: await fetchWaves(point.lat, point.lon, options) }))),
    fetchWind(centre.lat, centre.lon, options),
  ]);
  const sides: OffshoreSide[] = [];
  let fetchedAt: number | null = null;
  let stale = false;
  for (const { point, waves } of fetched) {
    if (!waves.ok) continue;
    sides.push({ sideDeg: point.sideDeg, hours: waves.hours });
    fetchedAt = fetchedAt == null ? waves.fetchedAt : Math.min(fetchedAt, waves.fetchedAt);
    stale ||= waves.stale;
  }
  if (sides.length > 0 && windFetch.ok) {
    fetchedAt = fetchedAt == null ? windFetch.fetchedAt : Math.min(fetchedAt, windFetch.fetchedAt);
    stale ||= windFetch.stale;
  }
  return { sides, wind: windFetch.ok ? windFetch.hours : null, fetchedAt, stale };
}

/**
 * The site's sea state for the forecast's hours, from its atoll's offshore samples. Unavailable before any side has
 * data. `current` is the site's current forecast, for the swell-against-current check on channels.
 */
export function siteSeaState(
  site: Site,
  mates: readonly Site[],
  atoll: Atoll | undefined,
  offshore: Offshore,
  current: { hours: readonly HourForecast[]; forecastRoute: ForecastRoute; inwardBearingDeg: number | null },
): SeaState {
  if (offshore.sides.length === 0) return { hours: [], unavailable: true, fetchedAt: null, stale: false };
  const exposure = exposureForSite(site, mates, atoll, current.inwardBearingDeg);
  const shown = new Set(current.hours.map((hour) => hour.time));
  const hours = seaStateHours({
    sides: offshore.sides,
    exposure,
    // No wind series: every hour's local chop is unknown, so only hours already rough are shown.
    wind: offshore.wind ?? [],
    current: current.hours,
    // A lagoon site that fell back to channel hours has no channel mouth of its own.
    route: exposureKind(site, mates) === "channel" ? current.forecastRoute : undefined,
    inwardBearingDeg: current.inwardBearingDeg,
  }).filter((hour) => shown.size === 0 || shown.has(hour.time));
  return { hours, unavailable: hours.length === 0, fetchedAt: offshore.fetchedAt, stale: offshore.stale };
}
