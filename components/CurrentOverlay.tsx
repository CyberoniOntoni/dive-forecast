"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AddSiteForm } from "@/components/AddSiteForm";
import { loadSheetOpen, saveSheetOpen, siteCountLabel, type MapView } from "@/lib/map-view";
import {
  atollChoices,
  filterCountLabel,
  filterListSites,
  loadListFilterText,
  parseListFilter,
  saveListFilter,
  type ListFilter,
} from "@/lib/site-search";
import { listAtollLabel, repeatedNames } from "@/lib/site-labels";
import { glanceRank, type NowcastGlance } from "@/lib/nowcast-glance";
import type { Site } from "@/lib/types";

export type SiteGlance = {
  site: Site;
  glance: NowcastGlance;
  /** Short fetch age when the series is stale. Null when the call is fresh or missing. */
  age: string | null;
};

type Point = { lat: number; lon: number };

/** The saved sheet state only changes through this component, so there is nothing to subscribe to. */
function noSubscription(): () => void {
  return () => {};
}

function closedOnServer(): boolean {
  return false;
}

function noFilterOnServer(): string {
  return "";
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
  atollNames,
  view,
  maldivesWall,
  draft,
  adding,
  onAddingChange,
  onAdded,
  onFocusAtoll,
  onSpotlight,
}: {
  siteGlances: readonly SiteGlance[];
  atollNames: Readonly<Record<string, string>>;
  /** The map's visible area. The list shows only the sites inside it; null (before the map loads) shows all. */
  view: MapView | null;
  maldivesWall: string;
  draft: Point | null;
  adding: boolean;
  onAddingChange: (open: boolean) => void;
  onAdded: () => void;
  /** Frame the map on an atoll's sites when the list is narrowed to it. */
  onFocusAtoll: (atollId: string) => void;
  /** Centre the map on a site and highlight it; null clears the highlight. */
  onSpotlight: (siteId: string | null) => void;
}) {
  // Back from a site page, the phone list opens as it was. The server renders it closed; the browser reads the tab's
  // saved state, so hydration does not mismatch.
  const savedOpen = useSyncExternalStore(noSubscription, loadSheetOpen, closedOnServer);
  const [toggled, setToggled] = useState<boolean | null>(null);
  const expanded = toggled ?? savedOpen;
  // Counted over every site, not just those in view, so a label does not come and go as the map moves.
  const repeated = useMemo(() => repeatedNames(siteGlances.map(({ site }) => site)), [siteGlances]);
  // A search or an atoll kept for the tab, so it is still there back from a site page. The server renders no filter.
  const savedFilterText = useSyncExternalStore(noSubscription, loadListFilterText, noFilterOnServer);
  const [edited, setEdited] = useState<ListFilter | null>(null);
  const filter = edited ?? (savedFilterText ? parseListFilter(savedFilterText) : { query: "", atollId: "" });
  const atolls = useMemo(() => atollChoices(siteGlances.map(({ site }) => site), atollNames), [siteGlances, atollNames]);
  const visible = filterListSites(siteGlances, filter, view, atollNames);
  const filtered = Boolean(filter.query.trim() || filter.atollId);
  const countLabel =
    filterCountLabel(visible.length, filter, atollNames[filter.atollId]) ??
    siteCountLabel(visible.length, siteGlances.length);
  // W9: copy then sort. Equal ranks stay in the name order already on the list.
  const ranked = [...visible].sort((left, right) => glanceRank(left.glance) - glanceRank(right.glance));

  function changeFilter(next: ListFilter) {
    setEdited(next);
    saveListFilter(next);
    if (next.atollId && next.atollId !== filter.atollId) onFocusAtoll(next.atollId);
  }

  /** On a phone the open list covers half the map, so it folds down to show the site; the search stays. */
  function showOnMap(siteId: string) {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      onAddingChange(false);
      saveSheetOpen(false);
      setToggled(false);
    }
    onSpotlight(siteId);
  }

  function toggleSheet() {
    // Closing the sheet also leaves add mode, so a collapsed sheet does not keep a hidden form.
    if (expanded) onAddingChange(false);
    saveSheetOpen(!expanded);
    setToggled(!expanded);
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
        <div className="flex flex-col gap-2 px-3 pb-3" role="search">
          <label className="sr-only" htmlFor="site-search">
            Search sites
          </label>
          <div className="flex min-w-0 gap-2">
            <input
              id="site-search"
              type="search"
              placeholder="Search sites"
              autoComplete="off"
              maxLength={80}
              value={filter.query}
              onChange={(event) => changeFilter({ ...filter, query: event.target.value })}
              className="min-h-11 w-full min-w-0 flex-1 rounded-md border border-foam/25 bg-ink px-3 text-base text-foam placeholder:text-foam/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
            />
            {filtered ? (
              <button
                type="button"
                onClick={() => {
                  changeFilter({ query: "", atollId: "" });
                  onSpotlight(null);
                }}
                className="min-h-11 shrink-0 rounded-md border border-foam/25 px-3 text-sm hover:bg-foam/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
              >
                Clear
              </button>
            ) : null}
          </div>
          <label className="sr-only" htmlFor="site-atoll">
            Atoll
          </label>
          <select
            id="site-atoll"
            value={filter.atollId}
            onChange={(event) => changeFilter({ ...filter, atollId: event.target.value })}
            className="min-h-11 w-full min-w-0 rounded-md border border-foam/25 bg-ink px-3 text-base text-foam focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
          >
            <option value="">All atolls (sites in view)</option>
            {atolls.map((atoll) => (
              <option key={atoll.id} value={atoll.id}>
                {atoll.name} ({atoll.count})
              </option>
            ))}
          </select>
        </div>
        <nav aria-label="Dive sites">
          <ul className="pb-2">
            {ranked.map((item) => (
              <SiteRow
                key={item.site.id}
                {...item}
                onShowOnMap={showOnMap}
                // A search spans atolls, so every row names its atoll; otherwise only repeated names do.
                atoll={
                  filter.query.trim() && !filter.atollId
                    ? (atollNames[item.site.atollId] ?? null)
                    : listAtollLabel(item.site, repeated, atollNames)
                }
              />
            ))}
          </ul>
          {ranked.length === 0 && siteGlances.length > 0 ? (
            <p className="px-3 pb-3 text-sm text-foam/80">
              {filtered ? "No sites match. Try fewer letters, or clear the search." : "No sites here. Zoom out."}
            </p>
          ) : null}
        </nav>
      </div>
    </aside>
  );
}

