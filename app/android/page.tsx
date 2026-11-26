import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  BETA_EMAIL,
  PLAY_OPT_IN_URL,
  PLAY_STORE_URL,
  TEST_DAYS,
  TESTERS_GROUP_EMAIL,
  TESTERS_GROUP_URL,
} from "@/lib/android-beta";

export const metadata: Metadata = {
  title: "Join the Android beta · 50Bar",
  description:
    "Help test 50Bar: Maldives Dive Currents for Android before it goes public on Google Play. Free, no ads. The iPhone app is coming soon.",
};

const PROSE =
  "flex flex-col gap-2 text-sm leading-6 text-foam/85 [&_a]:underline [&_a]:decoration-foam/40 [&_a]:underline-offset-4 [&_a:hover]:text-foam [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="flex min-w-0 scroll-mt-4 flex-col gap-2 surface p-4 sm:p-5" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="text-base font-semibold text-foam">
        {title}
      </h2>
      <div className={PROSE}>{children}</div>
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex min-w-0 gap-3">
      <span
        aria-hidden="true"
        className="grid size-8 shrink-0 place-items-center rounded-full bg-incoming/20 text-sm font-semibold text-incoming ring-1 ring-incoming/40"
      >
        {n}
      </span>
      <div className={`${PROSE} min-w-0`}>
        <h3 className="text-sm font-semibold leading-8 text-foam">{title}</h3>
        {children}
      </div>
    </li>
  );
}

const BUTTON =
  "button-primary w-fit !no-underline hover:!text-ink";

/** How to join the Android closed test (lib/android-beta.ts), linked from the header strip and /account. */
export default function AndroidBetaPage() {
  return (
    <main className="mx-auto flex min-h-0 w-full max-w-3xl min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-8 sm:py-8">
      <header className="rise-in flex min-w-0 flex-col gap-2">
        <p className="eyebrow">Android beta</p>
        <h1 className="text-2xl font-semibold tracking-tight text-foam">Help test the 50Bar app for Android</h1>
        <p className="text-sm leading-6 text-foam/80">
          50Bar: Maldives Dive Currents is in a closed test on Google Play before it goes public. Anyone who dives here
          knows the current makes or breaks a channel dive, and guessing it from tide tables is not good enough. Guides,
          instructors, liveaboard crews and anyone diving in the Maldives soon would be ideal testers, but every Android
          user helps. It is free, with no ads.
        </p>
        <a href="#join" className={BUTTON}>
          How to join
        </a>
      </header>

      <Section id="what" title="What it does">
        <ul>
          <li>Current forecast for 300+ dive sites across all atolls: strength, direction, tide and slack times, for the week ahead</li>
          <li>Map with live current arrows and a sheltered water layer, so you can see where it&rsquo;s calm</li>
          <li>Report the current after your dive</li>
          <li>Rate and review sites, with photos</li>
          <li>Daily and weekly dive plans you can share with your group or guests</li>
          <li>Boat route preview to sites, with the forecast current along the route</li>
          <li>Save whole atolls for offline use, for liveaboards and remote spots with no signal</li>
        </ul>
      </Section>

      <Section id="reports" title="Why your dive reports matter most">
        <p>
          The main aim of this beta is to find out how accurate the forecast really is, and the only way to do that is
          with real dives. After a dive, open the site in the app or here on 50bar.app and report what the current
          actually was: its strength and direction.
        </p>
        <p>
          Please report as accurately as you can. Every report changes the forecast for that site, so an honest
          &ldquo;it was mild&rdquo; helps far more than a guess. If you&rsquo;re not sure, say so or leave it out.
        </p>
      </Section>

      <section id="join" className="flex min-w-0 scroll-mt-4 flex-col gap-4 surface p-4 sm:p-5" aria-labelledby="join-heading">
        <div className="flex flex-col gap-1">
          <h2 id="join-heading" className="text-base font-semibold text-foam">
            How to join (Android only for now)
          </h2>
          <p className="text-sm leading-6 text-foam/80">
            Google needs at least 12 testers to stay in the closed test for {TEST_DAYS} days before the app can be published.
          </p>
        </div>
        <ol className="flex flex-col gap-4">
          <Step n={1} title="Join the Google Group">
            <p>
              Use the same Google account as your phone&rsquo;s Play Store. You can also join by emailing{" "}
              <a href={`mailto:${TESTERS_GROUP_EMAIL}`}>{TESTERS_GROUP_EMAIL}</a>.
            </p>
            <a href={TESTERS_GROUP_URL} className={BUTTON} target="_blank" rel="noopener noreferrer">
              Join the group
            </a>
          </Step>
          <Step n={2} title="Opt in to the test">
            <p>
              Tap <strong className="text-foam">Become a tester</strong>. The opt-in link only works after you&rsquo;ve
              joined the group.
            </p>
            <a href={PLAY_OPT_IN_URL} className={BUTTON} target="_blank" rel="noopener noreferrer">
              Opt in on Google Play
            </a>
          </Step>
          <Step n={3} title="Install 50Bar">
            <p>
              Install it from the Play Store link on that page, and keep it installed for at least {TEST_DAYS} days. It can
              take a few minutes after opting in before the store shows it.
            </p>
            <a href={PLAY_STORE_URL} className={BUTTON} target="_blank" rel="noopener noreferrer">
              Open in the Play Store
            </a>
          </Step>
        </ol>
      </section>

      <Section id="no-android" title="No Android?">
        <p>
          The iPhone app is coming soon. Until then, everything is free <Link href="/">here on 50bar.app</Link>, on any
          phone or computer, with no install.
        </p>
      </Section>

      <p className="text-sm leading-6 text-foam/75">
        Bugs, odd forecasts and ideas are all welcome at{" "}
        <a href={`mailto:${BETA_EMAIL}`} className="underline decoration-foam/40 underline-offset-4 hover:text-foam">
          {BETA_EMAIL}
        </a>
        . If a forecast is wrong for a site you know well, we especially want to hear about it.
      </p>
    </main>
  );
}
