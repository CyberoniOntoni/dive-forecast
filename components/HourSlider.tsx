"use client";

import { useState } from "react";
import type { Confidence, Direction, HourForecast, Strength } from "@/lib/types";

const STRENGTH_LABEL: Record<Strength, string> = {
  slack: "Slack",
  mild: "Mild",
  strong: "Strong",
  too_strong: "Too strong",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const RANGE_TRACK = "h-11 w-full min-w-0 cursor-pointer appearance-none bg-transparent bg-[linear-gradient(transparent_19px,color-mix(in_srgb,var(--foam)_35%,transparent)_19px,color-mix(in_srgb,var(--foam)_35%,transparent)_25px,transparent_25px)]";
const RANGE_FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-incoming disabled:cursor-default";
const RANGE_THUMB = "[&::-moz-range-thumb]:h-11 [&::-moz-range-thumb]:w-11 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-ink [&::-moz-range-thumb]:bg-current [&::-moz-range-track]:bg-transparent [&::-webkit-slider-thumb]:h-11 [&::-webkit-slider-thumb]:w-11 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-ink [&::-webkit-slider-thumb]:bg-current";

export function HourSlider({
  hours,
  unavailable,
  inwardBearingDeg,
  notice,
  fetchedAt = null,
  stale = false,
  maldivesWall,
  initialIndex,
}: {
  hours: HourForecast[];
  unavailable: boolean;
  inwardBearingDeg: number | null;
  notice: string;
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
        <p className="mt-3 text-sm leading-6 text-foam/80">{notice}</p>
      </section>
    );
  }

  const selected = clampHourIndex(index, hours.length);
  const hour = hours[selected];
  const today = maldivesWall.slice(0, 10);
  const bearing = inwardBearingDeg == null ? null : callBearing(hour.direction, inwardBearingDeg);
  const tone = directionTone(hour.direction);
  const quiet = arrowOpacity(hour.confidence);
  const way = directionWord(hour.direction);
  const spans = daySpans(hours);

  return (
    <section aria-labelledby="forecast-heading" className="rounded-2xl border border-foam/15 bg-glass p-4 sm:p-6">
      <h2 id="forecast-heading" className="sr-only">
        Forecast hour
      </h2>
      <div className="flex min-w-0 items-center gap-4">
        {bearing == null ? null : (
          <div className={`relative grid h-28 w-28 shrink-0 place-items-center rounded-full border border-foam/20 bg-ink/50 ${tone}`}>
            <svg
              viewBox="0 0 64 64"
              className={`h-16 w-16 ${quiet}`}
              style={{ transform: `rotate(${bearing}deg)` }}
              role="img"
              aria-label={arrowLabel(hour.direction, bearing)}
            >
              <path d="M32 4l11 30h-7v26h-8V34h-7L32 4z" fill="currentColor" />
            </svg>
          </div>
        )}
        <div className="min-w-0">
          <p className={`text-4xl font-semibold tracking-tight break-words sm:text-6xl ${tone}`}>
            {way}
          </p>
          <p className={`mt-2 text-lg sm:text-xl ${strengthTone(hour.strength)}`}>{STRENGTH_LABEL[hour.strength]}</p>
          <p className={`text-sm sm:text-base ${confidenceText(hour.confidence)}`}>
            {hour.confidence} confidence
          </p>
          <p className="mt-2 font-mono text-sm tabular-nums text-foam/80">
            {hourWhen(hour.time, today)}
          </p>
        </div>
      </div>
      <ResidualLine hours={hours} selected={selected} />
      {stale || fetchedAt ? (
        <p className="mt-3 text-xs leading-5 text-foam/80">
          {stale ? "This series is old." : null}
          {stale && fetchedAt ? " " : null}
          {fetchedAt ? (
            <>
              Fetched <time dateTime={fetchedAt.iso}>{fetchedCaption(fetchedAt.wall)}</time> Maldives
            </>
          ) : null}
        </p>
      ) : null}

      <div className="mt-6 px-6">
        <div className="mb-2 flex text-xs text-foam/80" aria-hidden="true">
          {spans.map((span) => (
            <span
              key={span.date}
              className="min-w-0 truncate"
              style={{ flex: dayShare(span, hours.length) }}
            >
              {dayName(span.date, today)}
            </span>
          ))}
        </div>
        <label className="block min-w-0" htmlFor="forecast-hour">
          <span className="sr-only">Today and tomorrow</span>
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
            aria-valuetext={hourValueText(hour, today)}
            className={`${RANGE_TRACK} ${RANGE_FOCUS} ${tone} ${RANGE_THUMB}`}
          />
        </label>
        <div className="mt-1 grid grid-cols-3 gap-2 font-mono text-xs tabular-nums text-foam/70">
          <span className="min-w-0 truncate">{clock(hours[0].time)}</span>
          <span className="min-w-0 truncate text-center text-foam">
            {selected + 1} / {hours.length}
          </span>
          <span className="min-w-0 truncate text-right">{clock(hours[hours.length - 1].time)}</span>
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-foam/80">{notice}</p>
    </section>
  );
}

