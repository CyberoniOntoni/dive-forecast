"use client";

import { useActionState, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { compassWord, routeDirectionLegend } from "@/lib/nowcast-glance";
import { addReportAction, type ReportActionState } from "@/lib/actions";
import { MALDIVES_TIME, viewerClock, zoneLabel, type SiteTimeZone } from "@/lib/site-time";
import type { ForecastRoute } from "@/lib/types";

const CHOICE =
  "flex min-h-11 items-center gap-2 rounded-md border border-foam/20 px-3 text-base text-foam has-[:checked]:bg-foam/10 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-incoming";

const INITIAL: ReportActionState = { success: false, error: null };

/** The viewer's own UTC offset, minutes. The server has no viewer, so it renders no conversion line. */
function viewerOffset(): number {
  return -new Date().getTimezoneOffset();
}

function noSubscription(): () => void {
  return () => {};
}

function noViewerOnServer(): number | null {
  return null;
}

/**
 * On every route but "channel" (a wall or lagoon site) the two choices are the compass points the axis runs to, stored with the forecast's fixed meaning:
 * "incoming" toward the heading, "outgoing" the opposite way.
 *
 * The time is always the dive site's own country's time (`zone`), never the diver's: it starts on the site's current
 * hour, and a diver on another clock sees what that time is for them.
 */
export function ReportForm({
  siteId,
  forecastRoute = "channel",
  alongHeadingDeg = null,
  zone = MALDIVES_TIME,
  defaultTime,
}: {
  siteId: string;
  forecastRoute?: ForecastRoute;
  alongHeadingDeg?: number | null;
  zone?: SiteTimeZone;
  /** The site's current hour, "YYYY-MM-DDTHH:00", so most reports need no typing. */
  defaultTime?: string;
}) {
  const along =
    forecastRoute === "channel" || alongHeadingDeg == null
      ? null
      : [compassWord(alongHeadingDeg), compassWord(alongHeadingDeg + 180)];
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [time, setTime] = useState(defaultTime ?? "");
  // After a save the button stays off until something changes, so one dive is not filed twice.
  const [saved, setSaved] = useState(false);
  const viewer = useSyncExternalStore(noSubscription, viewerOffset, noViewerOnServer);
  const theirs = viewer == null || !time ? null : viewerClock(time, zone, viewer);
  const [state, formAction, pending] = useActionState(
    async (_prev: ReportActionState, formData: FormData) => {
      const next = await addReportAction(siteId, formData);
      if (next.success) {
        setSaved(true);
        formRef.current?.reset();
        setTime(defaultTime ?? "");
        // The new report joins the list on the page, and the hours above take its pull.
        router.refresh();
      }
      return next;
    },
    INITIAL,
  );

  return (
    <section
      className="flex min-w-0 flex-col gap-3 rounded-2xl border border-foam/15 bg-glass p-4 sm:p-5"
      aria-labelledby="report-heading"
    >
      <h2 id="report-heading" className="text-base font-semibold text-foam">
        Report the current
      </h2>
      <p className="text-sm leading-6 text-foam/80">
        Enter the time at the dive site, in {zoneLabel(zone)}, wherever you are now. Saving a report updates the hours
        above.
      </p>
      <form
        ref={formRef}
        action={formAction}
        onChange={() => setSaved(false)}
        className="flex min-w-0 flex-col gap-4"
      >
        <label className="flex min-w-0 flex-col gap-1 text-sm text-foam" htmlFor="report-time">
          Time in the water, {zoneLabel(zone)}
          <input
            id="report-time"
            name="time"
            type="datetime-local"
            required
            defaultValue={defaultTime}
            onInput={(event) => setTime(event.currentTarget.value)}
            className="min-h-11 w-full min-w-0 rounded-md border border-foam/20 bg-ink px-3 text-base text-foam focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
          />
        </label>
        {theirs ? (
          <p className="-mt-2 text-xs leading-5 text-foam/75">
            {time.slice(11, 16)} in the {zone.place} is {theirs.clock}
            {theirs.dayShift > 0 ? " the next day" : theirs.dayShift < 0 ? " the day before" : ""} where you are (
            {theirs.offset}).
          </p>
        ) : null}
        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="text-sm font-medium text-foam">
            {routeDirectionLegend(forecastRoute, alongHeadingDeg)}
          </legend>
          <div className="grid grid-cols-2 gap-2">
            <label className={`${CHOICE} has-[:checked]:border-incoming has-[:checked]:text-incoming`}>
              <input type="radio" name="direction" value="incoming" required className="size-5 accent-incoming" />
              {along ? `Running ${along[0]}` : "Incoming"}
            </label>
            <label className={`${CHOICE} has-[:checked]:border-outgoing has-[:checked]:text-outgoing`}>
              <input type="radio" name="direction" value="outgoing" required className="size-5 accent-outgoing" />
              {along ? `Running ${along[1]}` : "Outgoing"}
            </label>
          </div>
        </fieldset>
        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="text-sm font-medium text-foam">Slack, mild, strong, or very strong</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className={`${CHOICE} has-[:checked]:border-foam`}>
              <input type="radio" name="strength" value="slack" required className="size-5" />
              Slack
            </label>
            <label className={`${CHOICE} has-[:checked]:border-foam`}>
              <input type="radio" name="strength" value="mild" required className="size-5" />
              Mild
            </label>
            <label className={`${CHOICE} has-[:checked]:border-foam`}>
              <input type="radio" name="strength" value="strong" required className="size-5" />
              Strong
            </label>
            <label className={`${CHOICE} has-[:checked]:border-foam`}>
              <input type="radio" name="strength" value="too_strong" required className="size-5" />
              Very strong
            </label>
          </div>
        </fieldset>
        {state.error ? (
          <p role="alert" className="text-sm text-outgoing">
            {state.error}
          </p>
        ) : null}
        {state.success && saved ? (
          <p role="status" className="text-sm text-foam">
            Report added.
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending || saved}
          className="min-h-11 w-full rounded-md bg-foam px-4 text-base font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming disabled:opacity-50 sm:w-auto"
        >
          {pending ? "Adding…" : "Add report"}
        </button>
      </form>
    </section>
  );
}
