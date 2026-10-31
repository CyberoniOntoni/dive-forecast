import type { StoreData, User } from "./types";

/**
 * Sign-in by emailed code, on the store's data: no passwords. A code is good for LOGIN_CODE_TTL_MS and
 * LOGIN_MAX_ATTEMPTS wrong tries; asking again replaces it. Sends are capped per address and overall, since anyone can
 * type any address. These functions only change the store they are given (lib/store.ts mutateStore).
 */

export const LOGIN_CODE_TTL_MS = 15 * 60 * 1000;
export const LOGIN_MAX_ATTEMPTS = 5;
/** Emails per address per hour. */
export const LOGIN_SENDS_PER_EMAIL = 5;
/** Emails per hour for everyone together. */
export const LOGIN_SENDS_PER_HOUR = 200;
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

export function userByEmail(store: StoreData, email: string): User | null {
  return store.users.find((user) => user.email === email) ?? null;
}

/**
 * Records a new code for `email` (as its hash) and ends any earlier one. Throws when the address or the app has sent
 * too many codes in the last hour. Old entries are dropped once they no longer count toward a limit.
 */
export function startLogin(store: StoreData, email: string, codeHash: string, nowMs: number): { newUser: boolean } {
  store.logins = store.logins.filter((login) => nowMs - Date.parse(login.sentAt) < HOUR_MS);
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
  });
  return { newUser: userByEmail(store, email) == null };
}

export type LoginResult =
  | { ok: true; user: User }
  | { ok: false; error: string; needsNickname?: boolean };

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
  if (!user) {
    let name: string;
    try {
      name = requireNickname(nickname, store.users);
    } catch (caught) {
      return { ok: false, error: (caught as Error).message, needsNickname: true };
    }
    user = { id: crypto.randomUUID(), email, nickname: name, createdAt: new Date(nowMs).toISOString() };
    store.users.push(user);
  }
  // Kept, expired, so it still counts toward the hour's sends.
  live.expiresAt = new Date(nowMs).toISOString();
  return { ok: true, user };
}
