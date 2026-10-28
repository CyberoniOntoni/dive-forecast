"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getBoatRoute, type BoatRoute } from "@/lib/actions";
import {
  alongRoute,
  etaMinutes,
  formatBearing,
  formatDuration,
  formatNm,
  keepFixes,
  motionFrom,
  REFERENCE_KNOTS,
  type Fix,
  type Motion,
} from "@/lib/boat-nav";
import { bearingDeg, distanceKm, type LatLon } from "@/lib/geometry";
import { currentWallTime, MALDIVES_TIME } from "@/lib/site-time";

/** What the map draws while navigating. */
export type NavDraw = {
  target: LatLon;
  boat: Fix | null;
  courseDeg: number | null;
  route: BoatRoute | null;
  /** Bumped to ask the map to frame the boat and the route. */
  frame: number;
};

export type NavSite = LatLon & { id: string; name: string };

/** Off the route by this much, the route is planned again from where the boat is. */
const REROUTE_OFF_KM = 0.3;
/** At most one new route this often, however far off the boat goes. */
const REROUTE_EVERY_MS = 20_000;

type GpsState = { status: "waiting" } | { status: "ok" } | { status: "error"; message: string };

function noSubscribe() {
  return () => {};
}

/** Why this browser cannot give a position at all, or null. */
function gpsUnsupported(): string | null {
  if (!("geolocation" in navigator)) return "This browser has no GPS access.";
  if (!window.isSecureContext) return "GPS needs the secure (https) address of this site.";
  return null;
}

function gpsMessage(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED) {
    return "Location is blocked for this site. Allow it in the browser's site settings, then try again.";
  }
  if (error.code === error.TIMEOUT) return "No GPS fix yet. Keep the phone where it can see the sky.";
  return "The phone could not get a position.";
}

/**
 * Boat navigation to one dive site: follows the phone's GPS, works out speed and course over ground, asks the server
 * for a route round the known reef, and shows distance left, speed and ETA. The map draws what `onDraw` hands it.
 */
