"use client";

import { TideLine } from "./TideLine";
import { useId, useMemo, useState, type PointerEvent } from "react";
import { ARROW_LENGTH, ARROW_WIDTH, arrowPath } from "@/lib/arrow-shape";
import { seaDetail } from "@/lib/sea-text";
import { FORECAST_GUIDANCE, SEA_SURFACE_NOTE } from "@/lib/safety-copy";
import { compassWord, confidenceOpacity, onCompass, routeArrowBearing, routeWay } from "@/lib/nowcast-glance";
import type { BearingSource, Confidence, Direction, ForecastRoute, HourForecast, SeaBand, SeaStateHour, Strength } from "@/lib/types";

const STRENGTH_LABEL: Record<Strength, string> = {
  slack: "Slack",
  mild: "Mild",
  strong: "Strong",
  too_strong: "Very strong",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const RANGE_TRACK = "h-11 w-full min-w-0 cursor-pointer appearance-none rounded-full bg-transparent bg-[linear-gradient(transparent_20px,color-mix(in_srgb,var(--foam)_22%,transparent)_20px,color-mix(in_srgb,var(--foam)_22%,transparent)_24px,transparent_24px)]";
const RANGE_FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-incoming disabled:cursor-default";
const RANGE_THUMB = "[&::-moz-range-thumb]:h-7 [&::-moz-range-thumb]:w-7 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:shadow-[0_0_14px_currentColor] [&::-moz-range-thumb]:border-[3px] [&::-moz-range-thumb]:border-ink [&::-moz-range-thumb]:bg-current [&::-moz-range-track]:bg-transparent [&::-webkit-slider-thumb]:h-7 [&::-webkit-slider-thumb]:w-7 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-[0_0_14px_currentColor] [&::-webkit-slider-thumb]:border-[3px] [&::-webkit-slider-thumb]:border-ink [&::-webkit-slider-thumb]:bg-current";

export function HourSlider({
  hours,
  unavailable,
  inwardBearingDeg,
  outgoingBearingDeg = null,
  forecastRoute,
  alongHeadingDeg = null,
  bearingSource = null,
  unseeded = false,
  notice,
  siteNote = null,
  fetchedAt = null,
  stale = false,
  maldivesWall,
  initialIndex,
  seaState = null,
  seaStale = false,
}: {
  hours: HourForecast[];
  unavailable: boolean;
  inwardBearingDeg: number | null;
  /** The outgoing arrow's heading at a curved channel; null when outgoing is opposite incoming. */
  outgoingBearingDeg?: number | null;
  /** Which model made the hours. Every route but "channel" reads as compass points. */
  forecastRoute: ForecastRoute;
  /** Set on every route but "channel": the heading "incoming" means there. */
  alongHeadingDeg?: number | null;
  /** Where the bearing came from. The fallback heuristic gets an estimate note. */
  bearingSource?: BearingSource | null;
  /** True for an app-added pin that is not in or near a seeded atoll. */
  unseeded?: boolean;
  notice: string;
  /** How far to trust the forecast at this kind of site, e.g. inside the lagoon. */
  siteNote?: string | null;
  fetchedAt?: { wall: string; iso: string } | null;
  /** True when these hours are the last cached series. */
  stale?: boolean;
  maldivesWall: string;
  initialIndex: number;
  /** Sea state by hour. Empty when it is unavailable; null when the site has none. */
  seaState?: SeaStateHour[] | null;
  /** True when the sea state comes from an old cached wave series. */
  seaStale?: boolean;
}) {
  const [index, setIndex] = useState(initialIndex);
  // Built once per series, not on every slider move.
  const seaByTime = useMemo(() => new Map((seaState ?? []).map((sea) => [sea.time, sea])), [seaState]);
  const levels = useMemo(() => hours.map((hour) => hour.levelM), [hours]);
  const tideTurnList = useMemo(() => tideTurns(levels), [levels]);

  if (unavailable || hours.length === 0) {
    return (
      <section aria-labelledby="forecast-heading" className="rise-in tideline-card surface px-4 pt-9 pb-4 sm:px-6 sm:pt-10 sm:pb-6">
        <TideLine />
        <h2 id="forecast-heading" className="text-sm font-medium text-foam/80">
          Forecast
        </h2>
        <p role="status" className="mt-2 text-xl font-semibold text-foam">
          The forecast is unavailable.
        </p>
        {unseeded ? (
          <p className="mt-3 text-sm leading-6 text-foam/80">
            This spot is not in a seeded atoll yet, so there is no forecast. Reports and ratings still work.
          </p>
        ) : null}
        {siteNote ? <p className="mt-3 text-sm leading-6 text-foam/80">{siteNote}</p> : null}
        <p className="mt-3 text-sm leading-6 text-foam/80">{notice}</p>
      </section>
    );
  }

  const selected = clampHourIndex(index, hours.length);
  const hour = hours[selected];
  const today = maldivesWall.slice(0, 10);
  const nowIndex = clampHourIndex(initialIndex, hours.length);
  const bearing =
    inwardBearingDeg == null
      ? null
      : routeArrowBearing(forecastRoute, hour.direction, inwardBearingDeg, alongHeadingDeg, outgoingBearingDeg);
  const wordFor = (direction: Direction) => capitalized(routeWay(forecastRoute, direction, alongHeadingDeg).way);
  const compass = onCompass(forecastRoute, alongHeadingDeg);
  const tone = compass ? "text-foam" : directionTone(hour.direction);
  const quiet = arrowOpacity(hour.confidence);
  const way = wordFor(hour.direction);
  const turn = nextTurn(hours, selected);
  const sea = seaByTime.get(hour.time) ?? null;

  return (
    <section aria-labelledby="forecast-heading" className="rise-in tideline-card surface px-4 pt-9 pb-4 sm:px-6 sm:pt-10 sm:pb-6">
        <TideLine />
      <h2 id="forecast-heading" className="sr-only">
        Forecast hour
      </h2>
      <div className="flex min-w-0 items-center gap-4">
        {bearing == null ? null : (
          <Dial bearing={bearing} strength={hour.strength} tone={tone} quiet={quiet} estimate={bearingSource === "fallback"} label={`${way} arrow, ${Math.round(bearing)} degrees clockwise from north`} />
        )}
        <div className="min-w-0">
          <p className="font-mono text-sm tabular-nums text-foam/80">{hourWhen(hour.time, today)}</p>
          <p className={`text-3xl font-semibold tracking-tight break-words min-[400px]:text-4xl sm:text-6xl ${tone}`}>
            {way}
          </p>
          {bearing != null && !compass ? (
            <p className="text-sm leading-6 text-foam/80">
              {hour.direction === "incoming" ? "Into the atoll" : "Out of the atoll"}, toward {compassWord(bearing)}
            </p>
          ) : null}
          <p className={`mt-0.5 text-lg font-medium sm:text-xl ${strengthTone(hour.strength)}`}>{STRENGTH_LABEL[hour.strength]}</p>
          <ConfidenceMeter confidence={hour.confidence} />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <TideCell levels={levels} turns={tideTurnList} selected={selected} hours={hours} today={today} />
        <div className="min-w-0 rounded-2xl bg-ink/40 px-3 py-2.5 ring-1 ring-foam/10">
          <p className="eyebrow !text-foam/70">Flow next</p>
          {turn == null ? (
            <>
              <p className="mt-0.5 text-sm leading-5 font-medium text-foam">Holds</p>
              <p className="text-xs leading-5 text-foam/70">to the end of the forecast</p>
            </>
          ) : (
            <>
              <p className={`mt-0.5 text-sm leading-5 font-semibold ${compass ? "text-foam" : directionTone(hours[turn].direction)}`}>
                {wordFor(hours[turn].direction)}
              </p>
              <p className="text-xs leading-5 text-foam/70">
                {turnWhen(hours[turn].time, today)} · in {turn - selected} h
              </p>
            </>
          )}
        </div>
      </div>
      {seaState == null ? null : <SeaLine sea={sea} stale={seaStale} />}
      {bearing != null && bearingSource === "fallback" ? (
        <p className="mt-3 text-xs leading-5 text-foam/80">
          The arrow heading is an estimate. This pin has no measured channel bearing.
        </p>
      ) : null}

      <div className="mt-6">
        <WeekLegend up={wordFor("incoming")} down={wordFor("outgoing")} compass={compass} />
        <WeekStrip hours={hours} levels={levels} selected={selected} nowIndex={nowIndex} compass={compass} today={today} onPick={setIndex} />
        {seaByTime.size > 0 ? <SeaStrip hours={hours} seaByTime={seaByTime} selected={selected} nowIndex={nowIndex} /> : null}
        <label className="block min-w-0" htmlFor="forecast-hour">
          <span className="sr-only">Forecast hour</span>
          <input
            id="forecast-hour"
            type="range"
            min={0}
            max={Math.max(hours.length - 1, 0)}
            step={1}
            value={selected}
            disabled={hours.length < 2}
            onChange={(event) => setIndex(Number(event.target.value))}
            aria-valuemin={0}
            aria-valuemax={hours.length - 1}
            aria-valuenow={selected}
            aria-valuetext={hourValueText(hour, today, wordFor(hour.direction))}
            className={`${RANGE_TRACK} ${RANGE_FOCUS} ${tone} ${RANGE_THUMB}`}
          />
        </label>
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="text-xs leading-5 text-foam/80">
          {stale ? "This series is old." : null}
          {stale && fetchedAt ? " " : null}
          {fetchedAt ? (
            <>
              Fetched <time dateTime={fetchedAt.iso}>{fetchedCaption(fetchedAt.wall)}</time> Maldives
            </>
          ) : null}
        </p>
        {selected === nowIndex ? null : (
          <button
            type="button"
            onClick={() => setIndex(nowIndex)}
            className="button-quiet px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
          >
            Back to now
          </button>
        )}
      </div>
      <p className="mt-4 flex items-start gap-2 border-t border-foam/10 pt-3 text-xs leading-5 text-foam/75">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className="mt-0.5 shrink-0 text-outgoing" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
        <span>{FORECAST_GUIDANCE}</span>
      </p>
      {/* Folded so a phone shows the week without scrolling past the method; the confidence above still says how sure. */}
      {siteNote ? <p className="mt-3 text-sm leading-6 text-foam/80">{siteNote}</p> : null}
      <details className="group mt-3 text-sm leading-6 text-foam/80">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-medium text-foam focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming [&::-webkit-details-marker]:hidden">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 rotate-45 border-t-2 border-r-2 border-current transition-transform group-open:rotate-135"
          />
          How this forecast works
        </summary>
        <p className="mt-1">{notice}</p>
      </details>
    </section>
  );
}

export const SEA_LABEL: Record<SeaBand, string> = {
  calm: "Calm",
  moderate: "Moderate",
  choppy: "Choppy",
  rough: "Rough",
};

/** Strip colour per sea band: calm and moderate stay foam, choppy takes the outgoing amber, rough the stop red. */
export const SEA_COLOR: Record<SeaBand, { fill: string; opacity: number }> = {
  calm: { fill: "var(--foam)", opacity: 0.18 },
  moderate: { fill: "var(--foam)", opacity: 0.5 },
  choppy: { fill: "var(--outgoing)", opacity: 0.9 },
  rough: { fill: "var(--stop)", opacity: 1 },
};

/** "Sea surface: choppy · 1.2 m swell from SW, 11 s · 0.4 m wind chop", and the swell-against-current warning. */
function SeaLine({ sea, stale }: { sea: SeaStateHour | null; stale: boolean }) {
  if (sea == null) {
    return <p className="mt-3 text-sm leading-6 text-foam/80">The sea surface forecast is unavailable for this hour.</p>;
  }
  return (
    <div className="mt-3 text-sm leading-6">
      <p className="text-foam/90">
        <span className="font-medium text-foam">Sea surface: </span>
        <span className={sea.band === "rough" ? "font-semibold text-stop" : sea.band === "choppy" ? "font-semibold text-outgoing" : "text-foam"}>
          {SEA_LABEL[sea.band].toLowerCase()}
        </span>
        <span className="text-foam/80"> · {seaDetail(sea)}</span>
        {stale ? <span className="text-foam/80"> (old wave or wind data)</span> : null}
      </p>
      {/* Right under the current, so choppy water up top is not read as the current at depth, nor calm water as slack. */}
      <p className="text-xs leading-5 text-foam/70">{SEA_SURFACE_NOTE}</p>
      {sea.againstCurrent ? (
        <p className="font-medium text-stop">Swell runs into the outgoing current here: expect steep, breaking waves at the channel mouth.</p>
      ) : null}
    </div>
  );
}


/** One cell per forecast hour, coloured by sea band, under the week strip so a calm window can be picked by eye. */
function SeaStrip({
  hours,
  seaByTime,
  selected,
  nowIndex,
}: {
  hours: readonly HourForecast[];
  seaByTime: ReadonlyMap<string, SeaStateHour>;
  selected: number;
  nowIndex: number;
}) {
  const last = Math.max(hours.length - 1, 1);
  return (
    <div className="mx-[14px] mt-2" aria-hidden="true">
      <svg viewBox={`0 0 ${last} 10`} preserveAspectRatio="none" shapeRendering="crispEdges" className="block h-2.5 w-full overflow-visible rounded-full">
        {hours.map((hour, index) => {
          const sea = seaByTime.get(hour.time);
          if (!sea) return null;
          const color = SEA_COLOR[sea.band];
          return <rect key={hour.time} x={index - 0.5} width={1} y={0} height={10} fill={color.fill} fillOpacity={color.opacity} />;
        })}
        {nowIndex > 0 ? <rect x={-0.5} width={nowIndex} y={0} height={10} fill="var(--ink)" fillOpacity={0.55} /> : null}
        <line x1={selected} x2={selected} y1={-2} y2={12} stroke="var(--foam)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-foam/80 min-[400px]:gap-x-2.5 min-[400px]:text-xs">
        {/* The band names say it is the sea; on a narrow phone the word would push "rough" to a second line. */}
        <span className="hidden min-[400px]:inline">Surface:</span>
        {(Object.keys(SEA_LABEL) as SeaBand[]).map((band) => (
          <span key={band} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2 w-3"
              style={{ backgroundColor: SEA_COLOR[band].fill, opacity: SEA_COLOR[band].opacity }}
            />
            {SEA_LABEL[band].toLowerCase()}
          </span>
        ))}
      </p>
    </div>
  );
}

/** A smooth line through the points (Catmull-Rom turned into cubic Béziers), so a week of hours reads as water. */
export function smoothPath(points: readonly (readonly [number, number])[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0][0]},${points[0][1]}`;
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${round2(c1x)},${round2(c1y)} ${round2(c2x)},${round2(c2y)} ${p2[0]},${round2(p2[1])}`;
  }
  return d;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A high or low of the residual tide at hour `index`. */
