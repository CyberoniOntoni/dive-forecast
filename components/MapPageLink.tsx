"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import { showOnMapPage } from "@/lib/navigate-tab";

/**
 * A link to the map page: the Map or the Navigate tab. On the map page already, it only changes the address
 * (showOnMapPage). For the same reason it does not prefetch there: that ran the whole page on the server a second time
 * on every map visit.
 */
export function MapPageLink({ href, onClick, ...rest }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const pathname = usePathname();
  const onMapPage = pathname === "/";
  return (
    <Link
      href={href}
      prefetch={onMapPage ? false : undefined}
      onClick={(event) => {
        onClick?.(event);
        const plain = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
        if (!onMapPage || event.defaultPrevented || !plain) return;
        event.preventDefault();
        showOnMapPage(href);
      }}
      {...rest}
    />
  );
}
