"use client";

import { useState } from "react";
import Link from "next/link";
import { AddSiteForm } from "@/components/AddSiteForm";
import { glanceRank, type NowcastGlance } from "@/lib/nowcast-glance";
import type { Site } from "@/lib/types";

export type SiteGlance = {
  site: Site;
  glance: NowcastGlance;
  /** Short fetch age when the series is stale. Null when the call is fresh or missing. */
  age: string | null;
};

type Point = { lat: number; lon: number };

function siteCountLabel(count: number): string {
  const noun = count === 1 ? "site" : "sites";
  return `${count} ${noun}`;
}

function chevronTurn(expanded: boolean): string {
  return expanded ? "rotate(135deg)" : "rotate(-45deg)";
}
function maldivesHourTitle(wall: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wall);
  if (!match) return "Maldives hour";
  return `${match[4]}:${match[5]} Maldives`;
}

/** Phone: bottom sheet. Wide window: a fixed column beside the map, not an overlay. */
const SHEET_CLASS = "now-sheet absolute inset-x-0 bottom-0 z-[500] max-h-full min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain rounded-t-2xl border border-foam/20 bg-ink pb-[env(safe-area-inset-bottom)] text-foam shadow-lg lg:static lg:inset-auto lg:z-auto lg:h-full lg:max-h-full lg:w-[22rem] lg:shrink-0 lg:rounded-none lg:border-y-0 lg:border-l-0 lg:pb-0 lg:shadow-none";

/* Open phone sheet stays at most half the viewport so the map stays visible. 50dvh is the fallback when clamp is unavailable. */
const SHEET_STYLE = `
@media (max-width: 1023px) {
  .now-sheet[data-open="true"] {
    max-height: 50dvh !important;
    max-height: clamp(11rem, calc(100% - 50dvh), 50dvh) !important;
  }
  /* W10: add form needs more sheet; closed sheet still leaves half the map. */
  .now-sheet[data-open="true"][data-adding="true"] {
    max-height: 85dvh !important;
  }
}
`;

export function CurrentOverlay({
  siteGlances,
  maldivesWall,
  draft,
  adding,
  onAddingChange,
  onAdded,
}: {
  siteGlances: readonly SiteGlance[];
  maldivesWall: string;
  draft: Point | null;
  adding: boolean;
  onAddingChange: (open: boolean) => void;
  onAdded: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const countLabel = siteCountLabel(siteGlances.length);
  // W9: copy then sort. Equal ranks stay in the name order already on the list.
  const ranked = [...siteGlances].sort((left, right) => glanceRank(left.glance) - glanceRank(right.glance));

  function toggleSheet() {
    // Closing the sheet also leaves add mode, so a collapsed sheet does not keep a hidden form.
    if (expanded) onAddingChange(false);
    setExpanded((open) => !open);
  }

  return (
    <aside
      aria-label="Currents now"
      data-open={expanded ? "true" : "false"}
      data-adding={adding ? "true" : undefined}
      className={SHEET_CLASS}
    >
      <style>{SHEET_STYLE}</style>
      <div className="sticky top-0 z-10 border-b border-foam/15 bg-ink lg:hidden">
        <button
          type="button"
          className="flex min-h-14 w-full items-center justify-between gap-3 px-3 text-left text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-incoming"
          aria-expanded={expanded}
          aria-controls="now-sheet-body"
          onClick={toggleSheet}
        >
          <span className="tabular-nums">{countLabel}</span>
          <span className="flex items-center gap-2">
            <span>now</span>
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 border-r-2 border-t-2 border-current"
              style={{ transform: chevronTurn(expanded) }}
            />
          </span>
        </button>
      </div>
      <div className="sticky top-0 z-10 hidden border-b border-foam/15 bg-ink px-3 py-3 lg:block">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight">now</h2>
          <p className="text-sm tabular-nums text-foam/80">{countLabel}</p>
        </div>
      </div>
      <div id="now-sheet-body" className={expanded ? "block" : "hidden lg:block"}>
        <p className="px-3 pt-3 text-xs leading-5 tabular-nums text-foam/75">{maldivesHourTitle(maldivesWall)}</p>
        <div className="flex flex-col gap-2 px-3 py-3">
          <button
            type="button"
            className="min-h-11 w-full rounded-md border border-foam/30 px-3 text-sm font-semibold hover:bg-foam/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
            aria-expanded={adding}
            aria-controls={adding ? "add-site-form" : undefined}
            onClick={() => onAddingChange(!adding)}
          >
            {adding ? "Close" : "Add site"}
          </button>
          {adding ? <AddSiteForm point={draft} onAdded={onAdded} /> : null}
        </div>
        <nav aria-label="Dive sites">
          <ul className="pb-2">
            {ranked.map((item) => (
              <SiteRow key={item.site.id} {...item} />
            ))}
          </ul>
        </nav>
      </div>
    </aside>
  );
}

function SiteRow({ site, glance, age }: SiteGlance) {
  const title = age ? `${glance.spoken}, ${age}` : glance.spoken;
  return (
    <li className="border-b border-foam/10 last:border-b-0">
      <Link
        href={`/sites/${site.id}`}
        prefetch={false}
        title={title}
        className="flex min-h-11 items-center gap-2 px-3 text-sm hover:bg-foam/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-incoming"
      >
        <span className="min-w-0 flex-1 truncate font-medium">{site.name}</span>
        <CurrentBits glance={glance} age={age} />
      </Link>
    </li>
  );
}

/** nowcastGlance sets label, bearing, direction, confidence, and opacity together, or leaves them all null. */
export function hasForecast(
  glance: NowcastGlance,
): glance is NowcastGlance & {
  label: string;
  arrowBearing: number;
  direction: NonNullable<NowcastGlance["direction"]>;
  confidence: NonNullable<NowcastGlance["confidence"]>;
  opacity: number;
} {
  return glance.confidence != null;
}

function CurrentBits({ glance, age }: { glance: NowcastGlance; age: string | null }) {
  if (!hasForecast(glance)) {
    return <span className="shrink-0 text-xs text-foam/70">unavailable</span>;
  }
  const color = glance.color ?? undefined;
  return (
    <span className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs" style={{ opacity: glance.opacity }}>
      <span className="font-medium" style={{ color }}>
        {glance.direction}
      </span>
      <span style={{ color }}>{glance.label}</span>
      <span>{glance.confidence}</span>
      {age ? <span className="tabular-nums text-foam/70">{age}</span> : null}
    </span>
  );
}
