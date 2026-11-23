import { FLAG_KINDS, FLAG_REASONS, type ContentFlag, type FlagKind, type FlagReason, type SitePhoto, type StoreData, type User } from "./types";

/**
 * Google Play's rules for user-generated content (and our own, at /terms): divers agree to the content rules before
 * they post, can report content and divers and block divers, and moderators act on reports. These are the store
 * changes; lib/moderation-actions.ts runs them for the signed-in diver.
 */

/** A write that posts content for others to see, by a diver who has not agreed to the content rules yet. */
export const TERMS_FIRST = "Agree to the content rules first (your account page).";
/** A banned diver's sign-in. */
export const BANNED = "This account is suspended for breaking the content rules.";

export const FLAG_NOTE_MAX = 500;
/** Reports one diver can file in 24 hours. */
export const FLAGS_PER_DAY = 20;
/** Divers one diver can block. */
export const BLOCKS_MAX = 500;

export const FLAG_REASON_LABELS: Record<FlagReason, string> = {
  sexual: "Nudity or sexual content",
  violence: "Violence or gore",
  hate: "Hate, harassment or bullying",
  spam: "Spam or advertising",
  privacy: "Someone's private information",
  illegal: "Illegal or dangerous",
  other: "Something else",
};

/**
 * What Remove does to each kind of content (removeFlagged), as the feed's button on /moderation says it. Here, not in
 * lib/activity.ts, because a client component reads it and lib/activity.ts pulls in the forecast code.
 */
export const REMOVE_LABELS: Record<FlagKind, string> = { review: "Remove review", site: "Hide site", diver: "Reset profile" };

export function hasAcceptedTerms(user: Pick<User, "acceptedTermsAt"> | null | undefined): boolean {
  return Boolean(user?.acceptedTermsAt);
}

/** Throws TERMS_FIRST unless the diver has agreed to the content rules. */
export function requireTermsAccepted(store: StoreData, userId: string): void {
  const user = store.users.find((item) => item.id === userId);
  if (!hasAcceptedTerms(user)) throw new Error(TERMS_FIRST);
}

export type FlagInput = { kind: FlagKind; siteId?: string; userId?: string; reason: FlagReason; note?: string };

/** Reads a report from a request: a known kind and reason, the ids it needs, a note of at most FLAG_NOTE_MAX. */
export function readFlagInput(input: unknown): FlagInput {
  const record = (input ?? {}) as Record<string, unknown>;
  const kind = FLAG_KINDS.find((item) => item === record.kind);
  if (!kind) throw new Error("Say what you are reporting.");
  const reason = FLAG_REASONS.find((item) => item === record.reason);
  if (!reason) throw new Error("Pick a reason.");
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
  const note = text(record.note);
  if (note && note.length > FLAG_NOTE_MAX) throw new Error(`Keep the note to ${FLAG_NOTE_MAX} characters.`);
  const siteId = text(record.siteId);
  const userId = text(record.userId);
  if (kind !== "diver" && !siteId) throw new Error("Say which site.");
  if (kind !== "site" && !userId) throw new Error("Say which diver.");
  return { kind, reason, ...(siteId ? { siteId } : {}), ...(userId ? { userId } : {}), ...(note ? { note } : {}) };
}

/**
 * Files a report, filling in whose content it is from the store. "missing" when there is no such content, "own" for
 * one's own, "duplicate" when this diver already has an open report on it, "limit" past FLAGS_PER_DAY.
 */
