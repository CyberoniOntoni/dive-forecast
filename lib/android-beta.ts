/**
 * The invitation to the Android app's closed test on Google Play (the header strip and /android). Google Play lets in
 * only listed testers: the testers list is the Google Group below, so a visitor joins the group, then opts in, then
 * installs. Take the strip out of app/layout.tsx when the app is public.
 */

/** The Play package; it can never change after the first release (android/app/build.gradle.kts applicationId). */
export const ANDROID_PACKAGE = "app.fiftybar";
/** The testers list in Play Console (Testing > Closed testing > Testers). */
export const TESTERS_GROUP_URL = "https://groups.google.com/g/50bar";
/** Joining by email, for those without the Groups page. */
export const TESTERS_GROUP_EMAIL = "50bar@googlegroups.com";
/** Where a group member accepts the invitation ("Become a tester"); it works only after joining the group. */
export const PLAY_OPT_IN_URL = `https://play.google.com/apps/testing/${ANDROID_PACKAGE}`;
/** The store page, where an accepted tester installs the app. */
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;
/** Bugs, odd forecasts and ideas. */
export const BETA_EMAIL = "support@50bar.app";
/** Google asks for at least 12 testers who stay in the closed test this many days before the app can go public. */
export const TEST_DAYS = 14;
