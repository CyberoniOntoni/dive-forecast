import { CONSENSUS_RATIO_THRESHOLD, CONTRADICTION_NEAR_MS, parseWall, reportTemporalWeight } from "./forecast";
import { STRENGTHS, type Direction, type HourForecast, type Report, type Strength } from "./types";

const HOUR_MS = 60 * 60 * 1000;
/** A report pulls the hours after it for this long, fading to nothing, as at channels. */
const PULL_HOURS = 6;
/** A report's own hour must be within this of a model hour to be compared with it. */
const OWN_HOUR_MS = 45 * 60 * 1000;
/** Direction agreement at the report's own hours, on the same run direction, that gives medium confidence. */
const MEDIUM_AGREEMENT = 0.8;

/**
 * Reports at a site whose forecast runs along an axis: an outer wall along the reef, a strait wall, or a lagoon site.
 * The model there is a signed stream along that axis, not the channel's tide slope, so the channel's phase and speed
 * fits (which read stored slope windows) do not apply. What does:
 *
 * - **Pull.** A report pulls the next six hours toward what the diver saw, fading over them, and stops where the model
 *   turns (its direction changes from the one it had at the report's hour). Direction needs 60 % of the weight, as at
 *   channels. Strength moves by how far the report was from the model at its own hour, so a report that agrees
 *   changes nothing.
 * - **Confidence.** Never high. Medium where at least two reports fall on hours the model ran the same way as this
 *   hour (slack reports do not count) from at least two divers, at least 80 % of them (by weight) saw the direction the model gave at their own hour, and no report within
 *   three hours says otherwise. Otherwise low.
 *
 * Only reports inside the series count: the stream at a report's hour is not saved with it, so an older report has
 * nothing to be compared with. `readDirection` reads a report along today's axis (alongReportDirection), or null
 * when it cannot be read; such a report is ignored. Reports weigh 2^(−age / 90 days) from the series' first hour.
 */
export function applyAxisReports(
  hours: readonly HourForecast[],
  reports: readonly Report[],
  readDirection: (report: Report) => Direction | null,
): HourForecast[] {
  if (hours.length === 0 || reports.length === 0) return [...hours];
  const times = hours.map((hour) => parseWall(hour.time));
  const referenceMs = times[0];
  const read = reports.flatMap((report): AxisReport[] => {
    const direction = readDirection(report);
    const ms = parseWall(report.time);
    if (direction == null || !Number.isFinite(ms)) return [];
    const index = nearestHour(times, ms);
    if (index < 0) return [];
    const weight = reportTemporalWeight(report.time, referenceMs);
    if (!(weight > 0)) return [];
    return [{ report, direction, index, hourMs: times[index], weight, slack: report.strength === "slack" }];
  });
  if (read.length === 0) return [...hours];
  return hours.map((hour, index) => {
    const pulled = pullHour(hours, index, times[index], read);
    return {
      ...hour,
      direction: pulled.direction,
      strength: pulled.strength,
      confidence: axisConfidence(hours, index, times[index], hour.direction, pulled, read),
    };
  });
}

type AxisReport = {
  report: Report;
  /** The diver's direction read along today's axis. */
  direction: Direction;
  /** The model hour of the report, and its time: a report at 10:20 is about the 10:00 hour and pulls it. */
  index: number;
  hourMs: number;
  weight: number;
  /** Slack saw no flow: it pulls strength but casts no direction vote. */
  slack: boolean;
};