export function addFlag(
  store: StoreData,
  reporterId: string,
  input: FlagInput,
  nowMs: number,
): { result: "saved"; flag: ContentFlag } | { result: "missing" | "own" | "duplicate" | "limit" } {
  let owner: string | undefined;
  if (input.kind === "review") {
    const rating = store.ratings.find((item) => item.siteId === input.siteId && item.userId === input.userId && !item.removedAt);
    if (!rating || (!rating.review && !rating.photos?.length)) return { result: "missing" };
    owner = rating.userId;
  } else if (input.kind === "site") {
    const site = store.sites.find((item) => item.id === input.siteId && !item.hidden);
    if (!site) return { result: "missing" };
    owner = site.addedBy;
  } else {
    if (!store.users.some((user) => user.id === input.userId && !user.bannedAt)) return { result: "missing" };
    owner = input.userId;
  }
  if (owner && owner === reporterId) return { result: "own" };
  const same = (flag: ContentFlag) =>
    flag.reporterId === reporterId && !flag.resolvedAt && flag.kind === input.kind && flag.siteId === input.siteId && flag.userId === owner;
  if (store.flags.some(same)) return { result: "duplicate" };
  const since = nowMs - 24 * 60 * 60 * 1000;
  const today = store.flags.filter((flag) => flag.reporterId === reporterId && Date.parse(flag.createdAt) > since);
  if (today.length >= FLAGS_PER_DAY) return { result: "limit" };
  const flag: ContentFlag = {
    id: crypto.randomUUID(),
    reporterId,
    kind: input.kind,
    ...(input.siteId && input.kind !== "diver" ? { siteId: input.siteId } : {}),
    ...(owner ? { userId: owner } : {}),
    reason: input.reason,
    ...(input.note ? { note: input.note } : {}),
    createdAt: new Date(nowMs).toISOString(),
  };
  store.flags.push(flag);
  return { result: "saved", flag };
}

/** Blocks or unblocks a diver for this one. Returns false when either diver is unknown or it is oneself. */
export function setBlocked(store: StoreData, userId: string, targetId: string, blocked: boolean): boolean {
  const user = store.users.find((item) => item.id === userId);
  if (!user || userId === targetId || !store.users.some((item) => item.id === targetId)) return false;
  const list = (user.blocked ?? []).filter((id) => id !== targetId);
  if (blocked) {
    if (list.length >= BLOCKS_MAX) throw new Error(`You can block at most ${BLOCKS_MAX} divers.`);
    list.push(targetId);
  }
  if (list.length) user.blocked = list;
  else delete user.blocked;
  return true;
}

/** Who this diver blocked; empty when signed out. */
export function blockedIds(store: StoreData, userId: string | null | undefined): Set<string> {
  if (!userId) return new Set();
  return new Set(store.users.find((user) => user.id === userId)?.blocked ?? []);
}

/** A photo to delete from storage once the rows naming it are gone. */
export type StoredPhoto = { siteId: string; photo: SitePhoto };

/** Takes a review and its photos down (the rating row stays as removed, like the diver's own "Remove"). */
function removeReview(store: StoreData, siteId: string, userId: string, nowIso: string): StoredPhoto[] {
  const rating = store.ratings.find((item) => item.siteId === siteId && item.userId === userId && !item.removedAt);
  if (!rating) return [];
  const photos = (rating.photos ?? []).map((photo) => ({ siteId, photo }));
  rating.firstRatedAt ??= rating.updatedAt;
  rating.removedAt = nowIso;
  rating.updatedAt = nowIso;
  delete rating.review;
  delete rating.photos;
  return photos;
}

/** Hides a site added in the app and drops its photos and notes. */
function removeSite(store: StoreData, siteId: string): StoredPhoto[] {
  const site = store.sites.find((item) => item.id === siteId && item.sourceUrl === "user");
  if (!site) return [];
  const photos = (site.photos ?? []).map((photo) => ({ siteId, photo }));
  site.hidden = true;
  delete site.photos;
  delete site.howToDive;
  return photos;
}

/** Clears a diver's About me and gives them a plain nickname in place of one that broke the rules. */
function resetProfile(store: StoreData, userId: string): void {
  const user = store.users.find((item) => item.id === userId);
  if (!user) return;
  delete user.about;
  let name = "";
  do name = `Diver ${crypto.randomUUID().slice(0, 6)}`;
  while (store.users.some((item) => item.nickname.toLowerCase() === name.toLowerCase()));
  user.nickname = name;
}

