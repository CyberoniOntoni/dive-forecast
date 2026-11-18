"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { acceptTerms } from "@/lib/moderation-actions";

/** For divers who signed up before the content rules: agree once before posting reviews, photos, sites or About me. */
export function TermsPrompt() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-3xl border border-outgoing/60 p-4 sm:p-5" aria-labelledby="terms-heading">
      <h2 id="terms-heading" className="text-base font-semibold text-foam">
        Agree to the content rules
      </h2>
      <p className="text-sm leading-6 text-foam/85">
        Before you post reviews, photos, sites or an About me, agree to the{" "}
        <Link href="/terms" className="underline decoration-incoming underline-offset-4">
          content rules
        </Link>
        : no nudity, hate, harassment or spam. Posts that break them are removed and their divers banned.
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await acceptTerms();
            if (!result.ok) setError(result.error);
            else router.refresh();
          })
        }
        className="min-h-11 self-start rounded-xl bg-foam px-4 text-base font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming disabled:opacity-50"
      >
        I agree
      </button>
      {error ? (
        <p role="alert" className="text-sm text-outgoing">
          {error}
        </p>
      ) : null}
    </section>
  );
}
