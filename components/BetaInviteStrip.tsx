"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

/** localStorage key: once closed, the strip stays closed in this browser. /android stays reachable from /account. */
const DISMISSED_KEY = "android-beta-invite-closed";
const CHANGED_EVENT = "android-beta-invite-changed";

type View = "hidden" | "android" | "ios";

function subscribe(changed: () => void): () => void {
  window.addEventListener(CHANGED_EVENT, changed);
  window.addEventListener("storage", changed);
  return () => {
    window.removeEventListener(CHANGED_EVENT, changed);
    window.removeEventListener("storage", changed);
  };
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; a touch screen gives it away.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function viewInBrowser(): View {
  try {
    if (window.localStorage.getItem(DISMISSED_KEY)) return "hidden";
  } catch {
    // Storage blocked: show it; closing then lasts for this page only.
  }
  return isIos() ? "ios" : "android";
}

/** Nothing on the server, so a diver who closed it never sees it flash in. */
function viewOnServer(): View {
  return "hidden";
}

let closedHere = false;

function close() {
  closedHere = true;
  try {
    window.localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Storage blocked: closedHere hides it until the page reloads.
  }
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

/**
 * One thin line under the header inviting visitors to the Android closed test, with the iPhone app as coming soon. It
 * costs the map a line on a phone, so it closes for good with one tap.
 */
export function BetaInviteStrip() {
  const pathname = usePathname();
  const view = useSyncExternalStore(subscribe, () => (closedHere ? "hidden" : viewInBrowser()), viewOnServer);
  if (view === "hidden" || pathname === "/android") return null;

  const link =
    "font-medium text-incoming underline decoration-incoming/50 underline-offset-2 hover:decoration-incoming focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming rounded-sm";
  return (
    <aside
      aria-label="50Bar app beta"
      className="chart-bar flex min-h-10 shrink-0 items-center gap-2 border-b py-0 pr-1 text-sm print:hidden"
    >
      <PhoneIcon />
      <p className="m-0 min-w-0 flex-1 truncate">
        {/* A phone has room for about 36 characters beside the close button, so the short words go there. */}
        {view === "ios" ? (
          <>
            <span className="text-foam">
              <span className="sm:hidden">iPhone app coming soon.</span>
              <span className="max-sm:hidden">The 50Bar iPhone app is coming soon.</span>
            </span>{" "}
            <Link href="/android" className={link}>
              <span className="sm:hidden">Android beta</span>
              <span className="max-sm:hidden">On Android? Join the beta</span>
            </Link>
          </>
        ) : (
          <>
            <span className="text-foam">
              <span className="sm:hidden">50Bar Android beta is open.</span>
              <span className="max-sm:hidden">The 50Bar Android app is in beta.</span>
            </span>{" "}
            <Link href="/android" className={link}>
              <span className="sm:hidden">Join</span>
              <span className="max-sm:hidden">Join the test</span>
            </Link>
            <span className="text-foam/65 max-sm:hidden"> · iPhone app coming soon</span>
          </>
        )}
      </p>
      <button
        type="button"
        onClick={close}
        aria-label="Close the app beta invitation"
        title="Close"
        className="grid size-10 shrink-0 place-items-center rounded-full text-foam/70 hover:text-foam focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-incoming"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </aside>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" className="shrink-0 text-incoming" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
      <path d="M10.5 18.5h3" />
    </svg>
  );
}
