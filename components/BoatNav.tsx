"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getBoatRoute, type BoatTrip } from "@/lib/actions";
import {
  alongRoute,
  etaMinutes,
  formatBearing,
  formatDuration,
  formatNm,
  keepFixes,
  motionFrom,
  REFERENCE_KNOTS,
  UNDERWAY_KNOTS,
  type Fix,
  type Motion,
} from "@/lib/boat-nav";
import { bearingDeg, distanceKm, type LatLon } from "@/lib/geometry";
import { compassWord } from "@/lib/nowcast-glance";
import {
  crab,
  currentAt,
  currentHeading,
  currentKnots,
  routeTime,
  waterKnots,
  type CurrentHere,
  type StrongPass,
} from "@/lib/route-current";
import { currentWallTime, MALDIVES_TIME } from "@/lib/site-time";

/** What the map draws while navigating. */
export type NavDraw = {
  target: LatLon;
  boat: Fix | null;
  courseDeg: number | null;
  route: BoatTrip | null;
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
  const [route, setRoute] = useState<BoatTrip | null>(null);
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
  // How far along the route the boat is, and the forecast current there now.
  const routeKm = route && along ? Math.max(0, route.lengthKm - along.remainingKm) : 0;
  const here = boat && route?.current ? currentAt(route.current, routeKm, boat.timeMs) : null;
  const stopped = motion != null && motion.knots < UNDERWAY_KNOTS;
  const water = motion && !stopped ? waterKnots(motion.knots, motion.courseDeg, here?.current ?? null) : null;
  const track = boat ? bearingDeg(boat, along?.next ?? site) : null;
  // The heading that holds the track against the current under the boat.
  const crabbed = track != null && here && water != null ? crab(track, water, here.current) : null;
  const steer = crabbed?.headingDeg ?? track;
  // The time over the rest of the route, each stretch with the current it has when the boat gets there.
  const timeAt = (knots: number) =>
    boat && route && along ? routeTime(route.points, routeKm, route.current, knots, boat.timeMs) : null;
  const timed = water != null ? timeAt(water) : null;
  const eta = water == null || remainingKm == null ? null : timed ? timed.minutes : etaMinutes(remainingKm, water);
  // Under way but the current ahead is more than the boat makes through the water.
  const outrun = water != null && timed != null && timed.minutes == null;
  const shallow = route?.gaps.some((gap) => gap.shallow) ?? false;

  return (
    <section aria-label={`Boat navigation to ${site.name}`} className="w-full text-foam">
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
          <span className="sr-only">Heading to </span>
          {site.name}
        </h2>
        {boat && route ? (
          <button type="button" onClick={() => setFrame((count) => count + 1)} aria-label="Show the whole route" title="Show route" className={ICON_BUTTON}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
              <path d="M8 15c2-1 3-5 5-6s3 1 3 1" />
            </svg>
          </button>
        ) : null}
        <button type="button" onClick={onChange} aria-label="Change destination" title="Change destination" className={ICON_BUTTON}>
          {/* A list, not an X: this goes back to the destinations; the Map tab ends navigating. */}
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
          </svg>
        </button>
      </div>

      {unsupported || gps.status === "error" ? (
        <p role="alert" className="mt-2 rounded-xl bg-stop/15 px-3 py-2 text-sm text-stop">
          {unsupported ?? (gps.status === "error" ? gps.message : null)}
        </p>
      ) : !boat ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-foam/80">
          <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-incoming" />
          Waiting for GPS…
        </p>
      ) : (
        <>
          {/* One row: steer, distance left, speed, arrival. */}
          <dl className="mt-1.5 flex items-center gap-3">
            <SteerDial steer={steer} />
            <Stat
              big
              label={route?.routed ? "To go, by route" : "To go"}
              value={remainingKm != null ? formatNm(remainingKm) : null}
            />
            <Stat label="Speed" value={motion ? `${motion.knots.toFixed(1)} kn` : null} />
            <Stat
              label={eta != null ? `In ${formatDuration(eta)}` : "Arrive"}
              value={eta != null ? arrivalClock(eta) : stopped ? "Stopped" : outrun ? "Current" : null}
            />
          </dl>
          {stopped && remainingKm != null ? (
            <p className="mt-1 text-xs text-foam/75">
              {REFERENCE_KNOTS.map((knots) => referenceTime(knots, timeAt(knots)?.minutes ?? etaMinutes(remainingKm, knots))).join(", ")}
            </p>
          ) : null}
          <RouteNote
            route={route}
            routeError={routeError}
            shallow={shallow}
            steer={steer}
            track={crabbed ? track : null}
            here={here}
            outrun={outrun}
            veryStrong={(timed ?? (stopped ? timeAt(REFERENCE_KNOTS[0]) : null))?.veryStrong ?? []}
            courseDeg={motion?.courseDeg ?? null}
            accuracyM={boat.accuracyM}
          />
        </>
      )}
    </section>
  );
}

const ICON_BUTTON =
  "grid size-11 shrink-0 place-items-center rounded-full bg-foam/10 text-foam ring-1 ring-foam/15 hover:bg-foam/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming";

