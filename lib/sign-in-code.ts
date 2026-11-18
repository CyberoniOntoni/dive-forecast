import { finishLogin, normalizeEmail } from "./accounts";
import { reviewEmail } from "./review-account";
import { authSecret } from "./auth";
import { hashLoginCode, sameText } from "./session-token";
import { mutateStore } from "./store";
import type { User } from "./types";

/** Signing in with no AUTH_SECRET set. */
export const NOT_SET_UP = "Signing in is not set up on this server yet.";

export type CodeCheck = { ok: true; user: User } | { ok: false; error: string; needsNickname?: boolean; needsTerms?: boolean };

/**
 * Checks an emailed code (a new address also picks its nickname here) for the web's cookie and the app's token
 * alike. Not a server action: the caller decides how the diver is then signed in. Wrong input is an error, not a throw.
 */
export async function checkSignInCode(input: {
  email: unknown;
  code: unknown;
  nickname?: unknown;
  /** The "I agree to the content rules" box: needed at a first sign-in, and once from divers who signed up before. */
  acceptTerms?: unknown;
}): Promise<CodeCheck> {
  const email = normalizeEmail(input?.email);
  const code = typeof input?.code === "string" ? input.code.replace(/\D/g, "") : "";
  if (code.length !== 6) return { ok: false, error: "Enter the 6-digit code from the email." };
  const secret = authSecret();
  if (!secret) return { ok: false, error: NOT_SET_UP };
  const codeHash = await hashLoginCode(email, code, secret);
  // The store-review address only ever has the review code (lib/review-account.ts): mark that user for good.
  const review = email === reviewEmail();
  const result = await mutateStore((store) => {
    const login = finishLogin(store, email, codeHash, Date.now(), input?.nickname, sameText, input?.acceptTerms === true);
    if (login.ok && review) login.user.storeReview = true;
    return login;
  });
  if (!result.ok) {
    return { ok: false, error: result.error ?? "Could not sign in.", needsNickname: result.needsNickname, needsTerms: result.needsTerms };
  }
  return { ok: true, user: result.user };
}
