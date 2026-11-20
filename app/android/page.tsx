import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { androidBeta, BETA_EMAIL, betaSignupMailto, PLAY_OPT_IN_URL, PLAY_STORE_URL } from "@/lib/android-beta";

export const metadata: Metadata = {
  title: "Join the Android beta · 50Bar",
  description: "Test the 50Bar: Maldives Dive Currents app for Android before it is released. The iPhone app is coming soon.",
};

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex min-w-0 gap-3 surface p-4 sm:p-5">
      <span
        aria-hidden="true"
        className="grid size-8 shrink-0 place-items-center rounded-full bg-incoming/20 text-sm font-semibold text-incoming ring-1 ring-incoming/40"
      >
        {n}
      </span>
      <div className="flex min-w-0 flex-col gap-2 text-sm leading-6 text-foam/85">
        <h2 className="text-base font-semibold text-foam">{title}</h2>
        {children}
      </div>
    </li>
  );
}

const BUTTON =
  "inline-flex min-h-11 w-fit items-center rounded-full bg-incoming px-4 text-sm font-semibold text-ink no-underline hover:bg-incoming/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming";
const LINK = "underline decoration-foam/40 underline-offset-4 hover:text-foam";

/** How to join the Android closed test (lib/android-beta.ts). Hidden while no beta is set up. */
export default async function AndroidBetaPage() {
  await connection();
  const beta = androidBeta();
  if (!beta) notFound();

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-3xl min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-8 sm:py-8">
      <header className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foam">Try the 50Bar app for Android</h1>
        <p className="text-sm leading-6 text-foam/80">
          50Bar: Maldives Dive Currents is in a closed test on Google Play before its release. The same forecasts as this
          website, with an offline map for the boat, boat navigation, dive plans and reports. Testers get it first, and
          your feedback shapes it. It is free.
        </p>
      </header>

      <ol className="flex flex-col gap-3">
        {beta.join === "group" ? (
          <Step n={1} title="Join the testers group">
            <p>
              Join the group with the Google account you use for Google Play on your phone. You get no emails from it
              unless you choose to.
            </p>
            <a href={beta.groupUrl} className={BUTTON} target="_blank" rel="noopener noreferrer">
              Join the group
            </a>
          </Step>
        ) : (
          <Step n={1} title="Ask to be added">
            <p>
              Email us the Google account address you use for Google Play on your phone. We add you to the testers list,
              usually within a day, and write back when it is done.
            </p>
            <a href={betaSignupMailto()} className={BUTTON}>
              Email {BETA_EMAIL}
            </a>
          </Step>
        )}
        <Step n={2} title="Become a tester">
          <p>
            Open the Google Play testing page, signed in with the same Google account, and tap <strong className="text-foam">Become a tester</strong>.
            {beta.join === "email" ? " It works once we have added you." : null}
          </p>
          <a href={PLAY_OPT_IN_URL} className={BUTTON} target="_blank" rel="noopener noreferrer">
            Open the testing page
          </a>
        </Step>
        <Step n={3} title="Install the app">
          <p>
            Install 50Bar from Google Play. It can take a few minutes after you join before the store page shows it.
            Updates come through Google Play like any app.
          </p>
          <a href={PLAY_STORE_URL} className={BUTTON} target="_blank" rel="noopener noreferrer">
            Open in Google Play
          </a>
        </Step>
      </ol>

      <section className="flex min-w-0 flex-col gap-2 surface p-4 text-sm leading-6 text-foam/85 sm:p-5" aria-labelledby="ios-heading">
        <h2 id="ios-heading" className="text-base font-semibold text-foam">
          On an iPhone?
        </h2>
        <p>The iPhone app is coming soon. Until then, this website works in Safari and has the same forecasts.</p>
      </section>

      <p className="text-sm leading-6 text-foam/75">
        Found a bug or have an idea? Write to{" "}
        <a href={`mailto:${BETA_EMAIL}`} className={LINK}>
          {BETA_EMAIL}
        </a>
        , or leave private feedback on the app&rsquo;s Google Play page. You can leave the test any time from the testing
        page.
      </p>
    </main>
  );
}
