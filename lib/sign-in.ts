/** Shared with client components, so nothing here reads cookies or settings. */

/** The error every gated action throws for a signed-out visitor (lib/auth.ts requireSession). */
export const SIGN_IN_FIRST = "Sign in first.";

/** `next` when it is a path on this site, else "/": nothing may send a diver elsewhere after signing in. */
export function localPath(next: unknown): string {
  return typeof next === "string" && /^\/(?!\/)[^\s\\]*$/.test(next) ? next : "/";
}

/** The sign-in page, coming back to `next` (a path on this site) afterwards. */
export function signInHref(next: string): string {
  return `/login?${new URLSearchParams({ next })}`;
}
