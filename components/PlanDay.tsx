"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { PlanMap, type PlanMapStop } from "@/components/PlanMap";
import {
  capital,
  countOf,
  dayLabel,
  warnedCount,
  type StopOutlook,
  type StopWarning,
} from "@/lib/dive-plan";
import { getPlanDayLegs, type PlanLeg } from "@/lib/plan-actions";
import { DIVE_TURNAROUND_MIN, durationText, legDeparture, nmFromKm, type LegDeparture } from "@/lib/plan-legs";
import type { PlanDayView, PlanStopView } from "@/lib/plan-view";
import { strengthLabel } from "@/lib/nowcast-glance";
import type { Confidence } from "@/lib/types";

/** The marker colour: the stop token for a warned dive, else incoming teal or outgoing amber, else plain. */
function stopColor(stop: PlanStopView): string {
  if (stop.outlook.status !== "forecast") return "var(--foam)";
  if (stop.outlook.warnings.length > 0) return "var(--stop)";
  if (stop.route !== "channel" || stop.outlook.hour.strength === "slack") return "var(--foam)";
  return stop.outlook.hour.direction === "incoming" ? "var(--incoming)" : "var(--outgoing)";
}

/**
 * One day of a plan: its map, then each dive in order with what the forecast says at its time, and the boat leg to the
 * next. The legs are asked for once the day is on the page (a tenth of a second each on the server).
 */
