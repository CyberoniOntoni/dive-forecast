"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useSyncExternalStore } from "react";
import { NavigateIcon } from "@/components/site-ui";
import { loadNavSite, NAV_SITE_EVENT, navigateHref, readNavigate } from "@/lib/navigate-tab";

function onNavSite(changed: () => void): () => void {
  window.addEventListener(NAV_SITE_EVENT, changed);
  return () => window.removeEventListener(NAV_SITE_EVENT, changed);
}

function noSiteOnServer(): string | null {
  return null;
}

const TAB_CLASS =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming";
const ON = "bg-foam text-ink shadow-sm";
const OFF = "text-foam/80 hover:text-foam";

/**
 * Map and Navigate, in the header. Navigate is the boat view on the same map; it comes back to the site it last
 * headed for in this tab, else it opens the destination list.
 */
export function AppTabs() {
  const pathname = usePathname();
  const params = useSearchParams();
  const here = readNavigate(params);
  const navigating = pathname === "/" && here.navigating;
  const lastSite = useSyncExternalStore(onNavSite, loadNavSite, noSiteOnServer);

  return (
    <nav aria-label="Views" className="flex shrink-0 gap-0.5 rounded-full bg-foam/10 p-0.5 ring-1 ring-foam/15">
      <Link
        data-tab
        href="/"
        aria-current={!navigating && pathname === "/" ? "page" : undefined}
        className={`${TAB_CLASS} ${navigating || pathname !== "/" ? OFF : ON}`}
      >
        Map
      </Link>
      <Link
        data-tab
        href={navigateHref(navigating ? here.siteId : lastSite)}
        aria-current={navigating ? "page" : undefined}
        className={`${TAB_CLASS} ${navigating ? ON : OFF}`}
      >
        <NavigateIcon size={16} />
        Navigate
      </Link>
    </nav>
  );
}
