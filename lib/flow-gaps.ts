/**
 * The map's current-flow animation, server side: how the water runs through every reef gap of an outline and along its
 * outer reef at one hour, from the series the atoll's ring points already have. No dive site needed: each gap in
 * data/openings.json gets the channel model (forecastHours) on the ring's sea level and current, blended from the two
 * ring points nearest it; each ring point gets the along-reef model (alongReefHours) on its own series. Display only:
 * no prediction is saved from these, and the forecast for any dive site is untouched.
 */
import type { AtollRing } from "./atoll-ring";
import { alongReefHours, forecastHours } from "./forecast";
import { FLOW_KNOTS, type FlowGap, type FlowReef } from "./flow-wire";
import type { ReefOpening } from "./openings";
import { KM_PER_DEG_LAT, KM_PER_DEG_LON, rimInwardBearing, type RimRing } from "./rim";
import type { MarineHour, Site } from "./types";

/** A catalog channel site this close to a gap is that gap: its forecast and reports speak for the whole gap, km. */
export const GAP_SITE_KM = 0.6;
/** A gap a reef flat bridges is a sill: it carries this share of what an open gap would. */
const BRIDGED_SHARE = 0.4;
/** How far from the outline a gap's inward normal is looked for, km. */
const NORMAL_REACH_KM = 1.5;

const round = (value: number, places: number) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

function kmBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const kmLon = KM_PER_DEG_LON * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot((a.lat - b.lat) * KM_PER_DEG_LAT, (a.lon - b.lon) * kmLon);
}

/**
 * Two series blended hour by hour with weights summing to 1: sea level as a weighted mean, the current as a weighted
 * mean of its east and north parts. An hour either series lacks takes the other's.
 */
export function blendHours(a: readonly MarineHour[], b: readonly MarineHour[], weightA: number): MarineHour[] {
  const byTime = new Map(b.map((hour) => [hour.time, hour]));
  return a.map((hour) => {
    const other = byTime.get(hour.time);
    if (!other) return hour;
    const mix = (x: number | null, y: number | null) =>
      x == null ? y : y == null ? x : x * weightA + y * (1 - weightA);
    const parts = (item: MarineHour) =>
      item.currentVelocityMs == null || item.currentDirectionDeg == null
        ? null
        : [
            item.currentVelocityMs * Math.sin((item.currentDirectionDeg * Math.PI) / 180),
            item.currentVelocityMs * Math.cos((item.currentDirectionDeg * Math.PI) / 180),
          ];
    const pa = parts(hour);
    const pb = parts(other);
    let velocity: number | null = null;
    let direction: number | null = null;
    const blended = pa && pb ? [pa[0] * weightA + pb[0] * (1 - weightA), pa[1] * weightA + pb[1] * (1 - weightA)] : pa ?? pb;
    if (blended) {
      velocity = Math.hypot(blended[0], blended[1]);
      direction = ((Math.atan2(blended[0], blended[1]) * 180) / Math.PI + 360) % 360;
    }
    return { time: hour.time, seaLevelM: mix(hour.seaLevelM, other.seaLevelM), currentVelocityMs: velocity, currentDirectionDeg: direction };
  });
}

/** The series at a point on the rim: the two nearest ring points that have one, blended by inverse distance. */
function seriesNear(point: { lat: number; lon: number }, ring: AtollRing): MarineHour[] | null {
  const near = ring.samples
    .map((sample, index) => ({ km: kmBetween(point, sample.on), hours: ring.series[index] }))
    .filter((item): item is { km: number; hours: MarineHour[] } => item.hours != null && item.hours.length > 0)
    .sort((a, b) => a.km - b.km);
  if (near.length === 0) return null;
  if (near.length === 1) return near[0].hours;
  const [first, second] = near;
  const weight = 1 / Math.max(first.km, 0.1) / (1 / Math.max(first.km, 0.1) + 1 / Math.max(second.km, 0.1));
  return blendHours(first.hours, second.hours, weight);
}

/**
 * Every gap of the outline at `time`: where the water heads (along the inward normal, or out along it) and how fast,
 * from the channel model at the gap's width. Catalog channel sites within GAP_SITE_KM are listed with it, so the map
 * shows their own forecast there instead. A gap with no series near it, no inward normal or no forecast hour is left
 * out (the map then has no gate there). With `head` false (a flow-only outline: its ring spans several natural atolls,
 * so the ring mean is no lagoon level) the model runs without the head across the atoll.
 */
export function gapFlows(
  openings: readonly ReefOpening[],
  rim: RimRing,
  ring: AtollRing,
  channelSites: readonly Site[],
  time: string,
  head = true,
): FlowGap[] {
  const gaps: FlowGap[] = [];
  for (const opening of openings) {
    const inward = rimInwardBearing(opening, rim, NORMAL_REACH_KM);
    if (inward == null) continue;
    const hours = seriesNear(opening, ring);
    if (!hours) continue;
    const hour = forecastHours({ hours, inwardBearingDeg: inward, ringLevel: head ? ring.level : undefined, channelWidthM: opening.widthM }).find(
      (item) => item.time === time,
    );
    if (!hour) continue;
    const knots = FLOW_KNOTS[hour.strength] * (opening.reefFlatBridges ? BRIDGED_SHARE : 1);
    gaps.push({
      lat: round(opening.lat, 5),
      lon: round(opening.lon, 5),
      widthM: Math.round(opening.widthM),
      headingDeg: Math.round(hour.direction === "incoming" ? inward : (inward + 180) % 360),
      knots: round(knots, 2),
      siteIds: channelSites.filter((site) => kmBetween(site, opening) <= GAP_SITE_KM).map((site) => site.id),
    });
  }
  return gaps;
}

/**
 * The current along the outer reef at each ring point at `time`, from the along-reef model on that point's own
 * series: its band speed, signed by which way along the reef it runs (FlowReef), placed on the outline. Points with no series or no
 * forecast hour are left out.
 */
export function reefFlows(ring: AtollRing, time: string): FlowReef[] {
  const reef: FlowReef[] = [];
  ring.samples.forEach((sample, index) => {
    const hours = ring.series[index];
    if (!hours) return;
    const alongHeadingDeg = (sample.inwardDeg + 90) % 360;
    const hour = alongReefHours({ hours, alongHeadingDeg }).find((item) => item.time === time);
    if (!hour) return;
    reef.push({
      lat: round(sample.on.lat, 5),
      lon: round(sample.on.lon, 5),
      knots: (hour.direction === "incoming" ? 1 : -1) * FLOW_KNOTS[hour.strength],
    });
  });
  return reef;
}
