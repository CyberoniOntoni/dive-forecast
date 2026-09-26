"use client";

import { useActionState, useRef } from "react";
import { addReportAction, type ReportActionState } from "@/lib/actions";

const CHOICE =
  "flex min-h-11 items-center gap-2 rounded-md border border-foam/20 px-3 text-base text-foam has-[:checked]:bg-foam/10 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-incoming";

const INITIAL: ReportActionState = { success: false, error: null };

export function ReportForm({ siteId }: { siteId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    async (_prev: ReportActionState, formData: FormData) => {
      const next = await addReportAction(siteId, formData);
      if (next.success) formRef.current?.reset();
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
        Time is Maldives wall time. Saving a report updates the hours above.
      </p>
      <form ref={formRef} action={formAction} className="flex min-w-0 flex-col gap-4">
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
        {state.error ? (
          <p role="alert" className="text-sm text-outgoing">
            {state.error}
          </p>
        ) : null}
        {state.success ? (
          <p role="status" className="text-sm text-foam">
            Report added.
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 w-full rounded-md bg-foam px-4 text-base font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming disabled:opacity-50 sm:w-auto"
        >
          {pending ? "Adding…" : "Add report"}
        </button>
      </form>
    </section>
  );
}
