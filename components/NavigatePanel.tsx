"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { BoatNav, type NavDraw, type NavSite } from "@/components/BoatNav";
import { destinationList, formatNm } from "@/lib/boat-nav";
import type { LatLon } from "@/lib/geometry";
import { navigateHref, saveNavSite } from "@/lib/map-view";
import type { Site } from "@/lib/types";

/** Phone: docked under the map, at most a bit over half the screen. Wide window: the column the site list uses. */
const PANEL_CLASS =
  "absolute inset-x-0 bottom-0 z-[500] max-h-[60dvh] min-h-0 overflow-y-auto overscroll-contain rounded-t-3xl border border-foam/15 bg-glass px-4 pt-1.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-foam shadow-[0_-12px_32px_-12px_rgba(0,0,0,0.6)] backdrop-blur-md lg:pt-4 lg:static lg:inset-auto lg:z-auto lg:h-full lg:max-h-full lg:w-[22rem] lg:shrink-0 lg:rounded-none lg:border-y-0 lg:border-l-0 lg:shadow-none";

/**
 * The Navigate tab's state, from the address: the map with "?navigate", and "?navigate=<site id>" once a destination
 * is picked. The destination is kept for the browser tab, so the header's Navigate tab comes back to it.
 */
export function useNavigateTab(sites: readonly Site[]): {
  navigating: boolean;
  site: NavSite | null;
  pick: (siteId: string) => void;
  change: () => void;
} {
  const router = useRouter();
  const params = useSearchParams();
  const navigating = params.has("navigate");
  const siteId = params.get("navigate") || null;
  const site = useMemo<NavSite | null>(() => {
    if (!navigating) return null;
    const found = sites.find((item) => item.id === siteId);
    return found ? { id: found.id, name: found.name, lat: found.lat, lon: found.lon } : null;
  }, [sites, navigating, siteId]);

  useEffect(() => {
    if (site) saveNavSite(site.id);
  }, [site]);

  return {
    navigating,
    site,
    pick: (id) => router.replace(navigateHref(id)),
    change: () => {
      saveNavSite(null);
      router.replace(navigateHref(null));
    },
  };
}

/** The Navigate tab: pick a destination, then follow the boat to it. */
export function NavigatePanel({
  sites,
  atollNames,
  site,
  onPick,
  onChange,
  onDraw,
}: {
  sites: readonly Site[];
  atollNames: Readonly<Record<string, string>>;
  /** The site the boat is heading for, or null while picking one. */
  site: NavSite | null;
  onPick: (siteId: string) => void;
  /** Back to the destination list. */
  onChange: () => void;
  onDraw: (draw: NavDraw | null) => void;
}) {
  return (
    <aside aria-label="Boat navigation" className={PANEL_CLASS}>
      <span aria-hidden="true" className="mx-auto mb-1 block h-1 w-9 rounded-full bg-foam/30 lg:hidden" />
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
  const list = destinationList(named, query, from);

  return (
    <section aria-labelledby="destination-heading">
      <h2 id="destination-heading" className="text-base font-semibold">
        Where to?
      </h2>
      <p className="text-xs leading-5 text-foam/70">{from ? "Nearest sites first." : "Pick a dive site to head for."}</p>
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
        className="field mt-2 w-full min-w-0 placeholder:text-foam/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
      />
      <ul className="mt-2">
        {list.map((item) => (
          <li key={item.id} className="border-b border-foam/10 last:border-b-0">
            <button
              type="button"
              onClick={() => onPick(item.id)}
              className="flex min-h-11 w-full min-w-0 items-center gap-2 px-1 text-left text-sm hover:bg-foam/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-incoming"
            >
              <span className="min-w-0 flex-1 truncate font-medium">
                {item.name}
                {item.atoll ? <span className="font-normal text-foam/65"> · {item.atoll}</span> : null}
              </span>
              {item.km != null ? <span className="shrink-0 tabular-nums text-xs text-foam/70">{formatNm(item.km)}</span> : null}
            </button>
          </li>
        ))}
      </ul>
      {list.length === 0 ? <p className="mt-2 text-sm text-foam/80">No sites match. Try fewer letters.</p> : null}
    </section>
  );
}