/** Takes down what a report is about. Returns the photos to delete. */
export function removeFlagged(store: StoreData, flag: Pick<ContentFlag, "kind" | "siteId" | "userId">, nowIso: string): StoredPhoto[] {
  if (flag.kind === "review" && flag.siteId && flag.userId) return removeReview(store, flag.siteId, flag.userId, nowIso);
  if (flag.kind === "site" && flag.siteId) return removeSite(store, flag.siteId);
  if (flag.kind === "diver" && flag.userId) resetProfile(store, flag.userId);
  return [];
}

/**
 * Bans a diver: signs them out everywhere, refuses their sign-in from now on, and removes every review, photo and site
 * they posted and their profile text. Their dive reports stay. Returns the photos to delete.
 */
export function banDiver(store: StoreData, userId: string, nowMs: number): StoredPhoto[] | null {
  const user = store.users.find((item) => item.id === userId);
  if (!user) return null;
  const nowIso = new Date(nowMs).toISOString();
  user.bannedAt = nowIso;
  user.sessionsValidFrom = nowMs;
  const photos: StoredPhoto[] = [];
  for (const rating of store.ratings.filter((item) => item.userId === userId && !item.removedAt)) {
    photos.push(...removeReview(store, rating.siteId, userId, nowIso));
  }
  for (const site of store.sites.filter((item) => item.addedBy === userId && !item.hidden)) {
    photos.push(...removeSite(store, site.id));
  }
  resetProfile(store, userId);
  return photos;
}

/**
 * Why a moderator may not ban this diver, or null when they may: not oneself, not a diver already banned or gone, and
 * never the store-review account, whose sign-in details are written down in Play Console (CLOUDFLARE.md § Store-review
 * account: a ban would lock out the next review). The one rule for the buttons and the server alike.
 */
export function banRefusal(store: StoreData, userId: string | undefined, moderatorId: string): string | null {
  if (!userId) return "No diver to ban.";
  if (userId === moderatorId) return "You cannot ban yourself.";
  const user = store.users.find((item) => item.id === userId);
  if (!user) return "That diver is gone.";
  if (user.storeReview) return "The store-review account cannot be banned.";
  if (user.bannedAt) return "That diver is already banned.";
  return null;
}

/** The content a report, or a moderator acting from the activity feed, names. */
export type ModeratedContent = Pick<ContentFlag, "kind" | "siteId" | "userId">;

/**
 * A moderator's Remove or Ban on some content, with or without a report: bans its diver (banRefusal first, and throws
 * its reason) or takes it down, then closes every open report on it. Returns the photos to delete.
 */
export function moderate(store: StoreData, content: ModeratedContent, action: "remove" | "ban", moderatorId: string, nowMs: number): StoredPhoto[] {
  const nowIso = new Date(nowMs).toISOString();
  if (action === "ban") {
    const refusal = banRefusal(store, content.userId, moderatorId);
    if (refusal) throw new Error(refusal);
    const removed = banDiver(store, content.userId!, nowMs) ?? [];
    resolveFlags(store, content, "banned", nowIso);
    return removed;
  }
  const removed = removeFlagged(store, content, nowIso);
  resolveFlags(store, content, "removed", nowIso);
  return removed;
}

/** Closes every open report on the same content as `flag` with this resolution. */
export function resolveFlags(store: StoreData, flag: Pick<ContentFlag, "kind" | "siteId" | "userId">, resolution: NonNullable<ContentFlag["resolution"]>, nowIso: string): void {
  for (const item of store.flags) {
    if (item.resolvedAt) continue;
    const sameContent = item.kind === flag.kind && item.siteId === flag.siteId && item.userId === flag.userId;
    const sameDiver = resolution === "banned" && item.userId === flag.userId;
    if (sameContent || sameDiver) {
      item.resolvedAt = nowIso;
      item.resolution = resolution;
    }
  }
}

/**
 * Moderators: the signed-in divers whose email is in MODERATOR_EMAILS (comma-separated). Never the store-review
 * account (`reviewEmail`, lib/review-account.ts), whose code is written down in Play Console.
 */
export function isModeratorEmail(email: string, setting: string | null, reviewEmail: string | null = null): boolean {
  if (!setting) return false;
  if (reviewEmail && email.toLowerCase() === reviewEmail) return false;
  return setting
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}
