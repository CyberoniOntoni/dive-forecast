import { refresh } from "next/cache";
import { addReport } from "@/lib/actions";
import type { Direction, Strength } from "@/lib/types";

const CHOICE =
  "flex min-h-11 items-center gap-2 rounded-md border border-foam/20 px-3 text-base text-foam has-[:checked]:bg-foam/10 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-incoming";

export function ReportForm({ siteId }: { siteId: string }) {
  async function submit(formData: FormData) {
    "use server";
    const time = String(formData.get("time") ?? "").trim();
    const direction = String(formData.get("direction") ?? "");
    const strength = String(formData.get("strength") ?? "");
    if (!time) throw new Error("Time is required");
    if (!isDirection(direction)) throw new Error("Bad direction");
    if (!isStrength(strength)) throw new Error("Bad strength");
    await addReport({ siteId, time, direction, strength });
    refresh();
  }

  return (
    <section
      className="flex min-w-0 flex-col gap-3 rounded-2xl border border-foam/15 bg-glass p-4 sm:p-5"
      aria-labelledby="report-heading"
    >
      <h2 id="report-heading" className="text-base font-semibold text-foam">
        Report the current
      </h2>
      <p className="text-sm leading-6 text-foam/80">
        Time is Maldives wall time. Saving a report updates the hours above.
      </p>
      <form action={submit} className="flex min-w-0 flex-col gap-4">
        <label className="flex min-w-0 flex-col gap-1 text-sm text-foam" htmlFor="report-time">
          Time in the water
          <input
            id="report-time"
            name="time"
            type="datetime-local"
            required
            className="min-h-11 w-full min-w-0 rounded-md border border-foam/20 bg-ink px-3 text-base text-foam focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
          />
        </label>
        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="text-sm font-medium text-foam">Incoming or outgoing</legend>
          <div className="grid grid-cols-2 gap-2">
            <label className={`${CHOICE} has-[:checked]:border-incoming has-[:checked]:text-incoming`}>
              <input type="radio" name="direction" value="incoming" required className="size-5 accent-incoming" />
              Incoming
            </label>
            <label className={`${CHOICE} has-[:checked]:border-outgoing has-[:checked]:text-outgoing`}>
              <input type="radio" name="direction" value="outgoing" required className="size-5 accent-outgoing" />
              Outgoing
            </label>
          </div>
        </fieldset>
        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="text-sm font-medium text-foam">Slack, mild, strong, or too strong</legend>
          <div className="grid grid-cols-2 gap-2">
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
              Too strong
            </label>
          </div>
        </fieldset>
        <button
          type="submit"
          className="min-h-11 w-full rounded-md bg-foam px-4 text-base font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming sm:w-auto"
        >
          Add report
        </button>
      </form>
    </section>
  );
}

function isDirection(value: string): value is Direction {
  return value === "incoming" || value === "outgoing";
}

function isStrength(value: string): value is Strength {
  return value === "slack" || value === "mild" || value === "strong" || value === "too_strong";
}
