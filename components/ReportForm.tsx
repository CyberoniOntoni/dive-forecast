"use client";

import { useActionState, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { compassWord, onCompass, routeDirectionLegend } from "@/lib/nowcast-glance";
import { addReportAction, type ReportActionState } from "@/lib/actions";
import { POINTS, type AwardReason, type ReportAward } from "@/lib/points-rules";
import { signInHref } from "@/lib/sign-in";
import { MALDIVES_TIME, viewerClock, wallHoursBefore, zoneLabel, type SiteTimeZone } from "@/lib/site-time";
import type { ForecastRoute } from "@/lib/types";

const CHOICE =
  "flex min-h-11 items-center gap-2 rounded-xl border border-foam/20 px-3 text-base text-foam has-[:checked]:bg-foam/10 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-incoming";

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

/** The quick time choices, hours before the site's current hour. "other" opens the full date and time field. */
const QUICK_HOURS = [0, 1, 2, 3] as const;
type TimeChoice = (typeof QUICK_HOURS)[number] | "other";

function quickLabel(hours: number): string {
  return hours === 0 ? "This hour" : `${hours} h ago`;
}

const REASON_WORDS: Record<AwardReason, string> = {
  report: "report",
  fresh: "filed soon after the dive",
  pathfinder: "first report here in a month",
};

/** "+25 points: report 10, filed soon after the dive 5, first report here in a month 10". */
function awardLine(award: ReportAward): string {
  if (award.points === 0) {
    return award.uncounted === "same-dive"
      ? "No points: you already reported this dive."
      : "No points: today's reports already count in full.";
  }
  const parts = award.reasons.map((reason) => `${REASON_WORDS[reason]} ${POINTS[reason]}`);
  return `+${award.points} points: ${parts.join(", ")}.`;
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
  forecastRoute,
  alongHeadingDeg = null,
  zone = MALDIVES_TIME,
  defaultTime,
  nickname,
}: {
  siteId: string;
  /** The signed-in diver; null shows a sign-in button instead of the form. */
  nickname: string | null;
  forecastRoute: ForecastRoute;
  alongHeadingDeg?: number | null;
  zone?: SiteTimeZone;
  /** The site's current hour, "YYYY-MM-DDTHH:00", so most reports need no typing. */
  defaultTime?: string;
}) {
  const along = onCompass(forecastRoute, alongHeadingDeg)
    ? [compassWord(alongHeadingDeg), compassWord(alongHeadingDeg + 180)]
    : null;
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [choice, setChoice] = useState<TimeChoice>(0);
  const [otherTime, setOtherTime] = useState(defaultTime ?? "");
  const time = choice === "other" ? otherTime : defaultTime ? (wallHoursBefore(defaultTime, choice) ?? "") : "";
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
        setChoice(0);
        setOtherTime(defaultTime ?? "");
        // The new report joins the list on the page, and the hours above take its pull.
        router.refresh();
      }
      return next;
    },
    INITIAL,
  );

  const heading = (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <h2 id="report-heading" className="text-base font-semibold text-foam">
        Report the current
      </h2>
      <Link href="/leaderboard" className="text-sm text-foam/80 underline decoration-incoming underline-offset-4">
        Leaderboard
      </Link>
    </div>
  );

  if (!nickname) {
    return (
      <section id="report" className="flex min-w-0 scroll-mt-4 flex-col gap-3 surface p-4 sm:p-5" aria-labelledby="report-heading">
        {heading}
        <p className="text-sm leading-6 text-foam/80">
          Sign in with your email to report what the current did on your dive. Reports sharpen the forecast for
          everyone, and earn points on the leaderboard.
        </p>
        <Link
          href={signInHref(`/sites/${siteId}#report`)}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-foam px-4 text-base font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming sm:w-auto sm:self-start"
        >
          Sign in to report
        </Link>
      </section>
    );
  }

  return (
    <section
      id="report"
      className="flex min-w-0 scroll-mt-4 flex-col gap-3 surface p-4 sm:p-5"
      aria-labelledby="report-heading"
    >
      {heading}
      <p className="text-sm leading-6 text-foam/80">
        Three taps: when, which way, how strong. Times are {zoneLabel(zone)}. Reporting as {nickname}.
      </p>
      <form
        ref={formRef}
        action={formAction}
        onChange={() => setSaved(false)}
        className="flex min-w-0 flex-col gap-4"
      >
        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="text-sm font-medium text-foam">When were you in the water?</legend>
          <input type="hidden" name="time" value={time} />
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {QUICK_HOURS.map((hours) => (
              <label key={hours} className={`${CHOICE} justify-center has-[:checked]:border-foam`}>
                <input
                  type="radio"
                  name="when"
                  value={hours}
                  checked={choice === hours}
                  onChange={() => setChoice(hours)}
                  className="sr-only"
                />
                {quickLabel(hours)}
              </label>
            ))}
            <label className={`${CHOICE} justify-center has-[:checked]:border-foam`}>
              <input
                type="radio"
                name="when"
                value="other"
                checked={choice === "other"}
                onChange={() => setChoice("other")}
                className="sr-only"
              />
              Other
            </label>
          </div>
          {choice === "other" ? (
            <label className="flex min-w-0 flex-col gap-1 text-sm text-foam" htmlFor="report-time">
              Time in the water, {zoneLabel(zone)}
              <input
                id="report-time"
                type="datetime-local"
                required
                value={otherTime}
                onChange={(event) => setOtherTime(event.currentTarget.value)}
                className="field w-full min-w-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
              />
            </label>
          ) : null}
        </fieldset>
        {choice === "other" && theirs ? (
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
            Report added. {state.award ? awardLine(state.award) : null}{" "}
            <Link href="/account" className="underline decoration-incoming underline-offset-4">
              Your points
            </Link>
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending || saved}
          className="min-h-11 w-full rounded-xl bg-foam px-4 text-base font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming disabled:opacity-50 sm:w-auto"
        >
          {pending ? "Adding…" : "Add report"}
        </button>
      </form>
    </section>
  );
}
