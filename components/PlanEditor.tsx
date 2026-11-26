"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import {
  addDays,
  BOAT_SPEED_MAX_KN,
  BOAT_SPEED_MIN_KN,
  dayLabel,
  DEFAULT_BOAT_SPEED_KN,
  PLAN_DAYS_MAX,
  PLAN_NOTES_MAX,
  PLAN_STOPS_PER_DAY_MAX,
  PLAN_TITLE_MAX,
  requirePlanInput,
  STOP_NOTE_MAX,
  type PickerSite,
} from "@/lib/dive-plan";
import { deletePlan, savePlan } from "@/lib/plan-actions";
import { moveStopKeepingTimes } from "@/lib/plan-legs";
import { matchesSearch } from "@/lib/site-search";
import type { Direction, DivePlan } from "@/lib/types";


type DraftStop = { key: string; siteId: string; time: string; note: string; want: "" | Direction };
type DraftDay = { key: string; date: string; stops: DraftStop[] };

const FIELD =
  "field w-full min-w-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming";
const QUIET =
  "button-quiet justify-center px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming disabled:opacity-50";
/** The usual liveaboard day: an early dive, one late morning, one after lunch. */
const DIVE_TIMES = ["07:00", "10:30", "14:30", "17:30", "19:30", "21:00"];

let counter = 0;
function key(): string {
  counter += 1;
  return `k${counter}`;
}

function fromPlan(plan: DivePlan | null, today: string): DraftDay[] {
  if (!plan) return [{ key: key(), date: today, stops: [] }];
  return plan.days.map((day) => ({
    key: key(),
    date: day.date,
    stops: day.stops.map((stop) => ({ key: key(), siteId: stop.siteId, time: stop.time, note: stop.note ?? "", want: stop.want ?? "" })),
  }));
}

/**
 * Making or changing a dive plan: a title, the boat's speed, notes, and days of dives, each a site and a time. Saving
 * goes to the plan's page, whose link is the one to share.
 */