/** Which way to steer, as an arrow on a small compass rose (north up). */
function SteerDial({ steer }: { steer: number | null }) {
  return (
    <div className="relative grid size-12 shrink-0 place-items-center rounded-full bg-foam/5 ring-1 ring-foam/15">
      <span aria-hidden="true" className="absolute top-px left-1/2 -translate-x-1/2 text-[8px] font-semibold text-foam/60">
        N
      </span>
      {steer != null ? (
        <svg
          viewBox="0 0 24 24"
          width="24"
          height="24"
          role="img"
          aria-label={`Steer ${formatBearing(steer)}`}
          className="text-incoming"
          style={{ transform: `rotate(${steer}deg)` }}
        >
          {/* A shafted arrow, so which end is the point reads at a glance. */}
          <path d="M12 21V4M5.5 10.5L12 4l6.5 6.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </div>
  );
}

/** One readout; a dash until it is known. The distance is the big one. */
function Stat({ label, value, big = false }: { label: string; value: string | null; big?: boolean }) {
  return (
    <div className={`min-w-0 ${big ? "flex-[1.4]" : "flex-1"}`}>
      <dt className="truncate text-[11px] text-foam/60">{label}</dt>
      <dd className={`truncate font-semibold leading-tight tabular-nums ${big ? "text-2xl" : "text-lg"} ${value ? "" : "text-foam/40"}`}>
        {value ?? "—"}
      </dd>
    </div>
  );
}

/** "At 8 kn about 25 min", or that the current is too much at that speed. */
function referenceTime(knots: number, minutes: number | null): string {
  return minutes == null ? `At ${knots} kn the current is against you` : `At ${knots} kn about ${formatDuration(minutes)}`;
}

/** Below this the current is not worth a word. */
const CURRENT_NOTE_KNOTS = 0.2;

/**
 * One small line under the readouts: steer, the current here, the route's gaps, GPS accuracy and the not-a-chart
 * warning. Route trouble, a shallow gap, very strong current ahead and a current the boat cannot beat get their own
 * line in amber.
 */
function RouteNote({
  route,
  routeError,
  shallow,
  steer,
  track,
  here,
  outrun,
  veryStrong,
  courseDeg,
  accuracyM,
}: {
  route: BoatTrip | null;
  routeError: boolean;
  shallow: boolean;
  /** The heading to steer, allowing for the current when it is known. */
  steer: number | null;
  /** The track over the ground, when the steer allows for current; null otherwise. */
  track: number | null;
  here: CurrentHere | null;
  outrun: boolean;
  veryStrong: readonly StrongPass[];
  /** Course over ground, to compare with the steer bearing. */
  courseDeg: number | null;
  accuracyM: number;
}) {
  const gaps = route?.routed ? route.gaps.length : 0;
  const knots = here ? currentKnots(here.current) : 0;
  const allows = steer != null && track != null && Math.abs(((steer - track + 540) % 360) - 180) >= 2;
  const parts = [
    steer != null ? `Steer ${formatBearing(steer)}${allows && track != null ? ` for track ${formatBearing(track)}` : ""}` : null,
    here && knots >= CURRENT_NOTE_KNOTS
      ? `current ${knots.toFixed(1)} kn toward ${compassWord(currentHeading(here.current))}${here.source.siteId ? ` (${here.source.name})` : ""}`
      : null,
    courseDeg != null ? `course ${formatBearing(courseDeg)}` : null,
    route?.routed ? `${formatNm(route.lengthKm)} by route (${formatNm(route.directKm)} straight)` : null,
    gaps > 0 ? (gaps === 1 ? "1 reef gap" : `${gaps} reef gaps`) : null,
    `GPS ±${Math.round(accuracyM)} m`,
    "not a chart, keep a lookout",
  ].filter((part): part is string => part != null);
  const trouble =
    routeError && route
      ? "Could not update the route; showing the last one."
      : routeError
        ? "No route yet; the line is straight to the site. Trying again shortly."
        : route && !route.routed
          ? "No way round the mapped reef found; the line is straight to the site."
          : null;
  return (
    <>
      <p className="mt-1.5 text-xs leading-4 text-foam/65">
        {!route && !routeError ? "Planning the route… · " : null}
        {parts.join(" · ")}
      </p>
      {trouble ? <p className="mt-1 text-xs text-outgoing">{trouble}</p> : null}
      {outrun ? (
        <p className="mt-1 text-xs text-outgoing">At this speed the current ahead is stronger than the boat makes through the water.</p>
      ) : null}
      {veryStrong.length > 0 ? (
        <p className="mt-1 text-xs text-outgoing">
          Very strong current forecast at {veryStrong.map((pass) => `${pass.name} around ${clock(pass.timeMs)}`).join(", ")}.
        </p>
      ) : null}
      {shallow ? (
        <p className="mt-1 text-xs text-outgoing">The route crosses a shallow reef-flat gap: check the depth before you go through.</p>
      ) : null}
    </>
  );
}

/** "14:35", Maldives time. */
function arrivalClock(minutes: number): string {
  return clock(Date.now() + minutes * 60_000);
}

function clock(timeMs: number): string {
  return currentWallTime(MALDIVES_TIME, timeMs).slice(11, 16);
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