export function PlanDay({
  planId,
  index,
  day,
  boatSpeedKn,
  today,
}: {
  planId: string;
  index: number;
  day: PlanDayView;
  boatSpeedKn: number;
  /** Maldives date now, "YYYY-MM-DD". */
  today: string;
}) {
  const [legs, setLegs] = useState<PlanLeg[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    if (day.stops.length < 2) return;
    getPlanDayLegs(planId, index)
      .then((result) => {
        if (live) setLegs(result ?? []);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [planId, index, day.stops.length]);

  const mapStops: PlanMapStop[] = day.stops.map((stop, at) => ({
    lat: stop.lat,
    lon: stop.lon,
    number: at + 1,
    name: stop.name,
    color: stopColor(stop),
  }));
  const totalKm = legs?.reduce((sum, leg) => sum + leg.lengthKm, 0) ?? 0;
  const totalMinutes = legs?.reduce((sum, leg) => sum + leg.minutes, 0) ?? 0;
  const warned = warnedCount(day.stops);
  const isToday = day.date === today;
  const past = day.date < today;

  return (
    <section
      id={`day-${day.date}`}
      className={`plan-day flex min-w-0 scroll-mt-16 flex-col gap-4 surface p-4 sm:p-5 ${isToday ? "ring-2 ring-incoming/60" : ""}`}
      aria-labelledby={`day-${day.date}-heading`}
    >
      <header className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 id={`day-${day.date}-heading`} className="text-lg font-semibold text-foam">
            <span className="text-foam/60">Day {index + 1}</span> · {dayLabel(day.date)}
          </h2>
          {isToday ? <Badge tone="incoming">Today</Badge> : past ? <Badge tone="quiet">Done</Badge> : null}
          {warned > 0 ? <Badge tone="stop">{countOf(warned, "dive")} to check</Badge> : null}
        </div>
        <p className="flex min-w-0 flex-wrap gap-x-3 text-sm text-foam/75">
          <span>
            {countOf(day.stops.length, "dive")}
          </span>
          {legs && legs.length > 0 ? (
            <span>
              {nmFromKm(totalKm).toFixed(1)} nm by boat · about {durationText(totalMinutes)} at {boatSpeedKn} kn
            </span>
          ) : null}
        </p>
      </header>
      {day.stops.length > 0 ? (
        <PlanMap stops={mapStops} legs={legs ?? []} compact={day.stops.length === 1} />
      ) : (
        <p className="text-sm text-foam/75">No dives planned yet.</p>
      )}
      <ol className="flex min-w-0 flex-col">
        {day.stops.map((stop, at) => {
          const leg = legs?.find((item) => item.from === at);
          return (
            <li key={`${stop.siteId}-${stop.time}-${at}`} className="flex min-w-0 flex-col">
              <StopCard stop={stop} number={at + 1} />
              {at + 1 < day.stops.length ? (
                <LegLine
                  leg={leg ?? null}
                  loading={legs == null && !failed}
                  speedKn={boatSpeedKn}
                  fromTime={stop.time}
                  toTime={day.stops[at + 1].time}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const BADGE_TONES = {
  incoming: "bg-incoming/20 text-incoming ring-incoming/40",
  stop: "bg-stop/15 text-stop ring-stop/40",
  quiet: "bg-foam/10 text-foam/70 ring-foam/20",
} as const;

function Badge({ tone, children }: { tone: keyof typeof BADGE_TONES; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  );
}

function LegLine({
  leg,
  loading,
  speedKn,
  fromTime,
  toTime,
}: {
  leg: PlanLeg | null;
  loading: boolean;
  speedKn: number;
  fromTime: string;
  toTime: string;
}) {
  let text: string;
  let note: string | null = null;
  let departure: LegDeparture | null = null;
  if (leg) {
    const nm = nmFromKm(leg.lengthKm);
    const same = nm < 0.1;
    text = same ? "Same spot" : `${nm.toFixed(1)} nm · about ${durationText(leg.minutes)} at ${speedKn} kn`;
    if (!same) departure = legDeparture(fromTime, toTime, leg.minutes);
    if (!leg.routed) note = "Straight line: no way round the reef found";
  } else {
    text = loading ? "Planning the boat route…" : "Boat route unavailable";
  }
  return (
    <div className="ml-[1.0625rem] flex min-w-0 items-center gap-3 border-l-2 border-dashed border-foam/25 py-2.5 pl-6 text-sm text-foam/70">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className="shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <path d="M3 15h18l-3 4H6zM12 4v9M12 4l5 7h-5" />
      </svg>
      <span className={`min-w-0 ${loading && !leg ? "animate-pulse" : ""}`}>
        {departure ? (
          <span className={`block font-semibold ${departure.tight ? "text-stop" : "text-foam"}`}>
            Leave by {departure.leaveBy}
            {departure.tight ? (
              <span className="font-normal">
                {" "}
                · tight: the {fromTime} dive needs about {DIVE_TURNAROUND_MIN} min
              </span>
            ) : null}
          </span>
        ) : null}
        <span className="block">{text}</span>
        {note ? <span className="block text-xs text-foam/60">{note}</span> : null}
      </span>
    </div>
  );
}

const CONFIDENCE_WORDS: Record<Confidence, string> = { high: "sure", medium: "fairly sure", low: "rough guess" };

function StopCard({ stop, number }: { stop: PlanStopView; number: number }) {
  const color = stopColor(stop);
  return (
    <article className="flex min-w-0 gap-3 rounded-2xl bg-foam/[0.06] p-3 ring-1 ring-foam/10 sm:gap-4 sm:p-4">
      <div className="flex shrink-0 flex-col items-center gap-1.5">
        <span
          aria-hidden="true"
          className="grid size-8 place-items-center rounded-full text-sm font-bold text-[#07151d] shadow-[0_0_0_2px_var(--ink)]"
          style={{ background: color }}
        >
          {number}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 flex-col">
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2.5">
            <span className="font-mono text-lg font-semibold tabular-nums text-foam">{stop.time}</span>
            <Link
              href={`/sites/${encodeURIComponent(stop.siteId)}`}
              className="min-w-0 text-base font-semibold text-foam underline decoration-incoming/50 underline-offset-4 hover:decoration-incoming focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
            >
              {stop.name}
            </Link>
          </p>
          {stop.facts ? <p className="text-sm text-foam/65">{stop.facts}</p> : null}
        </div>
        <Outlook stop={stop} />
        {stop.note ? (
          <p className="whitespace-pre-line border-l-2 border-foam/25 pl-3 text-sm leading-6 text-foam/90">{stop.note}</p>
        ) : null}
        {stop.howToDive ? (
          <details className="group text-sm text-foam/85">
            <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1 text-foam/75 marker:content-none">
              <span aria-hidden="true" className="transition-transform group-open:rotate-90">›</span> How to dive it
            </summary>
            <p className="whitespace-pre-line leading-6">{stop.howToDive}</p>
          </details>
        ) : null}
        {stop.reportHref ? (
          <Link
            href={stop.reportHref}
            className="inline-flex min-h-11 items-center gap-2 self-start rounded-xl bg-incoming/15 px-3.5 text-sm font-semibold text-incoming ring-1 ring-incoming/40 hover:bg-incoming/25 print:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
            Report the current
          </Link>
        ) : null}
      </div>
    </article>
  );
}

const PILL = "inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-sm";

function Outlook({ stop }: { stop: PlanStopView }) {
  const outlook: StopOutlook = stop.outlook;
  if (outlook.status !== "forecast") {
    const text =
      outlook.status === "unavailable"
        ? "No forecast for this site right now."
        : outlook.status === "past"
          ? "No forecast this far back."
          : `The forecast reaches this dive ${outlook.opensOn ? `on ${dayLabel(outlook.opensOn)}` : "closer to the day"}.`;
    return <p className="text-sm text-foam/65">{text}</p>;
  }
  const { hour, sea, warnings, better } = outlook;
  const strong = hour.strength === "too_strong";
  const color = stopColor(stop);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className={`${PILL} bg-foam/10 font-medium text-foam`}>
          {stop.arrowDeg != null && hour.strength !== "slack" ? (
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              aria-hidden="true"
              style={{ transform: `rotate(${stop.arrowDeg}deg)`, color }}
              fill="currentColor"
            >
              <path d="M12 2l6 12h-4v8h-4v-8H6z" />
            </svg>
          ) : null}
          {stop.way}
        </span>
        <span className={`${PILL} font-medium ${strong ? "bg-stop/20 text-stop" : "bg-foam/10 text-foam"}`}>
          {capital(strengthLabel(hour.strength))}
        </span>
        {sea ? (
          <span className={`${PILL} ${sea.band === "rough" ? "bg-stop/20 text-stop" : "bg-foam/10 text-foam/85"}`}>
            Sea {sea.band} · {sea.feltM.toFixed(1)} m
          </span>
        ) : null}
        <span className="px-1 text-xs text-foam/60">Forecast: {CONFIDENCE_WORDS[hour.confidence]}</span>
      </div>
      {warnings.length > 0 ? (
        <div role="note" className="flex min-w-0 flex-col gap-1 rounded-xl bg-stop/10 px-3 py-2 ring-1 ring-stop/30">
          {warnings.map((warning) => (
            <p key={warning.kind} className="flex items-start gap-2 text-sm font-semibold text-stop">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className="mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l10 18H2zM12 10v5M12 18h.01" />
              </svg>
              {warningText(warning, hour.time)}
            </p>
          ))}
          <p className="pl-6 text-sm text-foam/85">
            {better
              ? `Better ${better.from === better.to ? `at ${clock(better.from)}` : `${clock(better.from)}–${clock(better.to)}`}${
                  stop.betterWay ? `, best ${clock(better.best.time)}: ${lower(stop.betterWay)}, ${strengthLabel(better.best.strength)}` : ""
                }.`
              : "No better daylight hour that day."}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** `diveHour`: the forecast hour the dive starts in. */
function warningText(warning: StopWarning, diveHour: string): string {
  if (warning.kind === "very-strong") {
    return warning.time === diveHour ? "Very strong current at this time" : `Very strong current from ${clock(warning.time)}`;
  }
  if (warning.kind === "wrong-way") return `Running ${warning.direction}; you wanted ${warning.want}`;
  return "Rough sea forecast here";
}

function clock(time: string): string {
  return time.slice(11, 16);
}

function lower(words: string): string {
  return words.charAt(0).toLowerCase() + words.slice(1);
}
