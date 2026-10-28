"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useSyncExternalStore } from "react";
import { loadNavSite, NAV_SITE_EVENT, navigateHref } from "@/lib/map-view";

function onNavSite(changed: () => void): () => void {
  window.addEventListener(NAV_SITE_EVENT, changed);
  return () => window.removeEventListener(NAV_SITE_EVENT, changed);
}

function noSiteOnServer(): string | null {
  return null;
}

const TAB_CLASS =
  "inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming";

/**
 * Map and Navigate, in the header. Navigate is the boat view on the same map; it comes back to the site it last
 * headed for in this tab, else it opens the destination list.
 */
export function AppTabs() {
  const pathname = usePathname();
  const params = useSearchParams();
  const navigating = pathname === "/" && params.has("navigate");
  const lastSite = useSyncExternalStore(onNavSite, loadNavSite, noSiteOnServer);

  return (
    <nav aria-label="Views" className="flex shrink-0 gap-1">
      <Link
        data-tab
        href="/"
        aria-current={!navigating && pathname === "/" ? "page" : undefined}
        className={`${TAB_CLASS} ${navigating || pathname !== "/" ? "text-foam/80 hover:bg-foam/10" : "bg-foam/15 text-foam"}`}
      >
        Map
      </Link>
      <Link
        data-tab
        href={navigateHref(navigating ? (params.get("navigate") || null) : lastSite)}
        aria-current={navigating ? "page" : undefined}
        className={`${TAB_CLASS} ${navigating ? "bg-foam/15 text-foam" : "text-foam/80 hover:bg-foam/10"}`}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
          <path d="M12 2l7 19-7-4-7 4z" />
        </svg>
        Navigate
      </Link>
    </nav>
  );
}
