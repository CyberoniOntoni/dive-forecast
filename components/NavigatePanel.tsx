"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { BoatNav, type NavDraw, type NavSite } from "@/components/BoatNav";
import { DOCKED_PANEL_CLASS, GRAB_HANDLE_CLASS } from "@/components/map-panel";
import { SEARCH_FIELD_CLASS, SiteName } from "@/components/site-ui";
import { formatNm } from "@/lib/boat-nav";
import { pointDestinationName, readPointDestination } from "@/lib/point-destination";
import type { LatLon } from "@/lib/geometry";
import { destinationList, navigateHref, readNavigate, saveNavSite, showOnMapPage } from "@/lib/navigate-tab";
import type { Site } from "@/lib/types";

/** Phone: docked under the map, at most a bit over half the screen. Wide window: the column the site list uses. */
const PANEL_CLASS = `${DOCKED_PANEL_CLASS} max-h-[60dvh] bg-glass px-4 pt-1.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-12px_32px_-12px_rgba(0,0,0,0.6)] backdrop-blur-md lg:pt-4`;

/**
 * The Navigate tab's state, from the address: the map with "?navigate", and "?navigate=<site id>" once a destination
 * is picked ("?navigate=<lat>,<lon>" for a point picked on the map). The destination is kept for the browser tab, so the header's Navigate tab comes back to it.
 *
 * `trip` is the destination being followed. It outlasts a switch to the Map tab, so the GPS, the route and the screen
 * lock keep going while the skipper looks at the map; it ends when the destination list is opened.
 */
export function useNavigateTab(sites: readonly Site[]): {
  navigating: boolean;
  site: NavSite | null;
  trip: NavSite | null;
  pick: (siteId: string) => void;
  change: () => void;
} {
  const params = useSearchParams();
  const { navigating, siteId } = readNavigate(params);
  const site = useMemo<NavSite | null>(() => {
    if (!navigating) return null;
    const found = sites.find((item) => item.id === siteId);
    if (found) return { id: found.id, name: found.name, lat: found.lat, lon: found.lon };
    const point = siteId ? readPointDestination(siteId) : null;
    return point && siteId ? { id: siteId, name: pointDestinationName(point), ...point } : null;
  }, [sites, navigating, siteId]);

  const [trip, setTrip] = useState<NavSite | null>(null);
  if (navigating && site?.id !== trip?.id) setTrip(site);

  // A destination that is gone (a removed site, an old link) is forgotten, so the Navigate tab stops coming back to it.
  useEffect(() => {
    if (site) saveNavSite(site.id);
    else if (siteId) {
      saveNavSite(null);
      showOnMapPage(navigateHref(null), true);
    }
  }, [site, siteId]);

  return {
    navigating,
    site,
    trip,
    pick: (id) => showOnMapPage(navigateHref(id), true),
    change: () => {
      saveNavSite(null);
      showOnMapPage(navigateHref(null), true);
    },
  };
}

/** The Navigate tab: pick a destination, then follow the boat to it. */
export function NavigatePanel({
  sites,
  atollNames,
  site,
  hidden = false,
  onPick,
  onChange,
  onDraw,
  onHeight,
}: {
  sites: readonly Site[];
  atollNames: Readonly<Record<string, string>>;
  /** The site the boat is heading for, or null while picking one. */
  site: NavSite | null;
  /** Kept running out of sight while the Map tab is open. */
  hidden?: boolean;
  onPick: (siteId: string) => void;
  /** Back to the destination list. */
  onChange: () => void;
  onDraw: (draw: NavDraw | null) => void;
  /** The panel's height in px as it changes (0 while hidden), so the map can frame the route above it on a phone. */
  onHeight: (px: number) => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const onHeightRef = useRef(onHeight);
  useEffect(() => {
    onHeightRef.current = onHeight;
  }, [onHeight]);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const report = () => onHeightRef.current(panel.getBoundingClientRect().height);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  return (
    <aside ref={panelRef} aria-label="Boat navigation" hidden={hidden} className={PANEL_CLASS}>
      <span aria-hidden="true" className={`mx-auto mb-1 block lg:hidden ${GRAB_HANDLE_CLASS}`} />
      {site ? (
        <BoatNav key={site.id} site={site} onDraw={onDraw} onChange={onChange} />
      ) : (
        <DestinationPicker sites={sites} atollNames={atollNames} onPick={onPick} />
      )}
    </aside>
  );
}

/** One position for sorting the list nearest first; the list works by name without it. */
function useOneFix(): LatLon | null {
  const [fix, setFix] = useState<LatLon | null>(null);
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    let active = true;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (active) setFix({ lat: position.coords.latitude, lon: position.coords.longitude });
      },
      () => {},
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 20_000 },
    );
    return () => {
      active = false;
    };
  }, []);
  return fix;
}

function DestinationPicker({
  sites,
  atollNames,
  onPick,
}: {
  sites: readonly Site[];
  atollNames: Readonly<Record<string, string>>;
  onPick: (siteId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const from = useOneFix();
  const named = useMemo(
    () => sites.map((site) => ({ id: site.id, name: site.name, lat: site.lat, lon: site.lon, atoll: atollNames[site.atollId] ?? null })),
    [sites, atollNames],
  );
  const { items: list, total } = destinationList(named, query, from);

  return (
    <section aria-labelledby="destination-heading">
      <h2 id="destination-heading" className="text-base font-semibold">
        Where to?
      </h2>
      <p className="text-xs leading-5 text-foam/70">
        {from ? "Nearest sites first, or tap the map to head for any point." : "Pick a dive site, or tap the map to head for any point."}
      </p>
      <label className="sr-only" htmlFor="destination-search">
        Search dive sites
      </label>
      <input
        id="destination-search"
        type="search"
        placeholder="Search sites or atolls"
        autoComplete="off"
        maxLength={80}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className={`${SEARCH_FIELD_CLASS} mt-2 w-full`}
      />
      <ul className="mt-2">
        {list.map((item) => (
          <li key={item.id} className="border-b border-foam/10 last:border-b-0">
            <button
              type="button"
              onClick={() => onPick(item.id)}
              className="flex min-h-11 w-full min-w-0 items-center gap-2 px-1 text-left text-sm hover:bg-foam/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-incoming"
            >
              <SiteName name={item.name} atoll={item.atoll} />
              {item.km != null ? <span className="shrink-0 tabular-nums text-xs text-foam/70">{formatNm(item.km)}</span> : null}
            </button>
          </li>
        ))}
      </ul>
      {list.length === 0 ? <p className="mt-2 text-sm text-foam/80">No sites match. Try fewer letters.</p> : null}
      {total > list.length ? (
        <p className="mt-2 text-xs text-foam/70">
          {list.length} of {total} sites shown. Search to find the rest.
        </p>
      ) : null}
    </section>
  );
}
