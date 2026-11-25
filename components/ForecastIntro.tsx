"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { readNavigate } from "@/lib/navigate-tab";

/** localStorage key: once closed, the introduction stays closed in this browser. Named on /privacy (On your device). */
const DISMISSED_KEY = "forecast-intro-closed";
const CHANGED_EVENT = "forecast-intro-changed";

function subscribe(changed: () => void): () => void {
  window.addEventListener(CHANGED_EVENT, changed);
  window.addEventListener("storage", changed);
  return () => {
    window.removeEventListener(CHANGED_EVENT, changed);
    window.removeEventListener("storage", changed);
  };
}

let closedHere = false;

function openInBrowser(): boolean {
  if (closedHere) return false;
  try {
    return !window.localStorage.getItem(DISMISSED_KEY);
  } catch {
    // Storage blocked: show it; closing then lasts for this page only.
    return true;
  }
}

/** Nothing on the server, so a returning diver never sees it flash in. */
function closedOnServer(): boolean {
  return false;
}

function close() {
  closedHere = true;
  try {
    window.localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Storage blocked: closedHere hides it until the page reloads.
  }
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

/** The three points, also in the Android app's first-launch card (ui/components/SafetyCopy.kt): change both together. */
const POINTS: readonly { title: string; body: string; icon: ReactNode }[] = [
  {
    title: "Direction and strength",
    body: "Which way the current runs at each site, and how hard, hour by hour for the week.",
    icon: <path d="M3 8c3-2.5 6 2.5 9 0s6 2.5 9 0M3 13c3-2.5 6 2.5 9 0s6 2.5 9 0M3 18c3-2.5 6 2.5 9 0s6 2.5 9 0" />,
  },
  {
    title: "Confidence",
    body: "High when the signals agree and no recent diver report disagrees. Low is a rough guide. Fainter arrows are less sure.",
    icon: <path d="M5 20v-3M10 20v-7M15 20V9M20 20V4" />,
  },
  {
    title: "Limits",
    body: "A model, not a measurement. Arrows show the current underwater; the Sheltered water layer shows waves on top.",
    icon: <path d="M12 3.5l9.5 16.5h-19zM12 10v4.5M12 17.5h.01" />,
  },
];

/**
 * A first-visit welcome card over the map: what 50Bar forecasts, how to read confidence, and its limits. It floats over
 * the map instead of pushing it down, so the page underneath stays the map-first one returning divers know; "Got it",
 * Escape or a tap outside closes it for good in this browser.
 */
export function ForecastIntro() {
  const pathname = usePathname();
  const params = useSearchParams();
  const open = useSyncExternalStore(subscribe, openInBrowser, closedOnServer);
  const shown = open && pathname === "/" && !readNavigate(params).navigating;
  const card = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!shown) return;
    // The card, not the button, takes focus: a screen reader starts at the title, and no focus ring shows on a tap.
    card.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown]);

  if (!shown) return null;

  return (
    <div className="fixed inset-0 z-[2000] flex items-end justify-center p-3 sm:items-center sm:p-6 print:hidden">
      {/* The scrim only softens the map; a tap on it closes the card like "Got it". */}
      <button type="button" aria-label="Close the introduction" tabIndex={-1} onClick={close} className="intro-scrim absolute inset-0 cursor-default bg-ink/45 backdrop-blur-[2px]" />
      <section
        ref={card}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="forecast-intro-title"
        aria-describedby="forecast-intro-lead"
        className="intro-card relative w-full outline-none max-w-lg overflow-hidden rounded-3xl text-foam ring-1 ring-foam/15 shadow-[0_24px_64px_-16px_rgba(0,0,0,0.75)]"
      >
        {/* A tide line across the top: the brand's water, not a stock banner. */}
        <svg aria-hidden="true" viewBox="0 0 400 60" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 top-0 h-9 w-full text-incoming">
          <path d="M0 38c40-14 80-14 120 0s80 14 120 0 80-14 120 0 40 7 40 7" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" />
          <path d="M0 48c40-12 80-12 120 0s80 12 120 0 80-12 120 0 40 6 40 6" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1.5" />
        </svg>
        <div className="relative px-5 pt-10 pb-5 sm:px-7 sm:pt-11 sm:pb-6">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-incoming uppercase">Welcome to 50Bar</p>
          <h2 id="forecast-intro-title" className="mt-1 text-2xl font-semibold tracking-tight sm:text-[1.7rem]">
            Understand the forecast
          </h2>
          <p id="forecast-intro-lead" className="mt-1.5 text-sm leading-5 text-foam/80">
            Current forecasts for Maldives dive sites, from tide and ocean models and divers&rsquo; reports, to help you plan
            safer entries and better timing.
          </p>
          <ul className="mt-4 divide-y divide-foam/10 border-y border-foam/10">
            {POINTS.map((point) => (
              <li key={point.title} className="flex gap-3.5 py-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-incoming/12 text-incoming ring-1 ring-incoming/25">
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {point.icon}
                  </svg>
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{point.title}</h3>
                  <p className="text-[13px] leading-5 text-foam/75">{point.body}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <p className="flex min-w-0 flex-1 items-start gap-2 text-[13px] leading-5 text-foam/80">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className="mt-0.5 shrink-0 text-outgoing" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
              Always check with your dive guide or a local operator before you dive.
            </p>
            <button
              type="button"
              onClick={close}
              className="min-h-12 shrink-0 rounded-full bg-incoming px-7 text-sm font-semibold text-ink shadow-[0_8px_24px_-8px_var(--incoming)] transition-transform hover:brightness-110 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foam"
            >
              Got it
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
