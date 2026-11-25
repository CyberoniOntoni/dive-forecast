import { requireSession } from "./auth";
import { appSetting } from "./cloudflare";
import { isModeratorEmail } from "./moderation";
import { reviewEmail } from "./review-account";
import { readStore } from "./store";

/**
 * The signed-in diver's id when they are a moderator (their email is in MODERATOR_EMAILS, never the store-review
 * account, never a banned one); null otherwise. For server actions, after ready().
 */
export async function moderatorId(): Promise<string | null> {
  const session = await requireSession().catch(() => null);
  if (!session) return null;
  const user = readStore().users.find((item) => item.id === session.userId);
  return user && !user.bannedAt && isModeratorEmail(user.email, appSetting("MODERATOR_EMAILS"), reviewEmail()) ? user.id : null;
}