export function PlanEditor({
  sites,
  plan,
  today,
}: {
  sites: readonly PickerSite[];
  plan: DivePlan | null;
  /** Maldives date today, "YYYY-MM-DD": a new plan starts on it. */
  today: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(plan?.title ?? "");
  const [notes, setNotes] = useState(plan?.notes ?? "");
  const [speed, setSpeed] = useState(String(plan?.boatSpeedKn ?? DEFAULT_BOAT_SPEED_KN));
  const [days, setDays] = useState<DraftDay[]>(() => fromPlan(plan, today));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const byId = useMemo(() => new Map(sites.map((site) => [site.id, site])), [sites]);

  const changeDay = (dayKey: string, change: (day: DraftDay) => DraftDay) =>
    setDays((all) => all.map((day) => (day.key === dayKey ? change(day) : day)));
  const changeStop = (dayKey: string, stopKey: string, change: Partial<DraftStop>) =>
    changeDay(dayKey, (day) => ({ ...day, stops: day.stops.map((stop) => (stop.key === stopKey ? { ...stop, ...change } : stop)) }));

  const moveStop = (dayKey: string, at: number, by: -1 | 1) =>
    changeDay(dayKey, (day) => ({ ...day, stops: moveStopKeepingTimes(day.stops, at, by) }));

  const addDay = () => setDays((all) => [...all, { key: key(), date: nextDate(all, today), stops: [] }]);

  const addStop = (dayKey: string) =>
    changeDay(dayKey, (day) => {
      const latest = day.stops.reduce((max, stop) => (stop.time > max ? stop.time : max), "");
      const time = DIVE_TIMES.find((option) => option > latest) ?? "12:00";
      return { ...day, stops: [...day.stops, { key: key(), siteId: "", time, note: "", want: "" }] };
    });

  const save = async () => {
    setError(null);
    const input = {
      title,
      notes,
      boatSpeedKn: Number(speed),
      days: days.map((day) => ({
        date: day.date,
        stops: day.stops.map((stop) => ({
          siteId: stop.siteId,
          time: stop.time,
          note: stop.note,
          ...(stop.want && byId.get(stop.siteId)?.channel ? { want: stop.want } : {}),
        })),
      })),
    };
    // The same checks the server runs, first here, so a missing site or time shows at once, with no round trip.
    try {
      requirePlanInput(input, (siteId) => byId.has(siteId));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Check the plan.");
      return;
    }
    setSaving(true);
    try {
      const result = await savePlan(plan?.id ?? null, input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/plans/${result.id}`);
      router.refresh();
    } catch {
      setError("Could not save the plan. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!plan) return;
    setSaving(true);
    try {
      const result = await deletePlan(plan.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/plans");
      router.refresh();
    } catch {
      setError("Could not delete the plan.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="flex min-w-0 flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <section className="flex min-w-0 flex-col gap-3 surface p-4 sm:p-5">
        <label className="flex min-w-0 flex-col gap-1 text-sm font-medium text-foam">
          Title
          <input
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
            maxLength={PLAN_TITLE_MAX}
            required
            placeholder="North Male week, MV Example"
            className={FIELD}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-sm font-medium text-foam sm:max-w-48">
          Boat speed, knots
          <input
            type="number"
            inputMode="decimal"
            min={BOAT_SPEED_MIN_KN}
            max={BOAT_SPEED_MAX_KN}
            step="0.5"
            value={speed}
            onChange={(event) => setSpeed(event.currentTarget.value)}
            required
            className={FIELD}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-sm font-medium text-foam">
          Notes for the group <span className="font-normal text-foam/70">(optional: meeting point, kit, briefing times)</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.currentTarget.value)}
            maxLength={PLAN_NOTES_MAX}
            rows={3}
            className={`${FIELD} py-2`}
          />
        </label>
      </section>

      {days.map((day, index) => (
        <section key={day.key} className="flex min-w-0 flex-col gap-3 surface p-4 sm:p-5" aria-label={`Day ${index + 1}`}>
          <div className="flex min-w-0 items-end justify-between gap-2">
            <label className="flex min-w-0 flex-col gap-1 text-sm font-medium text-foam">
              <span>
                Day {index + 1}
                {day.date ? <span className="font-normal text-foam/65"> · {dayLabel(day.date)}</span> : null}
              </span>
              <input
                type="date"
                value={day.date}
                required
                onChange={(event) => {
                  const date = event.currentTarget.value;
                  changeDay(day.key, (item) => ({ ...item, date }));
                }}
                className={`${FIELD} sm:w-48`}
              />
            </label>
            {days.length > 1 ? (
              <IconButton
                label={`Remove day ${index + 1}`}
                onClick={() => setDays((all) => all.filter((item) => item.key !== day.key))}
              />
            ) : null}
          </div>
          <ol className="flex min-w-0 flex-col gap-3">
            {day.stops.map((stop, at) => (
              <li key={stop.key} className="flex min-w-0 flex-col gap-3 rounded-2xl bg-foam/[0.06] p-3 ring-1 ring-foam/10">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-semibold text-foam">
                    <span aria-hidden="true" className="grid size-6 place-items-center rounded-full bg-foam/15 text-xs">
                      {at + 1}
                    </span>
                    Dive {at + 1}
                  </span>
                  <span className="flex shrink-0 items-center">
                    <IconButton
                      icon="up"
                      label={`Move dive ${at + 1} up`}
                      disabled={at === 0}
                      onClick={() => moveStop(day.key, at, -1)}
                    />
                    <IconButton
                      icon="down"
                      label={`Move dive ${at + 1} down`}
                      disabled={at === day.stops.length - 1}
                      onClick={() => moveStop(day.key, at, 1)}
                    />
                    <IconButton
                      label={`Remove dive ${at + 1}`}
                      onClick={() => changeDay(day.key, (item) => ({ ...item, stops: item.stops.filter((other) => other.key !== stop.key) }))}
                    />
                  </span>
                </div>
                <div className="grid min-w-0 gap-3 sm:grid-cols-[9rem_1fr] sm:gap-2">
                  <label className="flex min-w-0 flex-col gap-1 text-sm text-foam max-sm:w-40">
                    In the water at
                    <input
                      type="time"
                      step={300}
                      value={stop.time}
                      required
                      onChange={(event) => changeStop(day.key, stop.key, { time: event.currentTarget.value })}
                      className={FIELD}
                    />
                  </label>
                  <SitePicker
                    sites={sites}
                    value={stop.siteId}
                    onPick={(siteId) => changeStop(day.key, stop.key, { siteId })}
                  />
                </div>
                {byId.get(stop.siteId)?.channel ? (
                  <label className="flex min-w-0 flex-col gap-1 text-sm text-foam sm:max-w-80">
                    Current you want
                    <select
                      value={stop.want}
                      onChange={(event) => changeStop(day.key, stop.key, { want: event.currentTarget.value as DraftStop["want"] })}
                      className={FIELD}
                    >
                      <option value="">Either way</option>
                      <option value="incoming">Incoming (into the atoll)</option>
                      <option value="outgoing">Outgoing (out of the atoll)</option>
                    </select>
                    <span className="text-xs text-foam/65">A channel: the plan warns if it runs the other way.</span>
                  </label>
                ) : null}
                <label className="flex min-w-0 flex-col gap-1 text-sm text-foam">
                  <span>
                    Note <span className="text-foam/65">(optional: entry, what to look for)</span>
                  </span>
                  <input
                    value={stop.note}
                    maxLength={STOP_NOTE_MAX}
                    onChange={(event) => changeStop(day.key, stop.key, { note: event.currentTarget.value })}
                    className={FIELD}
                  />
                </label>
              </li>
            ))}
          </ol>
          {day.stops.length === 0 ? <p className="text-sm text-foam/65">No dives yet on this day.</p> : null}
          <button
            type="button"
            className={`${QUIET} self-start gap-1.5 border-dashed`}
            disabled={day.stops.length >= PLAN_STOPS_PER_DAY_MAX}
            onClick={() => addStop(day.key)}
          >
            <span aria-hidden="true" className="text-base leading-none">+</span> Add a dive
          </button>
        </section>
      ))}

      <button
        type="button"
        className={`${QUIET} justify-center gap-1.5 border-dashed py-3`}
        disabled={days.length >= PLAN_DAYS_MAX}
        onClick={addDay}
      >
        <span aria-hidden="true" className="text-base leading-none">+</span> Add a day
        {days.length > 0 ? <span className="font-normal text-foam/65"> ({dayLabel(nextDate(days, today))})</span> : null}
      </button>

      {/* Stays at the foot of the screen while a long plan scrolls, so saving is always one tap away. */}
      <div className="sticky bottom-0 z-10 -mx-4 flex shrink-0 flex-col gap-2 border-t border-foam/15 bg-[color-mix(in_srgb,var(--ink)_92%,transparent)] px-4 py-3 backdrop-blur-md sm:-mx-8 sm:px-8">
        {error ? (
          <p role="alert" className="text-sm font-medium text-stop">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={saving}
            className="button-primary"
          >
            {saving ? "Saving…" : plan ? "Save changes" : "Save and get the link"}
          </button>
          {plan ? (
            confirmDelete ? (
              <>
                <button type="button" className={`${QUIET} border-stop text-stop`} disabled={saving} onClick={() => void remove()}>
                  Yes, delete this plan
                </button>
                <button type="button" className={QUIET} onClick={() => setConfirmDelete(false)}>
                  Keep it
                </button>
              </>
            ) : (
              <button type="button" className={QUIET} onClick={() => setConfirmDelete(true)}>
                Delete plan
              </button>
            )
          ) : null}
        </div>
      </div>
    </form>
  );
}

/** The day after the plan's last day, or today for an empty plan. */
function nextDate(days: readonly DraftDay[], today: string): string {
  const last = days.reduce((latest, day) => (day.date > latest ? day.date : latest), "");
  return last ? addDays(last, 1) : today;
}

const ICON_PATHS = {
  close: "M6 6l12 12M18 6L6 18",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
} as const;

/** A round icon button: × removes a day or a dive, the arrows move a dive up or down. */
function IconButton({
  label,
  onClick,
  icon = "close",
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  icon?: keyof typeof ICON_PATHS;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid size-11 shrink-0 place-items-center rounded-full text-foam/70 hover:bg-foam/10 hover:text-foam focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming disabled:pointer-events-none disabled:opacity-30"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={ICON_PATHS[icon]} />
      </svg>
    </button>
  );
}

/** A search box over every site; picking one shows its name with a Change button. */
function SitePicker({ sites, value, onPick }: { sites: readonly PickerSite[]; value: string; onPick: (siteId: string) => void }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(value === "");
  const picked = sites.find((site) => site.id === value) ?? null;
  const matches = useMemo(() => {
    if (!query.trim()) return [];
    return sites.filter((site) => matchesSearch(site, site.atoll ?? undefined, query)).slice(0, 8);
  }, [sites, query]);

  if (picked && !open) {
    return (
      <div className="flex min-w-0 flex-col gap-1 text-sm text-foam">
        <span>Site</span>
        <div className="flex min-w-0 items-center gap-2">
          <span className="field flex min-w-0 flex-1 flex-col justify-center py-1 leading-tight">
            <span className="truncate font-medium">{picked.name}</span>
            {picked.atoll ? <span className="truncate text-xs text-foam/65">{picked.atoll}</span> : null}
          </span>
          <button type="button" className={QUIET} onClick={() => setOpen(true)}>
            Change
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="relative flex min-w-0 flex-col gap-1 text-sm text-foam">
      <label htmlFor={id}>Site</label>
      <input
        id={id}
        type="search"
        value={query}
        autoComplete="off"
        placeholder="Search a site or atoll"
        onChange={(event) => setQuery(event.currentTarget.value)}
        className={FIELD}
      />
      {matches.length > 0 ? (
        <ul className="flex min-w-0 flex-col overflow-hidden rounded-xl ring-1 ring-foam/20" role="listbox" aria-label="Matching sites">
          {matches.map((site) => (
            <li key={site.id}>
              <button
                type="button"
                className="flex min-h-11 w-full min-w-0 items-center gap-1 bg-ink px-3 text-left text-foam hover:bg-foam/10 focus-visible:bg-foam/10 focus-visible:outline-none"
                onClick={() => {
                  onPick(site.id);
                  setQuery("");
                  setOpen(false);
                }}
              >
                <span className="truncate font-medium">{site.name}</span>
                {site.atoll ? <span className="shrink-0 text-foam/65">· {site.atoll}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : query.trim() ? (
        <p className="text-foam/70">No site by that name.</p>
      ) : null}
      {picked ? (
        <button type="button" className={`${QUIET} self-start`} onClick={() => setOpen(false)}>
          Keep {picked.name}
        </button>
      ) : null}
    </div>
  );
}