export type TideTurn = { index: number; high: boolean };

/**
 * Every high and low in the levels: an hour higher (lower) than the hour before and not lower (higher) than the hour
 * after. A flat top counts once, at its first hour; the first and last hours never count. As the Android app's
 * SiteOutlook.tideTurns: change both together.
 */
export function tideTurns(levels: readonly number[]): TideTurn[] {
  const turns: TideTurn[] = [];
  for (let i = 1; i < levels.length - 1; i += 1) {
    const [before, here, after] = [levels[i - 1], levels[i], levels[i + 1]];
    if (here > before && here >= after) turns.push({ index: i, high: true });
    else if (here < before && here <= after) turns.push({ index: i, high: false });
  }
  return turns;
}

/** Rising or falling at hour `index`, by the hour before it (the first hour by the one after); null on a dead level. */
export function tideTrend(levels: readonly number[], index: number): "rising" | "falling" | null {
  if (levels.length < 2 || index < 0 || index >= levels.length) return null;
  const [a, b] = index === 0 ? [levels[0], levels[1]] : [levels[index - 1], levels[index]];
  if (b > a) return "rising";
  if (b < a) return "falling";
  return null;
}

/** Tide at the picked hour: rising or falling, and the next high or low. The tide is the sea level, not the current. */
function TideCell({
  levels,
  turns,
  selected,
  hours,
  today,
}: {
  levels: readonly number[];
  turns: readonly TideTurn[];
  selected: number;
  hours: readonly HourForecast[];
  today: string;
}) {
  const trend = tideTrend(levels, selected);
  const next = turns.find((turn) => turn.index > selected) ?? null;
  return (
    <div className="min-w-0 rounded-2xl bg-ink/40 px-3 py-2.5 ring-1 ring-foam/10">
      <p className="eyebrow !text-tide">Tide</p>
      <p className="mt-0.5 flex items-center gap-1 text-sm leading-5 font-medium text-foam">
        {trend === "rising" ? "Rising" : trend === "falling" ? "Falling" : "Steady"}
        {trend == null ? null : (
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" className="text-tide" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            {trend === "rising" ? <path d="M7 17L17 7M9 7h8v8" /> : <path d="M7 7l10 10M17 9v8H9" />}
          </svg>
        )}
      </p>
      <p className="text-xs leading-5 text-foam/70">
        {next ? `${next.high ? "High" : "Low"} ${turnWhen(hours[next.index].time, today)}` : "No high or low left this week"}
      </p>
    </div>
  );
}

