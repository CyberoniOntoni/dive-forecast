import { BANNED } from "./moderation";
import type { SitePhoto, StoreData, User } from "./types";

/**
 * Sign-in by emailed code, on the store's data: no passwords. A code is good for LOGIN_CODE_TTL_MS and
 * LOGIN_MAX_ATTEMPTS wrong tries; asking again replaces it. Sends are capped per address, per IP address and overall,
 * since anyone can type any address. On D1 the counts hold under parallel requests too: a change made from a stale read
 * is not written (lib/store-d1.ts storeChanges) and runs again. These functions only change the store they are given (lib/store.ts mutateStore).
 */

export const LOGIN_CODE_TTL_MS = 15 * 60 * 1000;
export const LOGIN_MAX_ATTEMPTS = 5;
/** Emails per address per hour. */
export const LOGIN_SENDS_PER_EMAIL = 5;
/** Emails per hour for everyone together: a last resort, since the per-IP limit stops one sender first. */
export const LOGIN_SENDS_PER_HOUR = 200;
/**
 * Emails per hour asked from one IP address (an IPv6 /64). Generous, since a resort's Wi-Fi or a mobile carrier's
 * shared address (carrier-grade NAT) can put many divers behind one address; it stops one sender, not a crowd.
 */
export const LOGIN_SENDS_PER_IP = 30;
const HOUR_MS = 60 * 60 * 1000;

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 20;
export const ABOUT_MAX = 300;

export function normalizeEmail(input: unknown): string {
  const email = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
  return email;
}

/** "About me": plain text, at most ABOUT_MAX characters and one blank line in a row; empty clears it. */
export function requireAbout(input: unknown): string {
  if (input != null && typeof input !== "string") throw new Error("About me must be text.");
  const about = (typeof input === "string" ? input : "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (Array.from(about).length > ABOUT_MAX) throw new Error(`Keep it to ${ABOUT_MAX} characters.`);
  return about;
}

/**
 * A nickname: 2 to 20 letters, digits, spaces, dots, dashes or underscores, unique ignoring case. Never an email,
 * since it is shown to everyone.
 */
export function requireNickname(input: unknown, users: readonly User[], selfId?: string): string {
  const nickname = typeof input === "string" ? input.trim().replace(/\s+/g, " ") : "";
  if (nickname.length < NICKNAME_MIN || nickname.length > NICKNAME_MAX) {
    throw new Error(`Pick a nickname of ${NICKNAME_MIN} to ${NICKNAME_MAX} characters.`);
  }
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(nickname)) {
    throw new Error("Use letters, numbers, spaces, dots, dashes or underscores, starting with a letter or number.");
  }
  const key = nickname.toLowerCase();
  if (users.some((user) => user.id !== selfId && user.nickname.toLowerCase() === key)) {
    throw new Error("That nickname is taken.");
  }
  return nickname;
}

/** A diver by nickname, ignoring case and spaces at the ends (nicknames are unique that way). */
export function userByNickname(store: StoreData, nickname: string): User | null {
  const key = nickname.trim().toLowerCase();
  return store.users.find((user) => user.nickname.toLowerCase() === key) ?? null;
}

export function userByEmail(store: StoreData, email: string): User | null {
  return store.users.find((user) => user.email === email) ?? null;
}

/**
 * Records a new code for `email` (as its hash) and ends any earlier one. Throws when the address or the app has sent
 * too many codes in the last hour. Old entries are dropped once they no longer count toward a limit.
 */
export function startLogin(
  store: StoreData,
  email: string,
  codeHash: string,
  nowMs: number,
  ipKey: string | null = null,
): { newUser: boolean } {
  store.logins = store.logins.filter((login) => nowMs - Date.parse(login.sentAt) < HOUR_MS);
  if (ipKey && store.logins.filter((login) => login.ipKey === ipKey).length >= LOGIN_SENDS_PER_IP) {
    throw new Error("Too many codes asked from this connection. Try again in an hour.");
  }
  if (store.logins.length >= LOGIN_SENDS_PER_HOUR) throw new Error("Too many sign-ins right now. Try again later.");
  const mine = store.logins.filter((login) => login.email === email);
  if (mine.length >= LOGIN_SENDS_PER_EMAIL) throw new Error("Too many codes sent to this address. Try again in an hour.");
  const now = new Date(nowMs).toISOString();
  for (const login of mine) if (Date.parse(login.expiresAt) > nowMs) login.expiresAt = now;
  store.logins.push({
    email,
    codeHash,
    sentAt: now,
    expiresAt: new Date(nowMs + LOGIN_CODE_TTL_MS).toISOString(),
    attempts: 0,
    ...(ipKey ? { ipKey } : {}),
  });
  return { newUser: userByEmail(store, email) == null };
}

export type LoginResult =
  | { ok: true; user: User }
  | { ok: false; error: string; needsNickname?: boolean; needsTerms?: boolean };

/** A sign-in by a diver who has not agreed to the content rules, without the box ticked. */
export const TERMS_NEEDED = "Agree to the content rules and privacy policy to sign in.";

/** Ids of store-review accounts (`User.storeReview`): their reports are app reviewers trying the form, not dives. */
export function storeReviewIds(users: readonly Pick<User, "id" | "storeReview">[]): Set<string> {
  return new Set(users.filter((user) => user.storeReview).map((user) => user.id));
}

/**
 * Reports that count: for the forecast, verify, points, awards and the scoreboard. All but the store-review account's
 * (`User.storeReview`), which are app reviewers trying the form, not dives, and those a moderator hid (`hiddenAt`).
 */
