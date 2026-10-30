"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { completeSignIn, requestSignIn } from "@/lib/account-actions";
import { NICKNAME_MAX } from "@/lib/accounts";

const FIELD =
  "field w-full min-w-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming";
const PRIMARY =
  "min-h-11 w-full rounded-xl bg-foam px-4 text-base font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming disabled:opacity-50";

/**
 * Two steps, no password: an email gets a six-digit code, the code signs in. A new address picks its nickname on the
 * code step; that nickname, never the email, is what other divers see. The emailed link opens this page with the
 * email and code filled in, so it only takes the button.
 */
export function SignInForm({
  initialEmail,
  initialCode,
  next,
}: {
  initialEmail: string;
  initialCode: string;
  next: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">(initialEmail && initialCode ? "code" : "email");
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState(initialCode);
  const [nickname, setNickname] = useState("");
  const [askNickname, setAskNickname] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  function sendCode(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await requestSignIn(email, next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAskNickname(result.newUser === true);
      setCode("");
      setSent(true);
      setStep("code");
    });
  }

  function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await completeSignIn({ email, code, nickname: askNickname ? nickname : undefined });
      if (result.ok) {
        router.replace(next);
        router.refresh();
        return;
      }
      if (result.needsNickname && !askNickname) {
        // Opened from the email link: the address is new, so it still needs a nickname.
        setAskNickname(true);
        return;
      }
      setError(result.error);
    });
  }

  return (
    <section className="flex min-w-0 flex-col gap-4 surface p-5" aria-labelledby="sign-in-heading">
      <h1 id="sign-in-heading" className="text-xl font-semibold text-foam">
        {step === "email" ? "Sign in or sign up" : askNickname ? "Welcome aboard" : "Check your email"}
      </h1>
      {step === "email" ? (
        <form onSubmit={sendCode} className="flex min-w-0 flex-col gap-4">
          <p className="text-sm leading-6 text-foam/80">
            Signed-in divers report the current, rate sites and add new ones. No password: we email you a code.
          </p>
          <label className="flex min-w-0 flex-col gap-1 text-sm text-foam" htmlFor="sign-in-email">
            Email
            <input
              id="sign-in-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={FIELD}
            />
          </label>
          {error ? (
            <p role="alert" className="text-sm text-outgoing">
              {error}
            </p>
          ) : null}
          <button type="submit" disabled={pending || !email.trim()} className={PRIMARY}>
            {pending ? "Sending…" : "Email me a code"}
          </button>
        </form>
      ) : (
        <form onSubmit={signIn} className="flex min-w-0 flex-col gap-4">
          <p className="text-sm leading-6 text-foam/80">
            {sent ? `We sent a 6-digit code to ${email}. It works for 15 minutes.` : `Signing in as ${email}.`}
          </p>
          <label className="flex min-w-0 flex-col gap-1 text-sm text-foam" htmlFor="sign-in-code">
            Code
            <input
              id="sign-in-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              maxLength={7}
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className={`${FIELD} font-mono tracking-[0.3em]`}
            />
          </label>
          {askNickname ? (
            <label className="flex min-w-0 flex-col gap-1 text-sm text-foam" htmlFor="sign-in-nickname">
              Pick a nickname
              <input
                id="sign-in-nickname"
                autoComplete="nickname"
                required
                maxLength={NICKNAME_MAX}
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                placeholder="e.g. MantaMike"
                className={FIELD}
              />
              <span className="text-xs leading-5 text-foam/70">
                Shown on your reports and the leaderboard instead of your email. You can change it later.
              </span>
            </label>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-outgoing">
              {error}
            </p>
          ) : null}
          <button type="submit" disabled={pending} className={PRIMARY}>
            {pending ? "Signing in…" : "Sign in"}
          </button>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <button
              type="button"
              onClick={() => sendCode()}
              disabled={pending}
              className="min-h-11 text-foam/80 underline decoration-incoming underline-offset-4"
            >
              Send a new code
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setError(null);
              }}
              className="min-h-11 text-foam/80 underline decoration-incoming underline-offset-4"
            >
              Use another email
            </button>
          </div>
        </form>
      )}
      <Link href="/" className="text-sm text-foam/70 underline underline-offset-4">
        Back to the map
      </Link>
    </section>
  );
}
