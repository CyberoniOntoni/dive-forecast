import { normalizeEmail } from "./accounts";
import { appSetting } from "./cloudflare";

/**
 * The store-review account (Google Play's "Sign in details"): reviewers cannot read an inbox, so one fixed address,
 * REVIEW_EMAIL, signs in with one fixed six-digit code, REVIEW_CODE, both worker secrets. Asking for a code for that
 * address records REVIEW_CODE as its code and sends no email; everything else is the normal sign-in (15 minutes,
 * 5 tries, the hourly send limits, the content rules box). The account is an ordinary diver: it is never a moderator,
 * whatever MODERATOR_EMAILS says. Deleting either secret turns it off.
 */

/** The review address, normalized, or null when the review account is off (either secret missing or malformed). */
export function reviewEmail(): string | null {
  const email = appSetting("REVIEW_EMAIL");
  const code = appSetting("REVIEW_CODE");
  if (!email || !code || !/^\d{6}$/.test(code.trim())) return null;
  try {
    return normalizeEmail(email);
  } catch {
    return null;
  }
}

/** REVIEW_CODE when `email` (normalized) is the review address; null for every other address. */
export function reviewCodeFor(email: string): string | null {
  const review = reviewEmail();
  return review != null && email === review ? (appSetting("REVIEW_CODE") ?? "").trim() : null;
}
