"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useState, useSyncExternalStore, type ReactNode } from "react";
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

/** The three points, also in the Android app's first-launch card (ui/components/ForecastIntro.kt): change both together. */
const POINTS: readonly { title: string; body: string; icon: ReactNode }[] = [
  {
    title: "What you see",
    body: "Which way the current runs (in or out of the atoll at channels, a compass direction on walls and in lagoons), how strong it is, and how sure the forecast is.",
    icon: <path d="M3 9c3-3 6 3 9 0s6 3 9 0M3 15c3-3 6 3 9 0s6 3 9 0" />,
  },
  {
    title: "Confidence",
    body: "High means the tide and ocean signals agree and no recent diver report says otherwise. Low means treat it as a rough guide. Fainter arrows are less sure.",
    icon: <path d="M5 20v-4M10 20v-8M15 20v-12M20 20V4" />,
  },
  {
    title: "Limits",
    body: "A model, not a measurement. Reef shape, weather and what divers find on the day can differ. Arrows are the current underwater; the Sheltered water layer is the waves on top.",
    icon: <path d="M12 4l9 16H3zM12 10v4M12 17h.01" />,
  },
];

/**
 * A first-visit introduction above the map: what 50Bar forecasts, how to read confidence, and its limits. Returning
 * divers keep the map-first page: one tap closes it for good in this browser. On a phone it starts as the headline and
 * one line, with the three points a tap away, so the map keeps most of the screen.
 */
export function ForecastIntro() {
  const pathname = usePathname();
  const params = useSearchParams();
  const open = useSyncExternalStore(subscribe, openInBrowser, closedOnServer);
  const [more, setMore] = useState(false);
  if (!open || pathname !== "/" || readNavigate(params).navigating) return null;

  return (
    <aside aria-labelledby="forecast-intro-title" className="chart-bar shrink-0 border-b py-3 print:hidden">
      <div className="mx-auto flex max-w-5xl flex-col gap-2">
        <div className="flex items-start gap-2.5">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className="mt-0.5 shrink-0 text-incoming" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8h.01" />
          </svg>
          <div className="min-w-0 flex-1">
            <h2 id="forecast-intro-title" className="text-base font-semibold text-foam sm:text-lg">
              Understand the forecast
            </h2>
            <p className="text-sm leading-5 text-foam/85">
              50Bar forecasts the current at Maldives dive sites, hour by hour for the week ahead, from tide and ocean models and
              divers&rsquo; reports, to help you pick safer entries and better timing.
            </p>
          </div>
        </div>
        <ul id="forecast-intro-points" className={`${more ? "grid" : "hidden"} gap-2 sm:grid sm:grid-cols-3 sm:gap-4`}>
          {POINTS.map((point) => (
            <li key={point.title} className="flex min-w-0 gap-2.5">
              <span className="mt-0.5 hidden size-8 shrink-0 place-items-center rounded-lg bg-incoming/15 text-incoming sm:grid">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {point.icon}
                </svg>
              </span>
              <p className="min-w-0 text-xs leading-5 text-foam/80 sm:text-sm">
                <strong className="font-semibold text-foam">{point.title}.</strong> {point.body}
              </p>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="min-w-0 flex-1 basis-56 text-xs leading-5 text-foam/80 italic sm:text-sm">
            Always check with your dive guide or a local operator, and the water itself, before you dive.
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setMore((shown) => !shown)}
              aria-expanded={more}
              aria-controls="forecast-intro-points"
              className="button-quiet px-3 sm:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
            >
              {more ? "Less" : "How to read it"}
            </button>
            <button
              type="button"
              onClick={close}
              className="min-h-11 rounded-xl bg-incoming px-5 text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foam"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
