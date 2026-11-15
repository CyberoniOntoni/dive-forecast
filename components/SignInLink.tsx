"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { signInHref } from "@/lib/sign-in";

/**
 * The header's sign-in button: signing in comes back to the page it was pressed on, with its query (a plan's dive
 * time on a site page, a board on the scoreboard), not to the map.
 */
export function SignInLink({ className, children }: { className: string; children: ReactNode }) {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const here = pathname === "/login" ? "/" : `${pathname}${query ? `?${query}` : ""}`;
  return (
    <Link href={signInHref(here)} aria-label="Sign in" title="Sign in" className={className}>
      {children}
    </Link>
  );
}
