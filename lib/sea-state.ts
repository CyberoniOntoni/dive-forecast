import { readOpenings } from "./openings";
import { allRims, rimForAtoll, rimWayId } from "./rim";
import { crossesRim } from "./site-type";
import { angleBetween, exposureAt, offshorePoints, siteExposure, type ExposureKind, type SiteExposure } from "./wave-exposure";
import { fetchWaves, type WaveComponent, type WaveHour } from "./waves";
import type { FetchOptions } from "./marine";
import type { Atoll, ForecastRoute, HourForecast, SeaBand, SeaStateHour, Site, SiteWave } from "./types";

export { SEA_BANDS, type SeaBand, type SeaStateHour, type SiteWave } from "./types";

/**
 * Sea state at a dive site. Offshore waves come from Open-Meteo's wave model on the side of the atoll each sea comes
 * from; how much reaches the site comes from the atoll geometry (lib/wave-exposure.ts). It never touches the current
 * forecast or FORECAST_MODEL_VERSION.
 */

/**
 * Upper limits of each band on the felt height, metres. First guesses from the plan, to tune from reports.
 * Rough is everything from 1.5 m up.
 */
export const SEA_BAND_LIMITS_M: Record<Exclude<SeaBand, "rough">, number> = { calm: 0.5, moderate: 1.0, choppy: 1.5 };
/** Short wind waves feel this much bigger than swell of the same height. */
export const WIND_WAVE_WEIGHT = 1.4;
/** Swell at least this high, running into a strong outgoing current, stands up at a channel mouth. */
export const AGAINST_CURRENT_SWELL_M = 0.8;
/** Swell within this many degrees of straight in through the channel counts as running against the outgoing current. */
const AGAINST_CURRENT_DEG = 60;

export type SeaState = { hours: SeaStateHour[]; unavailable: boolean; fetchedAt: number | null; stale: boolean };

/** The offshore sample for one side of the atoll: the side's compass bearing from the atoll and its wave hours. */
export type OffshoreSide = { sideDeg: number; hours: readonly WaveHour[] };

/**
 * Each hour's sea state at the site. For each wave component, the offshore side used is the one the sea comes from
 * (its own direction closest to the side's bearing). Hours missing from every side are left out. When a component's
 * upwind sample is missing, the hour is still shown if what is known is already rough, and left out otherwise.
 */
export function seaStateHours(input: {
  sides: readonly OffshoreSide[];
  exposure: SiteExposure;
  /** The current forecast's hours, for the swell-against-current check. Only "channel" hours are checked. */
  current?: readonly HourForecast[];
  route?: ForecastRoute;
  /** The channel's inward bearing: swell from the opposite way runs in through it, against an outgoing current. */
  inwardBearingDeg?: number | null;
}): SeaStateHour[] {
  const byTime = input.sides.map((side) => ({ sideDeg: side.sideDeg, at: new Map(side.hours.map((hour) => [hour.time, hour])) }));
  const times = [...new Set(input.sides.flatMap((side) => side.hours.map((hour) => hour.time)))].sort();
  const currentAt = new Map((input.current ?? []).map((hour) => [hour.time, hour]));
  const result: SeaStateHour[] = [];
  for (const time of times) {
    const swellPick = upstream(byTime, time, "swell");
    const secondaryPick = upstream(byTime, time, "secondarySwell");
    const windPick = upstream(byTime, time, "windWave");
    const picks = [swellPick, secondaryPick, windPick];
    const swells = [swellPick, secondaryPick]
      .flatMap((pick) => (pick.kind === "value" ? [pick.wave] : []))
      .map((wave) => ({ ...wave, heightM: wave.heightM * exposureAt(input.exposure.swell, wave.fromDeg) }));
    const wind = windPick.kind === "value" ? windPick.wave : null;
    if (swells.length === 0 && wind == null && !picks.some((pick) => pick.kind === "unknown")) continue;
    const windWaveM = wind ? wind.heightM * exposureAt(input.exposure.wind, wind.fromDeg) : 0;
    const swellSquares = swells.reduce((sum, wave) => sum + wave.heightM ** 2, 0);
    const feltM = Math.sqrt(swellSquares + (WIND_WAVE_WEIGHT * windWaveM) ** 2);
    // A sea of unknown height can only add to the felt height. Already rough stays rough; anything less could be
    // any band, so the hour is left out rather than drawn from what is known.
    if (picks.some((pick) => pick.kind === "unknown") && seaBand(feltM) !== "rough") continue;
    const biggest = swells.reduce<SiteWave | null>((best, wave) => (best == null || wave.heightM > best.heightM ? wave : best), null);
    result.push({
      time,
      band: seaBand(feltM),
      feltM: round2(feltM),
      swell: biggest && biggest.heightM >= 0.05 ? { ...biggest, heightM: round2(biggest.heightM) } : null,
      windWaveM: round2(windWaveM),
      againstCurrent:
        input.route === "channel" && input.inwardBearingDeg != null
          ? againstCurrent(swells, currentAt.get(time), input.inwardBearingDeg)
          : false,
    });
  }
  return result;
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
  // Read first: a corrupt openings file throws here and nothing is memoised.
  const openings = readOpenings();
  const rings = [...allRims()].map(([wayId, ring]) => ({ wayId, ring }));
  const exposure = siteExposure({ lat: site.lat, lon: site.lon, kind, inwardBearingDeg, ownWayId }, rings, openings);
  exposureMemo.set(key, exposure);
  return exposure;
}

/** An atoll's offshore samples: ok sides only. fetchedAt is the oldest side's, so the page never claims fresher data. */
export type Offshore = { sides: OffshoreSide[]; fetchedAt: number | null; stale: boolean };

/**
 * The eight offshore samples round the site's atoll, or null when the atoll has no outline. They do not depend on the
 * current forecast, so a page can fetch them alongside it.
 */
export async function loadOffshore(atoll: Atoll | undefined, options: FetchOptions = {}): Promise<Offshore | null> {
  const ring = rimForAtoll(atoll);
  if (!ring) return null;
  const fetched = await Promise.all(
    offshorePoints(ring).map(async (point) => ({ point, waves: await fetchWaves(point.lat, point.lon, options) })),
  );
  const sides: OffshoreSide[] = [];
  let fetchedAt: number | null = null;
  let stale = false;
  for (const { point, waves } of fetched) {
    if (!waves.ok) continue;
    sides.push({ sideDeg: point.sideDeg, hours: waves.hours });
    fetchedAt = fetchedAt == null ? waves.fetchedAt : Math.min(fetchedAt, waves.fetchedAt);
    stale ||= waves.stale;
  }
  return { sides, fetchedAt, stale };
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
    current: current.hours,
    // A lagoon site that fell back to channel hours has no channel mouth of its own.
    route: exposureKind(site, mates) === "channel" ? current.forecastRoute : undefined,
    inwardBearingDeg: current.inwardBearingDeg,
  }).filter((hour) => shown.size === 0 || shown.has(hour.time));
  return { hours, unavailable: hours.length === 0, fetchedAt: offshore.fetchedAt, stale: offshore.stale };
}
