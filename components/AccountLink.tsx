import Link from "next/link";
import { currentSession } from "@/lib/auth";
import { signInHref } from "@/lib/sign-in";

/** The header's account button: the diver's initial when signed in (to their points), else a sign-in person icon. */
export async function AccountLink() {
  const session = await currentSession();
  const base =
    "inline-flex min-h-11 shrink-0 items-center justify-center rounded-full text-sm font-medium no-underline whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming";
  if (!session) {
    return (
      <Link href={signInHref("/")} aria-label="Sign in" title="Sign in" className={`${base} min-w-11 text-foam/85 hover:text-foam`}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
        </svg>
      </Link>
    );
  }
  return (
    <Link href="/account" aria-label={`Your account, ${session.nickname}`} title={session.nickname} className={`${base} min-w-11`}>
      <span
        aria-hidden="true"
        className="grid size-8 place-items-center rounded-full bg-incoming/20 text-sm font-semibold uppercase text-incoming ring-1 ring-incoming/40"
      >
        {Array.from(session.nickname)[0]}
      </span>
    </Link>
  );
}