/** One, two or three bars lit for low, medium and high confidence, as in the Android app. */
function ConfidenceMeter({ confidence }: { confidence: Confidence }) {
  const lit = confidence === "low" ? 1 : confidence === "medium" ? 2 : 3;
  return (
    <p className="mt-1.5 flex items-center gap-1 text-xs text-foam/75 sm:text-sm">
      {[0, 1, 2].map((bar) => (
        <span key={bar} aria-hidden="true" className={`h-1.5 w-4 rounded-full ${bar < lit ? "bg-foam" : "bg-foam/20"}`} />
      ))}
      <span className="ml-1.5">{confidence.charAt(0).toUpperCase() + confidence.slice(1)} confidence</span>
    </p>
  );
}

/** The heading to turn to from `from` so the arrow takes the short way round (at most 180 degrees). */
export function shortTurnTarget(from: number, to: number): number {
  return from + ((((to - from) % 360) + 540) % 360) - 180;
}

/**
 * The compass: a ring of degree ticks with the cardinal points, a glow in the flow's colour, and the arrow, which swings
 * the short way round to each new hour's heading (straight there under reduced motion).
 */
function Dial({
  bearing,
  strength,
  tone,
  quiet,
  estimate,
  label,
}: {
  bearing: number;
  strength: Strength;
  tone: string;
  quiet: string;
  estimate: boolean;
  label: string;
}) {
  // The arrow's running angle, kept past 360 so a turn from 350 to 10 degrees goes forward 20, not back 340.
  const [turn, setTurn] = useState({ bearing, angle: bearing });
  if (turn.bearing !== bearing) setTurn({ bearing, angle: shortTurnTarget(turn.angle, bearing) });
  return (
    <div className={`dial relative grid size-28 shrink-0 place-items-center rounded-full sm:size-32 ${tone}`}>
      <svg viewBox="0 0 100 100" aria-hidden="true" className="absolute inset-0 size-full">
        <circle cx={50} cy={50} r={48} fill="none" stroke="var(--foam)" strokeOpacity={0.14} />
        {Array.from({ length: 72 }, (_, tick) => {
          const major = tick % 18 === 0;
          const mid = tick % 6 === 0;
          const length = major ? 6 : mid ? 4 : 2;
          return (
            <line
              key={tick}
              x1={50}
              x2={50}
              y1={3}
              y2={3 + length}
              transform={`rotate(${tick * 5} 50 50)`}
              stroke={tick === 0 ? "currentColor" : "var(--foam)"}
              strokeOpacity={tick === 0 ? 1 : major ? 0.6 : mid ? 0.35 : 0.18}
              strokeWidth={major ? 1.4 : 0.8}
              strokeLinecap="round"
            />
          );
        })}
        {(
          [
            ["N", 50, 17.5],
            ["E", 83, 51.5],
            ["S", 50, 85.5],
            ["W", 17, 51.5],
          ] as const
        ).map(([letter, x, y]) => (
          <text
            key={letter}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={8}
            fontWeight={letter === "N" ? 700 : 500}
            fill="var(--foam)"
            fillOpacity={letter === "N" ? 0.95 : 0.55}
          >
            {letter}
          </text>
        ))}
      </svg>
      <svg
        viewBox={dialViewBox(strength)}
        className={`dial-arrow relative h-16 w-16 sm:h-20 sm:w-20 ${quiet}`}
        style={{ transform: `rotate(${turn.angle}deg)` }}
        role="img"
        aria-label={label}
      >
        {estimate ? (
          <path
            d={arrowPath(ARROW_LENGTH[strength])}
            fill="currentColor"
            fillOpacity={0.22}
            stroke="currentColor"
            strokeWidth={1}
            strokeLinejoin="round"
          />
        ) : (
          <path d={arrowPath(ARROW_LENGTH[strength])} fill="currentColor" />
        )}
      </svg>
    </div>
  );
}

