"use client";

import { useState } from "react";
import type { Direction, HourForecast, Strength } from "@/lib/types";

const STRENGTH_LABEL: Record<Strength, string> = {
  slack: "Slack",
  mild: "Mild",
  strong: "Strong",
  too_strong: "Too strong",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function HourSlider({
  hours,
  unavailable,
  inwardBearingDeg,
  notice,
  fetchedAt = null,
  maldivesWall,
  initialIndex,
}: {
  hours: HourForecast[];
  unavailable: boolean;
  inwardBearingDeg: number | null;
  notice: string;
  fetchedAt?: { wall: string; iso: string } | null;
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

  const selected = Math.min(index, hours.length - 1);
  const hour = hours[selected];
  const today = maldivesWall.slice(0, 10);
  const bearing = inwardBearingDeg == null ? null : callBearing(hour.direction, inwardBearingDeg);
  const tone = hour.direction === "incoming" ? "text-incoming" : "text-outgoing";
  const quiet =
    hour.confidence === "low" ? "opacity-40" : hour.confidence === "medium" ? "opacity-75" : "opacity-100";
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
              aria-label={`${hour.direction === "incoming" ? "Incoming" : "Outgoing"} arrow, ${Math.round(bearing)} degrees clockwise from north`}
            >
              <path d="M32 4l11 30h-7v26h-8V34h-7L32 4z" fill="currentColor" />
            </svg>
          </div>
        )}
        <div className="min-w-0">
          <p className={`text-4xl font-semibold tracking-tight break-words sm:text-6xl ${tone}`}>
            {hour.direction === "incoming" ? "Incoming" : "Outgoing"}
          </p>
          <p className="mt-2 text-lg text-foam sm:text-xl">{STRENGTH_LABEL[hour.strength]}</p>
          <p className={`text-sm sm:text-base ${hour.confidence === "low" ? "text-foam/50" : hour.confidence === "medium" ? "text-foam/75" : "text-foam"}`}>
            {hour.confidence} confidence
          </p>
          <p className="mt-2 font-mono text-sm tabular-nums text-foam/80">
            {dayName(hour.time.slice(0, 10), today)} {clock(hour.time)}
          </p>
        </div>
      </div>
      {fetchedAt ? (
        <p className="mt-3 text-xs leading-5 text-foam/80">
          Fetched <time dateTime={fetchedAt.iso}>{fetchedCaption(fetchedAt.wall)}</time> Maldives
        </p>
      ) : null}

      <div className="mt-6 px-6">
        <div className="mb-2 flex text-xs text-foam/80" aria-hidden="true">
          {spans.map((span) => (
            <span
              key={span.date}
              className="min-w-0 truncate"
              style={{ flex: `0 0 ${((span.end - span.start + 1) / hours.length) * 100}%` }}
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
            aria-valuetext={`${dayName(hour.time.slice(0, 10), today)} ${clock(hour.time)}, ${hour.direction}, ${STRENGTH_LABEL[hour.strength]}, ${hour.confidence} confidence`}
            className={`h-11 w-full min-w-0 cursor-pointer appearance-none bg-transparent bg-[linear-gradient(transparent_19px,color-mix(in_srgb,var(--foam)_35%,transparent)_19px,color-mix(in_srgb,var(--foam)_35%,transparent)_25px,transparent_25px)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-incoming disabled:cursor-default ${tone} [&::-moz-range-thumb]:h-11 [&::-moz-range-thumb]:w-11 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-ink [&::-moz-range-thumb]:bg-current [&::-moz-range-track]:bg-transparent [&::-webkit-slider-thumb]:h-11 [&::-webkit-slider-thumb]:w-11 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-ink [&::-webkit-slider-thumb]:bg-current`}
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

/** Incoming follows the atoll inward bearing. Outgoing is 180° opposite. Not the ocean vector. */
function callBearing(direction: Direction, inwardBearingDeg: number): number {
  const inward = ((inwardBearingDeg % 360) + 360) % 360;
  return direction === "incoming" ? inward : (inward + 180) % 360;
}

function daySpans(hours: HourForecast[]): { date: string; start: number; end: number }[] {
  const spans: { date: string; start: number; end: number }[] = [];
  hours.forEach((hour, index) => {
    const date = hour.time.slice(0, 10);
    const last = spans[spans.length - 1];
    if (!last || last.date !== date) spans.push({ date, start: index, end: index });
    else last.end = index;
  });
  return spans;
}

function addUtcDay(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1)).toISOString().slice(0, 10);
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