export function BoatNav({ site, onDraw, onChange }: { site: NavSite; onDraw: (draw: NavDraw | null) => void; onChange: () => void }) {
  const [fixes, setFixes] = useState<Fix[]>([]);
  const [gps, setGps] = useState<GpsState>({ status: "waiting" });
  const [route, setRoute] = useState<BoatRoute | null>(null);
  const [routeError, setRouteError] = useState(false);
  const [frame, setFrame] = useState(0);
  const routing = useRef<{ busy: boolean; lastMs: number }>({ busy: false, lastMs: 0 });
  const onDrawRef = useRef(onDraw);

  useEffect(() => {
    onDrawRef.current = onDraw;
  }, [onDraw]);

  const unsupported = useSyncExternalStore(noSubscribe, gpsUnsupported, () => null);

  useEffect(() => {
    if (gpsUnsupported()) return;
    const watch = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy, speed, heading } = position.coords;
        const fix: Fix = {
          lat: latitude,
          lon: longitude,
          timeMs: position.timestamp,
          accuracyM: accuracy,
          speedMs: speed,
          headingDeg: heading,
        };
        setFixes((current) => keepFixes(current, fix));
        setGps({ status: "ok" });
      },
      (error) => setGps({ status: "error", message: gpsMessage(error) }),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, []);

  useScreenAwake();

  const boat = fixes[fixes.length - 1] ?? null;
  const motion: Motion | null = motionFrom(fixes);
  const along = boat && route ? alongRoute(boat, route.points) : null;

  // Plan the route on the first fix, and again when the boat has left it.
  useEffect(() => {
    if (!boat) return;
    const state = routing.current;
    const now = Date.now();
    const needed = route == null || (along != null && along.offKm > REROUTE_OFF_KM);
    // The pause holds after a failed request too, so a server error is not asked again on every fix.
    if (!needed || state.busy || now - state.lastMs < REROUTE_EVERY_MS) return;
    state.busy = true;
    state.lastMs = now;
    const first = route == null;
    getBoatRoute({ lat: boat.lat, lon: boat.lon }, site.id)
      .then((next) => {
        // An unknown site leaves any earlier route in place and says so.
        if (next) setRoute(next);
        setRouteError(next == null);
        if (first) setFrame((count) => count + 1);
      })
      .catch(() => setRouteError(true))
      .finally(() => {
        state.busy = false;
      });
  }, [boat, route, along, site.id]);

  useEffect(() => {
    onDrawRef.current({ target: site, boat, courseDeg: motion?.courseDeg ?? null, route, frame });
  }, [site, boat, motion?.courseDeg, route, frame]);

  useEffect(() => () => onDrawRef.current(null), []);

  const remainingKm = along?.remainingKm ?? (boat ? distanceKm(boat, site) : null);
  const steer = boat ? bearingDeg(boat, along?.next ?? site) : null;
  const eta = remainingKm != null && motion ? etaMinutes(remainingKm, motion.knots) : null;
  const shallow = route?.gaps.some((gap) => gap.shallow) ?? false;
  // Stopped only once the speed is known to be under way-making; until then the ETA waits.
  const stopped = motion != null && eta == null;

  return (
    <section aria-label={`Boat navigation to ${site.name}`} className="w-full text-foam">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wide text-foam/70">Boat to</p>
          <h2 className="truncate text-base font-semibold">{site.name}</h2>
        </div>
        {boat && route ? (
          <button
            type="button"
            onClick={() => setFrame((count) => count + 1)}
            className="min-h-11 rounded-xl border border-foam/25 px-3 text-sm font-medium hover:bg-foam/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
          >
            Show route
          </button>
        ) : null}
        <button
          type="button"
          onClick={onChange}
          aria-label="Change destination"
          className="min-h-11 shrink-0 rounded-xl border border-foam/25 px-3 text-sm font-medium hover:bg-foam/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
        >
          Change
        </button>
      </div>

      {unsupported || gps.status === "error" ? (
        <p role="alert" className="mt-2 text-sm text-stop">
          {unsupported ?? (gps.status === "error" ? gps.message : null)}
        </p>
      ) : !boat ? (
        <p className="mt-2 text-sm text-foam/80">Waiting for GPS…</p>
      ) : (
        <>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
            <Stat label={route?.routed ? "To go, by route" : "To go"} value={remainingKm != null ? formatNm(remainingKm) : "…"} />
            <Stat label="Speed" value={motion ? `${motion.knots.toFixed(1)} kn` : "…"} />
            <Stat
              label={eta != null ? `ETA ${arrivalClock(eta)}` : "ETA"}
              value={eta != null ? formatDuration(eta) : stopped ? "Stopped" : "…"}
            />
          </dl>
          <p className="mt-2 text-base text-foam/90">
            {steer != null ? <span className="font-semibold">Steer {formatBearing(steer)}</span> : null}
            {motion?.courseDeg != null ? <span className="text-foam/70"> · heading {formatBearing(motion.courseDeg)}</span> : null}
          </p>
          {stopped && remainingKm != null ? (
            <p className="text-sm text-foam/80">
              {REFERENCE_KNOTS.map((knots) => `at ${knots} kn about ${formatDuration(etaMinutes(remainingKm, knots) ?? 0)}`).join(", ")}
            </p>
          ) : null}
          <RouteNote route={route} routeError={routeError} shallow={shallow} />
          <p className="mt-1 text-xs text-foam/60">
            GPS ±{Math.round(boat.accuracyM)} m. Route from satellite reef outlines, not a nautical chart: keep a lookout.
          </p>
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-foam/70">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function RouteNote({ route, routeError, shallow }: { route: BoatRoute | null; routeError: boolean; shallow: boolean }) {
  if (routeError && route) {
    return <p className="mt-1 text-sm text-outgoing">Could not update the route; showing the last one.</p>;
  }
  if (routeError) return <p className="mt-1 text-sm text-outgoing">No route yet; the line is straight to the site. Trying again shortly.</p>;
  if (!route) return <p className="mt-1 text-sm text-foam/80">Planning the route…</p>;
  if (!route.routed) {
    return <p className="mt-1 text-sm text-outgoing">No way round the mapped reef found; the line is straight to the site.</p>;
  }
  const gaps = route.gaps.length;
  return (
    <>
      <p className="mt-1 text-sm text-foam/80">
        {formatNm(route.lengthKm)} by route ({formatNm(route.directKm)} straight)
        {gaps > 0 ? `, through ${gaps === 1 ? "1 reef gap" : `${gaps} reef gaps`}` : ""}.
      </p>
      {shallow ? (
        <p className="mt-1 text-sm text-outgoing">The route crosses a shallow reef-flat gap: check the depth before you go through.</p>
      ) : null}
    </>
  );
}

/** "14:35", Maldives time. */
function arrivalClock(minutes: number): string {
  return currentWallTime(MALDIVES_TIME, Date.now() + minutes * 60_000).slice(11, 16);
}

/** Keeps the phone's screen on while the panel is open, where the browser allows it. */
function useScreenAwake() {
  useEffect(() => {
    type WakeLock = { release: () => Promise<void> };
    const api = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLock> } }).wakeLock;
    if (!api) return;
    let lock: WakeLock | null = null;
    let active = true;
    const acquire = () => {
      if (document.visibilityState !== "visible") return;
      api
        .request("screen")
        .then((next) => {
          if (active) lock = next;
          else void next.release();
        })
        .catch(() => {});
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", acquire);
      void lock?.release().catch(() => {});
    };
  }, []);
}