/** W7: after the empty/unavailable branch, keep the slider index inside the hours. */
export function clampHourIndex(index: number, hourCount: number): number {
  return Math.max(0, Math.min(index, hourCount - 1));
}

/** Stored residual metres. The line is not a new tide. */
function ResidualLine({ hours, selected }: { hours: HourForecast[]; selected: number }) {
  const points = residualPoints(hours);
  if (points == null) return null;
  const mark = points[Math.min(selected, points.length - 1)];
  const drawn = points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
  return (
    <div className="relative mx-6 mt-5 h-16" aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full text-foam">
        <polyline
          points={drawn}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span
        className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-foam bg-ink"
        style={{ left: `${mark.x}%`, top: `${mark.y}%` }}
      />
    </div>
  );
}

function residualPoints(hours: HourForecast[]): { x: number; y: number }[] | null {
  if (hours.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const hour of hours) {
    if (!Number.isFinite(hour.levelM)) return null;
    if (hour.levelM < min) min = hour.levelM;
    if (hour.levelM > max) max = hour.levelM;
  }
  const span = max - min;
  return hours.map((hour, index) => {
    const across = hours.length === 1 ? 0.5 : index / (hours.length - 1);
    const rise = span === 0 ? 0.5 : (hour.levelM - min) / span;
    return {
      x: 3 + across * 94,
      y: 14 + (1 - rise) * 72,
    };
  });
}

/** Incoming follows the atoll inward bearing. Outgoing is 180° opposite. Not the ocean vector. */
function callBearing(direction: Direction, inwardBearingDeg: number): number {
  const inward = ((inwardBearingDeg % 360) + 360) % 360;
  return direction === "incoming" ? inward : (inward + 180) % 360;
}

function directionTone(direction: Direction): string {
  return direction === "incoming" ? "text-incoming" : "text-outgoing";
}

/** Too strong uses the shared stop token. Other bands stay foam. */
function strengthTone(strength: Strength): string {
  return strength === "too_strong" ? "text-stop" : "text-foam";
}

function directionWord(direction: Direction): string {
  return direction === "incoming" ? "Incoming" : "Outgoing";
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

function arrowLabel(direction: Direction, bearing: number): string {
  return `${directionWord(direction)} arrow, ${Math.round(bearing)} degrees clockwise from north`;
}

function hourWhen(time: string, today: string): string {
  return `${dayName(time.slice(0, 10), today)} ${clock(time)}`;
}

function hourValueText(hour: HourForecast, today: string): string {
  const when = hourWhen(hour.time, today);
  return `${when}, ${hour.direction}, ${STRENGTH_LABEL[hour.strength]}, ${hour.confidence} confidence`;
}

function dayShare(span: { start: number; end: number }, hourCount: number): string {
  const covered = span.end - span.start + 1;
  return `0 0 ${(covered / hourCount) * 100}%`;
}

function daySpans(hours: HourForecast[]): { date: string; start: number; end: number }[] {
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
