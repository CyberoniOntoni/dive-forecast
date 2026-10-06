"use client";

import { useState, type PointerEvent } from "react";
import { ARROW_LENGTH, ARROW_WIDTH, arrowPath } from "@/lib/arrow-shape";
import { compassWord, confidenceOpacity, onCompass, routeArrowBearing, routeWay } from "@/lib/nowcast-glance";
import type { BearingSource, Confidence, Direction, ForecastRoute, HourForecast, Strength } from "@/lib/types";

const STRENGTH_LABEL: Record<Strength, string> = {
  slack: "Slack",
  mild: "Mild",
  strong: "Strong",
  too_strong: "Very strong",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const RANGE_TRACK = "h-11 w-full min-w-0 cursor-pointer appearance-none bg-transparent bg-[linear-gradient(transparent_19px,color-mix(in_srgb,var(--foam)_35%,transparent)_19px,color-mix(in_srgb,var(--foam)_35%,transparent)_25px,transparent_25px)]";
const RANGE_FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-incoming disabled:cursor-default";
const RANGE_THUMB = "[&::-moz-range-thumb]:h-11 [&::-moz-range-thumb]:w-11 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-ink [&::-moz-range-thumb]:bg-current [&::-moz-range-track]:bg-transparent [&::-webkit-slider-thumb]:h-11 [&::-webkit-slider-thumb]:w-11 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-ink [&::-webkit-slider-thumb]:bg-current";

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
}) {
  const [index, setIndex] = useState(initialIndex);

  if (unavailable || hours.length === 0) {
    return (
      <section aria-labelledby="forecast-heading" className="rounded-2xl border border-foam/15 bg-glass p-4 sm:p-6">
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

  return (
    <section aria-labelledby="forecast-heading" className="rounded-2xl border border-foam/15 bg-glass p-4 sm:p-6">
      <h2 id="forecast-heading" className="sr-only">
        Forecast hour
      </h2>
      <div className="flex min-w-0 items-center gap-4">
        {bearing == null ? null : (
          <div className={`relative grid h-28 w-28 shrink-0 place-items-center rounded-full border border-foam/20 bg-ink/50 ${tone}`}>
            <CompassMarks />
            <svg
              viewBox={dialViewBox(hour.strength)}
              className={`h-20 w-20 ${quiet}`}
              style={{ transform: `rotate(${bearing}deg)` }}
              role="img"
              aria-label={`${way} arrow, ${Math.round(bearing)} degrees clockwise from north`}
            >
              {bearingSource === "fallback" ? (
                <path
                  d={arrowPath(ARROW_LENGTH[hour.strength])}
                  fill="currentColor"
                  fillOpacity={0.22}
                  stroke="currentColor"
                  strokeWidth={1}
                  strokeLinejoin="round"
                />
              ) : (
                <path d={arrowPath(ARROW_LENGTH[hour.strength])} fill="currentColor" />
              )}
            </svg>
          </div>
        )}
        <div className="min-w-0">
          <p className="font-mono text-sm tabular-nums text-foam/80">{hourWhen(hour.time, today)}</p>
          <p className={`text-4xl font-semibold tracking-tight break-words sm:text-6xl ${tone}`}>
            {way}
          </p>
          {bearing != null && !compass ? (
            <p className="text-sm leading-6 text-foam/80">
              {hour.direction === "incoming" ? "Into the atoll" : "Out of the atoll"}, toward {compassWord(bearing)}
            </p>
          ) : null}
          <p className="mt-1 text-lg sm:text-xl">
            <span className={strengthTone(hour.strength)}>{STRENGTH_LABEL[hour.strength]}</span>
            <span className={`text-sm sm:text-base ${confidenceText(hour.confidence)}`}> · {hour.confidence} confidence</span>
          </p>
          <p className="mt-1 text-sm leading-6 text-foam/80">{turnText(turn, hours, today, wordFor)}</p>
        </div>
      </div>
      {bearing != null && bearingSource === "fallback" ? (
        <p className="mt-3 text-xs leading-5 text-foam/80">
          The arrow heading is an estimate. This pin has no measured channel bearing.
        </p>
      ) : null}

      <div className="mt-6">
        <WeekLegend up={wordFor("incoming")} down={wordFor("outgoing")} compass={compass} />
        <WeekStrip hours={hours} selected={selected} nowIndex={nowIndex} compass={compass} today={today} onPick={setIndex} />
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
            className="inline-flex min-h-11 items-center rounded-md border border-foam/25 px-3 text-sm font-medium text-foam focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
          >
            Back to now
          </button>
        )}
      </div>
      {siteNote ? <p className="mt-4 text-sm leading-6 text-foam/80">{siteNote}</p> : null}
      <p className="mt-4 text-sm leading-6 text-foam/80">{notice}</p>
    </section>
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

/** N, E, S and W round the dial, so the arrow reads as a compass heading. */
function CompassMarks() {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 font-mono text-[10px] leading-none text-foam/60">
      <span className="absolute top-1.5 left-1/2 -translate-x-1/2 font-semibold text-foam">N</span>
      <span className="absolute top-1/2 right-1.5 -translate-y-1/2">E</span>
      <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2">S</span>
      <span className="absolute top-1/2 left-1.5 -translate-y-1/2">W</span>
    </span>
  );
}

function WeekLegend({ up, down, compass }: { up: string; down: string; compass: boolean }) {
  return (
    <p className="mb-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foam/80">
      <span className="inline-flex items-center gap-1">
        <span aria-hidden="true" className={compass ? "text-foam" : "text-incoming"}>
          ▲
        </span>
        {up}
      </span>
      <span className="inline-flex items-center gap-1">
        <span aria-hidden="true" className={compass ? "text-foam" : "text-outgoing"}>
          ▼
        </span>
        {down}
      </span>
      <span className="inline-flex items-center gap-1">
        <span aria-hidden="true" className="text-stop">
          ■
        </span>
        Very strong
      </span>
      <span>Taller is stronger, fainter is less sure</span>
    </p>
  );
}

/**
 * Every hour as a bar: up for incoming (or the reef heading), down for outgoing, as tall as it is strong and as solid
 * as it is sure. It is inset by half the slider thumb, so each bar sits over the thumb's spot for that hour.
 */
function WeekStrip({
  hours,
  selected,
  nowIndex,
  compass,
  today,
  onPick,
}: {
  hours: readonly HourForecast[];
  selected: number;
  nowIndex: number;
  compass: boolean;
  today: string;
  onPick: (index: number) => void;
}) {
  const last = Math.max(hours.length - 1, 1);
  const spans = daySpans(hours);
  const at = (index: number) => `${(index / last) * 100}%`;
  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    const share = (event.clientX - box.left) / box.width;
    onPick(clampHourIndex(Math.round(share * last), hours.length));
  };

  return (
    <div className="mx-[22px]" aria-hidden="true">
      <div className="relative h-5 text-[10px] font-medium text-foam/80">
        <span className="absolute bottom-0 -translate-x-1/2 whitespace-nowrap" style={{ left: at(nowIndex) }}>
          Now
        </span>
      </div>
      <div
        className="relative h-24 cursor-pointer touch-pan-y"
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
          {hours.map((hour, index) => {
            const height = STRIP_HEIGHT[hour.strength] * 46;
            const up = hour.direction === "incoming";
            return (
              <rect
                key={hour.time}
                x={index - 0.42}
                width={0.84}
                y={up ? 50 - height : 50}
                height={height}
                fill={stripColor(hour, compass)}
                fillOpacity={confidenceOpacity(hour.confidence)}
              />
            );
          })}
          {nowIndex > 0 ? <rect x={-0.5} width={nowIndex} y={0} height={100} fill="var(--ink)" fillOpacity={0.55} /> : null}
          <line x1={-0.5} x2={last + 0.5} y1={50} y2={50} stroke="var(--foam)" strokeOpacity={0.35} vectorEffect="non-scaling-stroke" />
          {spans.slice(1).map((span) => (
            <line
              key={span.date}
              x1={span.start - 0.5}
              x2={span.start - 0.5}
              y1={0}
              y2={100}
              stroke="var(--foam)"
              strokeOpacity={0.2}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <line
            x1={nowIndex}
            x2={nowIndex}
            y1={0}
            y2={100}
            stroke="var(--foam)"
            strokeOpacity={0.7}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
          <line x1={selected} x2={selected} y1={-4} y2={104} stroke="var(--foam)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="relative mt-1 h-4 text-xs text-foam/80">
        {spans.map((span) =>
          (span.end - span.start + 1) / hours.length < 0.1 ? null : (
            <span
              key={span.date}
              className="absolute top-0 -translate-x-1/2 whitespace-nowrap"
              style={{ left: at((span.start + span.end) / 2) }}
            >
              {shortDayName(span.date, today)}
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

function confidenceText(confidence: Confidence): string {
  if (confidence === "low") return "text-foam/50";
  if (confidence === "medium") return "text-foam/75";
  return "text-foam";
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