function pullHour(
  hours: readonly HourForecast[],
  index: number,
  hourMs: number,
  read: readonly AxisReport[],
): { direction: Direction; strength: Strength; contradicted: boolean } {
  const hour = hours[index];
  let incoming = 0;
  let outgoing = 0;
  let slackWeight = 0;
  const active: { item: AxisReport; weight: number }[] = [];
  for (const item of read) {
    const since = (hourMs - item.hourMs) / HOUR_MS;
    if (!(since >= 0) || since >= PULL_HOURS) continue;
    if (turnedBetween(hours, item.index, index)) continue;
    const weight = (1 - since / PULL_HOURS) * item.weight;
    if (!(weight > 0)) continue;
    if (item.slack) slackWeight += weight;
    else if (item.direction === "incoming") incoming += weight;
    else outgoing += weight;
    active.push({ item, weight });
  }
  const directional = incoming + outgoing;
  if (directional + slackWeight === 0) return { direction: hour.direction, strength: hour.strength, contradicted: false };
  const conflict = incoming > 0 && outgoing > 0;
  let direction: Direction | null = null;
  if (directional === 0) direction = hour.direction;
  else if (incoming > outgoing && incoming / directional >= CONSENSUS_RATIO_THRESHOLD) direction = "incoming";
  else if (outgoing > incoming && outgoing / directional >= CONSENSUS_RATIO_THRESHOLD) direction = "outgoing";
  if (direction == null) return { direction: hour.direction, strength: hour.strength, contradicted: conflict };
  const chosen = direction;
  const agreeing = active.filter(({ item }) => item.slack || item.direction === chosen);
  const total = agreeing.reduce((sum, { weight }) => sum + weight, 0);
  const gap =
    total > 0
      ? agreeing.reduce(
          (sum, { item, weight }) => sum + weight * (bandIndex(item.report.strength) - bandIndex(hours[item.index].strength)),
          0,
        ) / total
      : 0;
  const strength = shift(hour.strength, Math.round(Math.min(1, total) * gap));
  return { direction, strength, contradicted: conflict || direction !== hour.direction };
}

/** Whether the model's direction changes anywhere between these two hours, in either order. */
function turnedBetween(hours: readonly HourForecast[], from: number, to: number): boolean {
  const [first, last] = from <= to ? [from, to] : [to, from];
  for (let index = first + 1; index <= last; index += 1) {
    if (hours[index].direction !== hours[first].direction) return true;
  }
  return false;
}

function axisConfidence(
  hours: readonly HourForecast[],
  index: number,
  hourMs: number,
  modelDirection: Direction,
  pulled: { direction: Direction; contradicted: boolean },
  read: readonly AxisReport[],
): "low" | "medium" {
  if (pulled.contradicted) return "low";
  const directional = read.filter((item) => !item.slack);
  // A report within three hours says otherwise: on this run of the stream it saw another way than this hour gives;
  // across a turn it saw another way than the model gave at its own hour.
  const near = directional.some((item) => {
    if (Math.abs(hourMs - item.hourMs) > CONTRADICTION_NEAR_MS) return false;
    const expected = turnedBetween(hours, item.index, index) ? hours[item.index].direction : pulled.direction;
    return item.direction !== expected;
  });
  if (near) return "low";
  // Reports from the same phase of the stream: the model ran the same way at their hour as at this one.
  // Slack reports cast no direction vote, so they do not count toward the two.
  const voting = read.filter((item) => !item.slack && hours[item.index].direction === modelDirection);
  // Two different divers: one diver's reports, or their one-tap "as forecast" reports, are not a track record.
  if (new Set(voting.map((item) => item.report.userId ?? item.report.id)).size < 2) return "low";
  const weight = voting.reduce((sum, item) => sum + item.weight, 0);
  if (weight === 0) return "low";
  const agree = voting
    .filter((item) => item.direction === hours[item.index].direction)
    .reduce((sum, item) => sum + item.weight, 0);
  return agree / weight >= MEDIUM_AGREEMENT ? "medium" : "low";
}

function nearestHour(times: readonly number[], ms: number): number {
  let best = -1;
  let bestDelta = Number.POSITIVE_INFINITY;
  times.forEach((time, index) => {
    const delta = Math.abs(time - ms);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = index;
    }
  });
  return bestDelta <= OWN_HOUR_MS ? best : -1;
}

function bandIndex(strength: Strength): number {
  return STRENGTHS.indexOf(strength);
}

function shift(strength: Strength, steps: number): Strength {
  const index = Math.max(0, Math.min(STRENGTHS.length - 1, bandIndex(strength) + steps));
  return STRENGTHS[index];
}