/** W7: after the empty/unavailable branch, keep the slider index inside the hours. */
export function clampHourIndex(index: number, hourCount: number): number {
  return Math.max(0, Math.min(index, hourCount - 1));
}

/** The first hour after `from` whose direction differs, or null when the series never turns after it. */
export function nextTurn(hours: readonly HourForecast[], from: number): number | null {
  const start = hours[from];
  if (start == null) return null;
  for (let index = from + 1; index < hours.length; index += 1) {
    if (hours[index].direction !== start.direction) return index;
  }
  return null;
}

/** "Turns incoming at 23:00", "Turns to run W Wed 7 at 02:00", or no turn left in the series. */
export function turnText(
  turn: number | null,
  hours: readonly HourForecast[],
  today: string,
  wordFor: (direction: Direction) => string,
): string {
  if (turn == null) return "No turn in the rest of the forecast.";
  const at = hours[turn];
  const word = wordFor(at.direction);
  const verb = word.startsWith("Running ") ? `to run ${word.slice("Running ".length)}` : word.toLowerCase();
  return `Turns ${verb} ${turnWhen(at.time, today)}`;
}

/** Up-to-strength share of the strip's half height. Slack still shows a sliver so its hour reads. */
export const STRIP_HEIGHT: Record<Strength, number> = { slack: 0.1, mild: 0.38, strong: 0.68, too_strong: 1 };