export function countedReports(store: Pick<StoreData, "reports" | "users">): StoreData["reports"] {
  const reviewers = storeReviewIds(store.users);
  return store.reports.filter((report) => !report.hiddenAt && !(report.userId && reviewers.has(report.userId)));
}

/**
 * Checks a code against the address's live one. A right code ends it and signs in; a new address also needs a
 * nickname, and becomes a user. A wrong code counts against the code's tries, so the result is returned, not thrown,
 * for the count to be saved.
 */
export function finishLogin(
  store: StoreData,
  email: string,
  codeHash: string,
  nowMs: number,
  nickname: unknown,
  matches: (stored: string, given: string) => boolean,
  acceptTerms = false,
): LoginResult {
  const live = store.logins.find((login) => login.email === email && Date.parse(login.expiresAt) > nowMs);
  if (!live || live.attempts >= LOGIN_MAX_ATTEMPTS) {
    return { ok: false, error: "That code has expired. Ask for a new one." };
  }
  if (!matches(live.codeHash, codeHash)) {
    live.attempts += 1;
    return {
      ok: false,
      error: live.attempts >= LOGIN_MAX_ATTEMPTS ? "Too many wrong codes. Ask for a new one." : "That code is not right.",
    };
  }
  let user = userByEmail(store, email);
  if (user?.bannedAt) {
    live.expiresAt = new Date(nowMs).toISOString();
    return { ok: false, error: BANNED };
  }
  if (!user) {
    let name: string;
    try {
      name = requireNickname(nickname, store.users);
    } catch (caught) {
      return { ok: false, error: (caught as Error).message, needsNickname: true };
    }
    if (!acceptTerms) return { ok: false, error: TERMS_NEEDED, needsTerms: true };
    user = { id: crypto.randomUUID(), email, nickname: name, createdAt: new Date(nowMs).toISOString() };
    store.users.push(user);
  }
  // Content rules agreed to at the first sign-in, or at the next one for divers from before they existed.
  if (!user.acceptedTermsAt) {
    if (!acceptTerms) return { ok: false, error: TERMS_NEEDED, needsTerms: true };
    user.acceptedTermsAt = new Date(nowMs).toISOString();
  }
  // Kept, expired, so it still counts toward the hour's sends.
  live.expiresAt = new Date(nowMs).toISOString();
  return { ok: true, user };
}

/** deleteAccount's answer when the signed-in diver's account is gone already. */
export const ACCOUNT_GONE = "This account no longer exists.";

/** A photo to delete from storage once the account's rows are gone. */
export type AccountPhoto = { siteId: string; photo: SitePhoto };

/**
 * Deletes a diver's account from the store (PRIVACY: app/privacy/page.tsx § Deleting your account): the user row, its
 * pending sign-in codes, its dive plans, its ratings with their reviews and photos, and the photos it added to sites it
 * added. Two things stay, with nothing that leads back to the diver:
 *
 * - Dive reports, which train the forecast: their userId becomes one new random id that no account has, so the
 *   reports drop off the scoreboard but still count as one diver where the forecast asks how many divers agree.
 * - Sites the diver added, so other divers' reports and reviews there keep their place: `addedBy` goes.
 *
 * Returns the photos whose JPEGs the caller deletes, or null when there is no such user. Safe to run again on a fresh
 * store (mutateStore may retry it).
 */
export function deleteAccountRecords(store: StoreData, userId: string): AccountPhoto[] | null {
  const user = store.users.find((item) => item.id === userId);
  if (!user) return null;
  const photos: AccountPhoto[] = [];

  store.users = store.users.filter((item) => item.id !== userId);
  store.logins = store.logins.filter((login) => login.email !== user.email);
  store.plans = store.plans.filter((plan) => plan.ownerId !== userId);
  // Reports they filed, and reports on their content (which goes too).
  store.flags = store.flags.filter((flag) => flag.reporterId !== userId && flag.userId !== userId);
  for (const other of store.users) {
    if (!other.blocked?.includes(userId)) continue;
    const kept = other.blocked.filter((id) => id !== userId);
    if (kept.length) other.blocked = kept;
    else delete other.blocked;
  }
  store.ratings = store.ratings.filter((rating) => {
    if (rating.userId !== userId) return true;
    for (const photo of rating.photos ?? []) photos.push({ siteId: rating.siteId, photo });
    return false;
  });

  // Dive reports stay, anonymised, to keep teaching the forecast. The store-review account's are reviewers trying the
  // form, and with the user gone nothing would mark them any more (storeReviewIds), so they go with it.
  if (user.storeReview) {
    store.reports = store.reports.filter((report) => report.userId !== userId);
  } else {
    const anonymous = `deleted-${crypto.randomUUID()}`;
    for (const report of store.reports) {
      if (report.userId === userId) report.userId = anonymous;
    }
  }
  for (const site of store.sites) {
    const own = (site.photos ?? []).filter((photo) => photo.addedBy === userId);
    for (const photo of own) photos.push({ siteId: site.id, photo });
    if (own.length) {
      const kept = (site.photos ?? []).filter((photo) => photo.addedBy !== userId);
      if (kept.length) site.photos = kept;
      else delete site.photos;
    }
    if (site.addedBy === userId) {
      // The store-review account's sites are reviewers trying the form: hidden with it, not left on the map.
      if (user.storeReview) site.hidden = true;
      delete site.addedBy;
    }
  }
  return photos;
}
