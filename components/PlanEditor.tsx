"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import {
  addDays,
  BOAT_SPEED_MAX_KN,
  BOAT_SPEED_MIN_KN,
  dayLabel,
  PLAN_DAYS_MAX,
  PLAN_NOTES_MAX,
  PLAN_STOPS_PER_DAY_MAX,
  PLAN_TITLE_MAX,
  STOP_NOTE_MAX,
  type PickerSite,
} from "@/lib/dive-plan";
import { deletePlan, savePlan } from "@/lib/plan-actions";
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
  const [speed, setSpeed] = useState(String(plan?.boatSpeedKn ?? 8));
  const [days, setDays] = useState<DraftDay[]>(() => fromPlan(plan, today));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const byId = useMemo(() => new Map(sites.map((site) => [site.id, site])), [sites]);

  const changeDay = (dayKey: string, change: (day: DraftDay) => DraftDay) =>
    setDays((all) => all.map((day) => (day.key === dayKey ? change(day) : day)));
  const changeStop = (dayKey: string, stopKey: string, change: Partial<DraftStop>) =>
    changeDay(dayKey, (day) => ({ ...day, stops: day.stops.map((stop) => (stop.key === stopKey ? { ...stop, ...change } : stop)) }));

  const addDay = () =>
    setDays((all) => {
      const last = all.reduce((latest, day) => (day.date > latest ? day.date : latest), "");
      return [...all, { key: key(), date: last ? addDays(last, 1) : today, stops: [] }];
    });

  const addStop = (dayKey: string) =>
    changeDay(dayKey, (day) => {
      const latest = day.stops.reduce((max, stop) => (stop.time > max ? stop.time : max), "");
      const time = DIVE_TIMES.find((option) => option > latest) ?? "12:00";
      return { ...day, stops: [...day.stops, { key: key(), siteId: "", time, note: "", want: "" }] };
    });

  const save = async () => {
    setError(null);
    setSaving(true);
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
          <div className="flex min-w-0 flex-wrap items-end justify-between gap-2">
            <label className="flex min-w-0 flex-col gap-1 text-sm font-medium text-foam">
              Day {index + 1}
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
            <span className="text-sm text-foam/70">{day.date ? dayLabel(day.date) : ""}</span>
            {days.length > 1 ? (
              <button type="button" className={QUIET} onClick={() => setDays((all) => all.filter((item) => item.key !== day.key))}>
                Remove day
              </button>
            ) : null}
          </div>
          <ol className="flex min-w-0 flex-col gap-3">
            {day.stops.map((stop, at) => (
              <li key={stop.key} className="flex min-w-0 flex-col gap-2 rounded-2xl bg-foam/5 p-3 ring-1 ring-foam/10">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foam">Dive {at + 1}</span>
                  <button
                    type="button"
                    className={QUIET}
                    onClick={() => changeDay(day.key, (item) => ({ ...item, stops: item.stops.filter((other) => other.key !== stop.key) }))}
                  >
                    Remove
                  </button>
                </div>
                <div className="grid min-w-0 gap-2 sm:grid-cols-[8rem_1fr]">
                  <label className="flex min-w-0 flex-col gap-1 text-sm text-foam">
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
                  <label className="flex min-w-0 flex-col gap-1 text-sm text-foam sm:max-w-72">
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
                  </label>
                ) : null}
                <label className="flex min-w-0 flex-col gap-1 text-sm text-foam">
                  Note <span className="text-foam/70">(optional: entry, what to look for)</span>
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
          <button
            type="button"
            className={`${QUIET} self-start`}
            disabled={day.stops.length >= PLAN_STOPS_PER_DAY_MAX}
            onClick={() => addStop(day.key)}
          >
            + Add a dive
          </button>
        </section>
      ))}

      <button type="button" className={`${QUIET} self-start`} disabled={days.length >= PLAN_DAYS_MAX} onClick={addDay}>
        + Add a day
      </button>

      {error ? (
        <p role="alert" className="text-sm font-medium text-stop">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-incoming px-5 text-base font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foam disabled:opacity-60"
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
    </form>
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
          <span className="field flex min-w-0 flex-1 items-center truncate">
            <span className="truncate font-medium">{picked.name}</span>
            {picked.atoll ? <span className="ml-1 shrink-0 text-foam/65">· {picked.atoll}</span> : null}
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