/**
 * One site: the row opens its forecast page, and the pin button beside it shows the site on the map. The button sits
 * beside the link, not inside it, so each does one thing.
 */
export function SiteRow({
  site,
  glance,
  age,
  atoll,
  onShowOnMap,
}: SiteGlance & { atoll: string | null; onShowOnMap: (siteId: string) => void }) {
  const title = age ? `${glance.spoken}, ${age}` : glance.spoken;
  return (
    <li className="flex min-w-0 items-stretch border-b border-foam/10 last:border-b-0">
      <Link
        href={`/sites/${site.id}`}
        prefetch={false}
        title={title}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 pl-3 pr-1 text-sm hover:bg-foam/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-incoming"
      >
        <span className="min-w-0 flex-1 truncate font-medium">
          {site.name}
          {atoll ? <span className="font-normal text-foam/65"> · {atoll}</span> : null}
        </span>
        <CurrentBits glance={glance} age={age} />
      </Link>
      <button
        type="button"
        onClick={() => onShowOnMap(site.id)}
        aria-label={`Show ${site.name} on the map`}
        title="Show on map"
        className="grid w-11 shrink-0 place-items-center text-foam/70 hover:bg-foam/10 hover:text-foam focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-incoming"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </svg>
      </button>
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
        {glance.way}
      </span>
      <span style={{ color }}>{glance.label}</span>
      <span>{glance.confidence}</span>
      {age ? <span className="tabular-nums text-foam/70">{age}</span> : null}
    </span>
  );
}
