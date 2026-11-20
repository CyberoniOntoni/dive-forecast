import { connection } from "next/server";
import { BetaInviteStrip } from "@/components/BetaInviteStrip";
import { androidBeta } from "@/lib/android-beta";

/**
 * The Android beta invitation under the header, only while a beta is set up (ANDROID_BETA_JOIN, lib/android-beta.ts).
 * The setting is read per request: a prerendered page would keep whatever the build saw.
 */
export async function BetaInvite() {
  await connection();
  if (!androidBeta()) return null;
  return <BetaInviteStrip />;
}
