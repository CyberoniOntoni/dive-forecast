import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Privacy policy · 50Bar",
  description: "What the 50Bar website and Android app collect, why, where it is kept, and how to delete your account.",
};

/**
 * The privacy policy for the website and the Android app (Google Play links here). It describes what the code really
 * does: change it with any change to what is collected, sent or kept (lib/types.ts User, Report, Rating, Site,
 * DivePlan, PendingLogin; lib/accounts.ts deleteAccountRecords; lib/email.ts; the map layers' tile hosts).
 */
const UPDATED = "18 November 2026";
/** Where privacy questions and deletion requests go. */
const PRIVACY_EMAIL = "privacy@50bar.app";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="flex min-w-0 scroll-mt-4 flex-col gap-2 surface p-4 sm:p-5" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="text-base font-semibold text-foam">
        {title}
      </h2>
      <div className="flex flex-col gap-2 text-sm leading-6 text-foam/85 [&_a]:underline [&_a]:decoration-foam/40 [&_a]:underline-offset-4 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex min-h-0 w-full max-w-3xl min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-8 sm:py-8">
      <header className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foam">Privacy policy</h1>
        <p className="text-sm text-foam/75">
          For the 50Bar website (50bar.app) and the 50Bar: Maldives Dive Currents app for Android. Last updated {UPDATED}.
        </p>
      </header>

      <Section id="short" title="In short">
        <p>
          You can read every forecast without an account, and then we collect nothing about you. To file dive reports,
          rate sites, add sites or save dive plans you sign in with your email. We keep your email private, show only
          your nickname, never sell or share your data for advertising, and have no ads, analytics or tracking. You can
          delete your account at any time.
        </p>
      </Section>

      <Section id="collect" title="What we collect">
        <p>
          <strong className="text-foam">When you sign in:</strong>
        </p>
        <ul>
          <li>
            Your <strong className="text-foam">email address</strong>, to send you a six-digit sign-in code. Only you see
            it, on your account page. We keep a hash of each code, never the code itself. A code works for 15 minutes; its hash stays at least an hour, to count codes against the sending limits, and is removed the next time anyone asks for a code after that.
          </li>
          <li>
            A keyed hash of your connection&rsquo;s <strong className="text-foam">IP address</strong> with each code, to
            limit how many codes one connection can ask for. We never keep the address itself, and this hash is kept and
            removed with the code&rsquo;s.
          </li>
          <li>
            The <strong className="text-foam">nickname</strong> you pick, shown with your reports, reviews and on the
            scoreboard, and an optional <strong className="text-foam">About me</strong> shown on your public diver page.
          </li>
        </ul>
        <p>
          <strong className="text-foam">What you choose to add:</strong>
        </p>
        <ul>
          <li>
            <strong className="text-foam">Dive reports</strong>: the site, the time you were in the water, the current&rsquo;s
            direction and strength, and the forecast shown for that hour. They are public under your nickname and train
            the forecast.
          </li>
          <li>
            <strong className="text-foam">Ratings, reviews and photos</strong> of dive sites, public under your nickname.
          </li>
          <li>
            <strong className="text-foam">Dive sites</strong> you add: position, name, kind, depths, notes and photos,
            public on the map.
          </li>
          <li>
            <strong className="text-foam">Reports of content and blocks</strong>: when you report a review, site or diver, we keep
            what you reported, the reason and your note for our moderators, who see your nickname. Divers you block are kept on your
            account. Neither is shown to anyone else.
          </li>
          <li>
            <strong className="text-foam">Dive plans</strong>: days, sites, times and notes. Anyone with a plan&rsquo;s
            link can see it; only you can change it.
          </li>
        </ul>
        <p>
          Photos are made smaller on your device before upload, and we remove their EXIF data (camera details and GPS
          position) before they are stored.
        </p>
        <p>
          <strong className="text-foam">Your location:</strong> boat navigation uses your phone&rsquo;s GPS while its
          screen is open, never in the background. To plan a route your position is sent to our server with the
          request, used for that answer and not stored. The Android app asks for location permission only for this, and
          everything else works without it.
        </p>
        <p>
          <strong className="text-foam">On your device:</strong> the website keeps your sign-in in a cookie and your map
          settings and recent searches in your browser&rsquo;s storage. The app keeps your sign-in token (never backed up
          or moved to another phone), a copy of forecasts and maps for offline use, and your settings. These stay on
          your device.
        </p>
      </Section>

      <Section id="not" title="What we do not do">
        <ul>
          <li>No advertising, analytics, crash reporting or tracking tools, on the website or in the app.</li>
          <li>We do not sell your data or share it with anyone for advertising.</li>
          <li>We do not show your email to anyone else, or put it in the app&rsquo;s or the website&rsquo;s public data.</li>
        </ul>
      </Section>

      <Section id="where" title="Where it is kept, and who helps us">
        <ul>
          <li>
            <strong className="text-foam">Cloudflare</strong> runs the website and the app&rsquo;s server. Your account,
            reports, ratings, reviews, sites and plans are kept in Cloudflare D1, and photos in Cloudflare R2 storage.
            Cloudflare also sends the sign-in emails, and like any web host it handles your IP address to answer
            requests.
          </li>
          <li>
            <strong className="text-foam">Mailgun</strong> sends a sign-in email only if Cloudflare cannot. It then
            receives your email address and the email&rsquo;s text.
          </li>
          <li>
            <strong className="text-foam">Map tiles</strong> come straight to your device from Esri (satellite imagery),
            OpenStreetMap and OpenSeaMap when you show those layers, so those services see your IP address and which map
            area you look at. Our own Sentinel-2 imagery, forecasts and overlays come from 50bar.app.
          </li>
          <li>
            Ocean data comes from Open-Meteo, fetched by our server for the dive sites; nothing about you is sent.
          </li>
        </ul>
      </Section>

      <Section id="moderation" title="Moderation">
        <p>
          Reviews, photos, sites and profiles must follow our <Link href="/terms">content rules</Link>. Moderators read reported
          content and may remove it. If a diver is banned for breaking the rules, we keep their account&rsquo;s email and the
          reports about them, so they cannot sign up again; everything else they posted, except dive reports, is removed.
        </p>
      </Section>

      <Section id="why" title="Why we use it">
        <p>
          To sign you in, to show your contributions under your nickname, to improve the forecast with divers&rsquo;
          reports, to award points and badges, to plan boat routes, and to stop abuse (limits on codes, reports and
          uploads). We keep your account data while your account exists.
        </p>
      </Section>

      <Section id="delete" title="Deleting your account">
        <p>
          Sign in and open{" "}
          <Link href="/account#delete">your account page</Link>, or in the Android app open the You tab and tap{" "}
          <strong className="text-foam">Delete account</strong>. It happens at once and signs you out everywhere. If you
          cannot sign in, email <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a> from the address you signed up
          with and we will delete it within 30 days.
        </p>
        <p>
          <strong className="text-foam">Deleted:</strong> your email, nickname and About me, your pending sign-in
          codes, your dive plans, your ratings and reviews, every photo you uploaded, the reports you filed and the divers you
          blocked.
        </p>
        <p>
          <strong className="text-foam">Kept without your name:</strong> your dive reports, which keep teaching the
          forecast, and dive sites you added, so other divers&rsquo; reports and reviews there keep their place. Nothing
          left on them leads back to you, and they no longer count on the scoreboard. Cloudflare keeps a
          30-day restore history of the database, so deleted data can stay in that history until it is 30 days old.
        </p>
      </Section>

      <Section id="rights" title="Your choices and rights">
        <p>
          You can delete some of your data and keep your account, on the website or in the app, once signed in:
        </p>
        <ul>
          <li>
            <strong className="text-foam">A rating or review, with its photos</strong>: open the site and tap{" "}
            <strong className="text-foam">Remove my rating</strong>. It is deleted at once.
          </li>
          <li>
            <strong className="text-foam">A dive plan</strong>: open the plan and tap{" "}
            <strong className="text-foam">Delete plan</strong>.
          </li>
          <li>
            <strong className="text-foam">About me</strong>: clear it on <Link href="/account">your account page</Link>{" "}
            (in the app, the You tab).
          </li>
          <li>
            <strong className="text-foam">Dive reports, photos on a site you added, or anything else</strong>: email{" "}
            <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a> from the address you signed up with and we will delete
            it within 30 days.
          </li>
        </ul>
        <p>
          Cloudflare keeps a 30-day restore history of the database, so deleted data can stay in that history until it
          is 30 days old. To ask for a copy of your data, or with any other privacy question, email{" "}
          <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>. To delete everything, see{" "}
          <a href="#delete">Deleting your account</a>.
        </p>
        <p>
          50Bar is for divers and is not meant for children under 13. If we learn a child under 13 has an account, we
          delete it.
        </p>
        <p>If we change this policy we update it on this page and change the date above.</p>
      </Section>
    </main>
  );
}
