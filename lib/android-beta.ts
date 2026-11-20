/**
 * The invitation to the Android app's closed test on Google Play (the header strip and /android).
 *
 * Google Play lets only listed testers in, so a visitor first gets on the list and then opts in. How they get on it
 * depends on how the closed test is set up in Play Console, so it is a setting, ANDROID_BETA_JOIN:
 * - the https link of the testers' Google Group (Play Console > Testing > Closed testing > Testers > Google Groups): the
 *   visitor joins the group;
 * - "email": the testers are an email list kept by hand, and the visitor emails their Google account address to support;
 * - unset (or anything else): there is no open beta, and the invitation and /android are hidden.
 */

import { appSetting } from "@/lib/cloudflare";

/** The Play package; it can never change after the first release (android/app/build.gradle.kts applicationId). */
export const ANDROID_PACKAGE = "app.fiftybar";
/** Where a listed tester accepts the invitation ("Become a tester"). */
export const PLAY_OPT_IN_URL = `https://play.google.com/apps/testing/${ANDROID_PACKAGE}`;
/** The store page, where an accepted tester installs the app. */
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;
/** Where testers send their address (email list) and their feedback. */
export const BETA_EMAIL = "support@50bar.app";

export type AndroidBeta = { join: "email" } | { join: "group"; groupUrl: string };

/** Reads an ANDROID_BETA_JOIN value; null means no open beta. */
export function parseAndroidBeta(value: string | null | undefined): AndroidBeta | null {
  const text = value?.trim();
  if (!text) return null;
  if (text.toLowerCase() === "email") return { join: "email" };
  try {
    const url = new URL(text);
    if (url.protocol !== "https:") return null;
    return { join: "group", groupUrl: url.toString() };
  } catch {
    return null;
  }
}

/** The beta as set up now (worker secret or var, or the process environment on Node), or null when there is none. */
export function androidBeta(): AndroidBeta | null {
  return parseAndroidBeta(appSetting("ANDROID_BETA_JOIN"));
}

/** The mailto link a would-be tester uses to ask to be put on the list. */
export function betaSignupMailto(): string {
  const subject = "50Bar Android beta";
  const body = "Please add me to the 50Bar Android beta. The Google account I use on my phone is: ";
  return `mailto:${BETA_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
