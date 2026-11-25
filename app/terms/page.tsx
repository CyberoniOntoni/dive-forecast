import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Content rules and terms · 50Bar",
  description: "What you may post on 50Bar, what is not allowed, how to report it, and what happens to posts and divers that break the rules.",
};

/**
 * The content rules divers agree to at sign-in (lib/accounts.ts finishLogin, TERMS_NEEDED), which Google Play's
 * user-generated content policy asks for. Reporting, blocking and moderation are in lib/moderation.ts.
 */
const UPDATED = "18 November 2026";
const CONTACT = "support@50bar.app";

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

export default function TermsPage() {
  return (
    <main className="mx-auto flex min-h-0 w-full max-w-3xl min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-8 sm:py-8">
      <header className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foam">Content rules and terms</h1>
        <p className="text-sm text-foam/75">
          For the 50Bar website (50bar.app) and the 50Bar: Maldives Dive Currents app for Android. Last updated {UPDATED}. You agree
          to these when you sign in.
        </p>
      </header>

      <Section id="what" title="What you can post">
        <p>
          Signed-in divers post dive reports, ratings and reviews of dive sites with photos, new dive sites with notes and photos, dive
          plans, a nickname and an About me. Everything except dive plans is public, under your nickname. Post only what is about
          diving, true as far as you know, and yours to share: your own photos, or ones you have the right to post.
        </p>
      </Section>

      <Section id="not-allowed" title="Not allowed">
        <ul>
          <li>Nudity, sexual content or sexualised images of anyone, and anything that sexualises minors, which we also report to the authorities.</li>
          <li>Hate speech, or content that attacks people for their race, ethnicity, religion, nationality, disability, sex, gender, sexual orientation or age.</li>
          <li>Harassment, bullying, threats, or posts aimed at a person.</li>
          <li>Violence, gore, cruelty to animals, or harming marine life (touching, feeding or taking it) shown approvingly.</li>
          <li>Illegal or dangerous activity, including diving practices that put others at risk, drugs and weapons.</li>
          <li>Someone else&rsquo;s private information: names with faces they did not agree to share, phone numbers, addresses, emails.</li>
          <li>Spam, advertising, links to sell things, fake reports or reviews, and posts to game the points.</li>
          <li>Content you do not have the right to post, such as other people&rsquo;s photos.</li>
          <li>Pretending to be another person or business, and nicknames that break any of these rules.</li>
        </ul>
      </Section>

      <Section id="report" title="Reporting and blocking">
        <p>
          Every review, site added by a diver and diver page has a <strong className="text-foam">Report</strong> button, on the website and in
          the app. Reports go to our moderators, who look at them as soon as they can, usually within a day. You can also{" "}
          <strong className="text-foam">Block</strong> a diver: you will no longer see their reviews and photos. Unblock them on your account
          page.
        </p>
      </Section>

      <Section id="enforcement" title="What we do">
        <p>
          We remove content that breaks these rules, and may reset a nickname or About me that does. Divers who break them, or post
          anything illegal or sexual, are banned: their account is suspended, everything they posted except dive reports is removed, and
          they cannot sign in again. We may remove any content and suspend any account at our discretion.
        </p>
      </Section>

      <Section id="forecast" title="About the forecast">
        <p>
          The current forecast is a model built from tide and ocean data and divers&rsquo; reports. It can be wrong. Use it as one guide among
          others, never instead of local knowledge, your dive guide and your own judgment. Diving is at your own risk. Boat routes (the Route tab
          and a site&rsquo;s Boat route button) are a preview: they follow satellite outlines, not a nautical chart, the current along
          them is a forecast, and they are not for navigation.
        </p>
      </Section>

      <Section id="yours" title="Your content and your account">
        <p>
          You keep the rights to what you post. You let 50Bar show it in the website and the app, and keep dive reports with no name on
          them to improve the forecast, also after you delete your account. You can delete your account any time; see the{" "}
          <Link href="/privacy">privacy policy</Link>. Questions: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
      </Section>
    </main>
  );
}