function WeekLegend({ up, down, compass }: { up: string; down: string; compass: boolean }) {
  const swatch = "inline-block h-2.5 w-1.5 rounded-full";
  return (
    <p className="mb-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foam/80">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className={`${swatch} ${compass ? "bg-foam" : "bg-incoming"}`} />
        {up}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className={`${swatch} ${compass ? "bg-foam/70" : "bg-outgoing"}`} />
        {down}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className={`${swatch} bg-stop`} />
        Very strong
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="inline-block h-0.5 w-3.5 rounded-full bg-tide" />
        Tide
      </span>
      <span className="text-foam/65">Taller is stronger, fainter is less sure</span>
    </p>
  );
}

/**
 * Every hour as a bar: up for incoming (or the reef heading), down for outgoing, as tall as it is strong and as solid
 * as it is sure. It is inset by half the slider thumb, so each bar sits over the thumb's spot for that hour.
 */
function WeekStrip({
  hours,
  levels,
  selected,
  nowIndex,
  compass,
  today,
  onPick,
}: {
  hours: readonly HourForecast[];
  levels: readonly number[];
  selected: number;
  nowIndex: number;
  compass: boolean;
  today: string;
  onPick: (index: number) => void;
}) {
  const last = Math.max(hours.length - 1, 1);
  const spans = daySpans(hours);
  const at = (index: number) => `${(index / last) * 100}%`;
  const id = useId();
  const flowId = `flow-${id}`;
  const depthId = `depth-${id}`;
  const maxLevel = Math.max(0.05, ...levels.map((level) => Math.abs(level)));
  const tideY = (index: number) => 50 - (levels[index] / maxLevel) * 36;
  const flowPoints = hours.map((hour, index): [number, number] => [index, 50 - (hour.direction === "incoming" ? 1 : -1) * STRIP_HEIGHT[hour.strength] * 46]);
  const flowLine = smoothPath(flowPoints);
  const tideLine = smoothPath(levels.map((_, index): [number, number] => [index, tideY(index)]));
  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    const share = (event.clientX - box.left) / box.width;
    onPick(clampHourIndex(Math.round(share * last), hours.length));
  };

  return (
    <div className="mx-[14px]" aria-hidden="true">
      <div className="relative h-5 text-[10px] font-medium text-foam/80">
        <span className="absolute bottom-0 -translate-x-1/2 whitespace-nowrap" style={{ left: at(nowIndex) }}>
          Now
        </span>
      </div>
      <div
        className="relative h-28 cursor-pointer touch-pan-y sm:h-32"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          pick(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons !== 0) pick(event);
        }}
        onPointerUp={releasePointer}
        onPointerCancel={releasePointer}
      >
        <svg viewBox={`0 0 ${last} 100`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
          <defs>
            {/* One band of colour per hour along the week: the way's colour, very strong in red, faded by confidence. */}
            <linearGradient id={flowId} gradientUnits="userSpaceOnUse" x1={-0.5} x2={last + 0.5} y1={0} y2={0}>
              {hours.flatMap((hour, index) => {
                const color = stripColor(hour, compass);
                const opacity = confidenceOpacity(hour.confidence);
                const width = last + 1;
                return [
                  <stop key={`${hour.time}-a`} offset={index / width} stopColor={color} stopOpacity={opacity} />,
                  <stop key={`${hour.time}-b`} offset={(index + 1) / width} stopColor={color} stopOpacity={opacity} />,
                ];
              })}
            </linearGradient>
            {/* Brightest at the crest, fading toward the slack line, so the flow reads as a swell, not a block. */}
            <linearGradient id={depthId} x1={0} x2={0} y1={0} y2={1}>
              <stop offset={0} stopColor="white" stopOpacity={0.95} />
              <stop offset={0.5} stopColor="white" stopOpacity={0.4} />
              <stop offset={1} stopColor="white" stopOpacity={0.95} />
            </linearGradient>
            <mask id={`${depthId}-mask`} maskContentUnits="objectBoundingBox">
              <rect x={0} y={0} width={1} height={1} fill={`url(#${depthId})`} />
            </mask>
          </defs>
          {spans.slice(1).map((span) => (
            <line
              key={span.date}
              x1={span.start - 0.5}
              x2={span.start - 0.5}
              y1={0}
              y2={100}
              stroke="var(--foam)"
              strokeOpacity={0.12}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path d={`${flowLine} L${last},50 L0,50 Z`} fill={`url(#${flowId})`} mask={`url(#${depthId}-mask)`} />
          <path d={flowLine} fill="none" stroke={`url(#${flowId})`} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          <line x1={-0.5} x2={last + 0.5} y1={50} y2={50} stroke="var(--foam)" strokeOpacity={0.25} vectorEffect="non-scaling-stroke" />
          <path d={tideLine} fill="none" stroke="var(--tide)" strokeOpacity={0.85} strokeWidth={1.5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {nowIndex > 0 ? <rect x={-0.5} width={nowIndex + 0.5} y={-4} height={108} fill="var(--ink)" fillOpacity={0.55} /> : null}
          <line
            x1={nowIndex}
            x2={nowIndex}
            y1={0}
            y2={100}
            stroke="var(--foam)"
            strokeOpacity={0.6}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span
          className="pointer-events-none absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-foam shadow-[0_0_10px_2px_color-mix(in_srgb,var(--foam)_45%,transparent)]"
          style={{ left: at(selected) }}
        />
        <span
          className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-tide"
          style={{ left: at(selected), top: `${tideY(selected)}%` }}
        />
      </div>
      <div className="relative mt-1 h-4 text-xs text-foam/80">
        {spans.map((span) =>
          (span.end - span.start + 1) / hours.length < 0.1 ? null : (
            <span
              key={span.date}
              className="absolute top-0 -translate-x-1/2 whitespace-nowrap"
              style={{ left: at((span.start + span.end) / 2) }}
            >
              <DayTick date={span.date} today={today} />
            </span>
          ),
        )}
      </div>
    </div>
  );
}

/** Browsers drop the capture on pointerup anyway; releasing it here keeps a cancelled touch from holding it. */
function releasePointer(event: PointerEvent<HTMLDivElement>) {
  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
}

/** Very strong is the stop token; otherwise in/out colours, or foam where the way is a compass heading. */
export function stripColor(hour: HourForecast, compass: boolean): string {
  if (hour.strength === "too_strong") return "var(--stop)";
  if (compass) return "var(--foam)";
  return hour.direction === "incoming" ? "var(--incoming)" : "var(--outgoing)";
}

/**
 * A square box centred on the arrow's middle, so the dial turns it about its centre. Every strength shares the
 * box size, so a stronger hour draws a longer arrow, as on the map.
 */
function dialViewBox(strength: Strength): string {
  const size = 34;
  const middle = ARROW_LENGTH[strength] / 2;
  return `${ARROW_WIDTH / 2 - size / 2} ${middle - size / 2} ${size} ${size}`;
}

function directionTone(direction: Direction): string {
  return direction === "incoming" ? "text-incoming" : "text-outgoing";
}

/** Very strong uses the shared stop token. Other bands stay foam. */
function strengthTone(strength: Strength): string {
  return strength === "too_strong" ? "text-stop" : "text-foam";
}

/** "Incoming", "Outgoing" or "Running NE". */
function capitalized(words: string): string {
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function arrowOpacity(confidence: Confidence): string {
  if (confidence === "low") return "opacity-40";
  if (confidence === "medium") return "opacity-75";
  return "opacity-100";
}

/** "Today · 6 Oct 20:00", or "Thu · 8 Oct 18:00" past tomorrow, so the day matches the strip's labels. */
function hourWhen(time: string, today: string): string {
  const date = time.slice(0, 10);
  const day = dayName(date, today);
  const weekday = shortDayName(date, today).split(" ")[0];
  const named = date === today || date === addUtcDay(today) || !/^\d{4}-/.test(date) ? day : `${weekday} · ${day}`;
  return `${named} ${clock(time)}`;
}

function hourValueText(hour: HourForecast, today: string, way: string): string {
  const when = hourWhen(hour.time, today);
  return `${when}, ${way.toLowerCase()}, ${STRENGTH_LABEL[hour.strength]}, ${hour.confidence} confidence`;
}

function daySpans(hours: readonly HourForecast[]): { date: string; start: number; end: number }[] {
  const spans: { date: string; start: number; end: number }[] = [];
  for (let index = 0; index < hours.length; index += 1) {
    const date = hours[index].time.slice(0, 10);
    const last = spans[spans.length - 1];
    if (last == null || last.date !== date) spans.push({ date, start: index, end: index });
    else last.end = index;
  }
  return spans;
}

function addUtcDay(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  return new Date(Date.UTC(year, monthIndex, day + 1)).toISOString().slice(0, 10);
}

function dayName(date: string, today: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const day = match ? Number(match[3]) : date;
  const month = match ? MONTHS[Number(match[2]) - 1] ?? "" : "";
  const pretty = month ? `${day} ${month}` : date;
  if (date === today) return `Today · ${pretty}`;
  if (date === addUtcDay(today)) return `Tomorrow · ${pretty}`;
  return pretty;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Thu 29" under the week strip; just "Thu" on a narrow phone, where the dates would run into each other. */
function DayTick({ date, today }: { date: string; today: string }) {
  const [weekday, day] = shortDayName(date, today).split(" ");
  return (
    <>
      {weekday}
      {day ? <span className="hidden min-[400px]:inline"> {day}</span> : null}
    </>
  );
}

/** A week of labels has to fit a phone: "Today", then "Fri 2". */
function shortDayName(date: string, today: string): string {
  if (date === today) return "Today";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const weekday = WEEKDAYS[new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay()];
  return `${weekday} ${Number(match[3])}`;
}

/** "at 23:00" on the same day, "Wed 7 at 02:00" on another. */
function turnWhen(time: string, today: string): string {
  const date = time.slice(0, 10);
  if (date === today) return `at ${clock(time)}`;
  return `${shortDayName(date, today)} at ${clock(time)}`;
}

function fetchedCaption(wall: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(wall);
  if (!match) return wall;
  const month = MONTHS[Number(match[2]) - 1] ?? match[2];
  return `${Number(match[3])} ${month} ${match[4]}`;
}

function clock(time: string): string {
  const match = /T(\d{2}:\d{2})/.exec(time);
  return match ? match[1] : time;
}
