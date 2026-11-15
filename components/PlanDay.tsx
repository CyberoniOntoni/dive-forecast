"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PlanMap, type PlanMapStop } from "@/components/PlanMap";
import { capital, dayLabel, durationText, nmFromKm, type StopOutlook, type StopWarning } from "@/lib/dive-plan";
import { getPlanDayLegs, type PlanLeg } from "@/lib/plan-actions";
import type { PlanDayView, PlanStopView } from "@/lib/plan-view";
import { strengthLabel } from "@/lib/nowcast-glance";
import type { Confidence } from "@/lib/types";


/** The marker colour: the stop token for a warned dive, else incoming teal or outgoing amber, else plain. */
function stopColor(stop: PlanStopView): string {
  if (stop.outlook.status !== "forecast") return "#dce8ee";
  if (stop.outlook.warnings.length > 0) return "var(--stop)";
  if (stop.route !== "channel") return "#dce8ee";
  return stop.outlook.hour.direction === "incoming" ? "var(--incoming)" : "var(--outgoing)";
}

/**
 * One day of a plan: its map, then each dive in order with what the forecast says at its time, and the boat leg to the
 * next. The legs are asked for once the day is on the page (a tenth of a second each on the server).
 */
export function PlanDay({ planId, index, day, boatSpeedKn }: { planId: string; index: number; day: PlanDayView; boatSpeedKn: number }) {
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

  return (
    <section className="plan-day flex min-w-0 flex-col gap-3 surface p-4 sm:p-5" aria-labelledby={`day-${day.date}`}>
      <header className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
        <h2 id={`day-${day.date}`} className="text-lg font-semibold text-foam">
          Day {index + 1} · {dayLabel(day.date)}
        </h2>
        <p className="text-sm text-foam/75">
          {day.stops.length} dive{day.stops.length === 1 ? "" : "s"}
          {legs && legs.length > 0
            ? ` · ${nmFromKm(totalKm).toFixed(1)} nm by boat, about ${durationText(totalMinutes)} at ${boatSpeedKn} kn`
            : ""}
        </p>
      </header>
      {day.stops.length > 0 ? (
        <PlanMap stops={mapStops} legs={legs ?? []} />
      ) : (
        <p className="text-sm text-foam/75">No dives planned yet.</p>
      )}
      <ol className="flex min-w-0 flex-col gap-0">
        {day.stops.map((stop, at) => {
          const leg = legs?.find((item) => item.from === at);
          return (
            <li key={`${stop.siteId}-${stop.time}-${at}`} className="flex min-w-0 flex-col">
              <StopCard stop={stop} number={at + 1} />
              {at + 1 < day.stops.length ? (
                <LegLine leg={leg ?? null} loading={legs == null && !failed} speedKn={boatSpeedKn} />
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function LegLine({ leg, loading, speedKn }: { leg: PlanLeg | null; loading: boolean; speedKn: number }) {
  let text: string;
  if (leg) {
    const nm = nmFromKm(leg.lengthKm);
    text = `${nm < 0.1 ? "Same spot" : `${nm.toFixed(1)} nm, about ${durationText(leg.minutes)} at ${speedKn} kn`}${leg.routed ? "" : " (straight line: no way round the reef found)"}`;
  } else {
    text = loading ? "Planning the boat route…" : "Boat route unavailable";
  }
  return (
    <p className="my-1 ml-3.5 flex items-center gap-2 border-l-2 border-dashed border-foam/30 py-2 pl-5 text-sm text-foam/75">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <path d="M3 15h18l-3 4H6zM12 4v9M12 4l5 7h-5" />
      </svg>
      {text}
    </p>
  );
}

const CONFIDENCE_WORDS: Record<Confidence, string> = { high: "high confidence", medium: "medium confidence", low: "low confidence" };

function StopCard({ stop, number }: { stop: PlanStopView; number: number }) {
  const color = stopColor(stop);
  return (
    <article className="flex min-w-0 gap-3 rounded-2xl bg-foam/5 p-3 ring-1 ring-foam/10">
      <span
        aria-hidden="true"
        className="grid size-7 shrink-0 place-items-center rounded-full text-sm font-semibold text-ink"
        style={{ background: color }}
      >
        {number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-base font-semibold text-foam">{stop.time}</span>
          <Link
            href={`/sites/${encodeURIComponent(stop.siteId)}`}
            className="min-w-0 text-base font-semibold text-foam underline decoration-incoming/60 underline-offset-4 hover:decoration-incoming"
          >
            {stop.name}
          </Link>
        </p>
        {stop.facts ? <p className="text-sm text-foam/70">{stop.facts}</p> : null}
        <Outlook stop={stop} />
        {stop.note ? <p className="whitespace-pre-line text-sm leading-6 text-foam/90">{stop.note}</p> : null}
        {stop.howToDive ? (
          <details className="text-sm text-foam/85">
            <summary className="cursor-pointer text-foam/75">How to dive it</summary>
            <p className="mt-1 whitespace-pre-line leading-6">{stop.howToDive}</p>
          </details>
        ) : null}
        {stop.reportHref ? (
          <Link
            href={stop.reportHref}
            className="button-quiet mt-1 justify-center self-start px-3 print:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
          >
            How was the current? Report it
          </Link>
        ) : null}
      </div>
    </article>
  );
}

function Outlook({ stop }: { stop: PlanStopView }) {
  const outlook: StopOutlook = stop.outlook;
  if (outlook.status === "unavailable") return <p className="text-sm text-foam/70">No forecast for this site right now.</p>;
  if (outlook.status === "past") {
    return <p className="text-sm text-foam/70">No forecast this far back.</p>;
  }
  if (outlook.status === "beyond") {
    return (
      <p className="text-sm text-foam/70">
        Forecast shows {outlook.opensOn ? `from ${dayLabel(outlook.opensOn)}` : "closer to the day"}, a week ahead.
      </p>
    );
  }
  const { hour, sea, warnings, better } = outlook;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-foam">
        {stop.arrowDeg != null && hour.strength !== "slack" ? (
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            aria-hidden="true"
            style={{ transform: `rotate(${stop.arrowDeg}deg)`, color: stopColor(stop) }}
            fill="currentColor"
          >
            <path d="M12 2l6 12h-4v8h-4v-8H6z" />
          </svg>
        ) : null}
        <span className="font-medium">{stop.way}</span>
        <span>· {capital(strengthLabel(hour.strength))}</span>
        <span className="text-foam/70">· {CONFIDENCE_WORDS[hour.confidence]}</span>
        {sea ? <span className="text-foam/70">· Sea {sea.band}, {sea.feltM.toFixed(1)} m</span> : null}
      </p>
      {warnings.map((warning) => (
        <p key={warning.kind} className="flex items-start gap-1.5 text-sm font-medium text-stop">
          <span aria-hidden="true">⚠</span>
          {warningText(warning, hour.time)}
        </p>
      ))}
      {better ? (
        <p className="text-sm text-foam/85">
          Better {better.from === better.to ? `at ${clock(better.from)}` : `from ${clock(better.from)} to ${clock(better.to)}`}
          {stop.betterWay ? `: best ${clock(better.best.time)}, ${lower(stop.betterWay)}, ${strengthLabel(better.best.strength)}` : ""}.
        </p>
      ) : warnings.length > 0 ? (
        <p className="text-sm text-foam/75">No better daylight hour that day.</p>
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
