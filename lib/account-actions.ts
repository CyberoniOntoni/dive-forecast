"use server";

import { finishLogin, normalizeEmail, requireNickname, startLogin } from "./accounts";
import {
  appUrl,
  authSecret,
  clearSessionCookie,
  currentSession,
  mailgunConfig,
  requireSession,
  setSessionCookie,
} from "./auth";
import { sendLoginEmail } from "./mailgun";
import { diverStats, leaderboard, type DiverStats, type LeaderboardPeriod } from "./points";
import { BADGES, type BadgeId } from "./points-rules";
import { ready } from "./ready";
import { hashLoginCode, newLoginCode, sameText } from "./session-token";
import { listMergedSites, mutateStore, readStore } from "./store";

export type SignInStep = { ok: boolean; error: string | null; newUser?: boolean; needsNickname?: boolean };

const NOT_SET_UP = "Signing in is not set up on this server yet.";

/** Emails a six-digit code (and a link that fills it in) to the address. */
export async function requestSignIn(emailInput: unknown, next?: unknown): Promise<SignInStep> {
  await ready();
  try {
    const email = normalizeEmail(emailInput);
    const secret = authSecret();
    const mail = mailgunConfig();
    if (!secret) return { ok: false, error: NOT_SET_UP };
    if (!mail && process.env.NODE_ENV === "production") return { ok: false, error: NOT_SET_UP };

    const code = newLoginCode();
    const codeHash = await hashLoginCode(email, code, secret);
    const { newUser } = await mutateStore((store) => startLogin(store, email, codeHash, Date.now()));
    const base = await appUrl();
    const link = base ? `${base}/login?${new URLSearchParams({ email, code, next: safeNext(next) })}` : null;
    if (mail) {
      await sendLoginEmail(mail, { to: email, code, link }).catch((error) => {
        console.error("Sign-in email failed", error);
        throw new Error("Could not send the email. Try again in a minute.");
      });
    } else {
      // Development only (production returned above): there is no mail server, so the code goes to the server log.
      console.info(`[sign-in] code for ${email}: ${code}${link ? ` (${link})` : ""}`);
    }
    return { ok: true, error: null, newUser };
  } catch (caught) {
    return { ok: false, error: caught instanceof Error ? caught.message : "Could not send a code." };
  }
}

/** Checks the code; a new address also picks its nickname here. Sets the session cookie. */
export async function completeSignIn(input: { email: unknown; code: unknown; nickname?: unknown }): Promise<SignInStep> {
  await ready();
  try {
    const email = normalizeEmail(input?.email);
    const code = typeof input?.code === "string" ? input.code.replace(/\D/g, "") : "";
    if (code.length !== 6) return { ok: false, error: "Enter the 6-digit code from the email." };
    const secret = authSecret();
    if (!secret) return { ok: false, error: NOT_SET_UP };
    const codeHash = await hashLoginCode(email, code, secret);
    const result = await mutateStore((store) => finishLogin(store, email, codeHash, Date.now(), input?.nickname, sameText));
    if (!result.ok) return { ok: false, error: result.error, needsNickname: result.needsNickname };
    await setSessionCookie(result.user.id, result.user.nickname);
    return { ok: true, error: null };
  } catch (caught) {
    return { ok: false, error: caught instanceof Error ? caught.message : "Could not sign in." };
  }
}

export async function signOut(): Promise<void> {
  await clearSessionCookie();
}

/** The signed-in diver's nickname for the header, from the cookie alone. */
export async function whoAmI(): Promise<{ nickname: string } | null> {
  const session = await currentSession();
  return session ? { nickname: session.nickname } : null;
}

export async function changeNickname(input: unknown): Promise<{ ok: boolean; error: string | null; nickname?: string }> {
  await ready();
  try {
    const session = await requireSession();
    const nickname = await mutateStore((store) => {
      const user = store.users.find((item) => item.id === session.userId);
      if (!user) throw new Error("This account no longer exists.");
      user.nickname = requireNickname(input, store.users, user.id);
      return user.nickname;
    });
    await setSessionCookie(session.userId, nickname);
    return { ok: true, error: null, nickname };
  } catch (caught) {
    return { ok: false, error: caught instanceof Error ? caught.message : "Could not change the nickname." };
  }
}

export type BadgeView = { id: BadgeId; label: string; detail: string; earned: boolean };

export type AccountView = {
  nickname: string;
  email: string;
  stats: Omit<DiverStats, "userId" | "badges">;
  badges: BadgeView[];
  monthRank: number | null;
  allRank: number | null;
};

/** The signed-in diver's own page: the email is shown only here, to them. Null when signed out. */
export async function getAccount(): Promise<AccountView | null> {
  await ready();
  const session = await currentSession();
  if (!session) return null;
  const store = readStore();
  const user = store.users.find((item) => item.id === session.userId);
  if (!user) return null;
  const all = diverStats(store.reports, store.users, listMergedSites());
  const mine = all.find((item) => item.userId === user.id);
  const earned = new Set(mine?.badges ?? []);
  return {
    nickname: user.nickname,
    email: user.email,
    stats: {
      nickname: user.nickname,
      points: mine?.points ?? 0,
      monthPoints: mine?.monthPoints ?? 0,
      reports: mine?.reports ?? 0,
      sites: mine?.sites ?? 0,
      atolls: mine?.atolls ?? 0,
      bestStreak: mine?.bestStreak ?? 0,
    },
    badges: BADGES.map((badge) => ({ ...badge, earned: earned.has(badge.id) })),
    monthRank: leaderboard(all, "month").find((row) => row.userId === user.id)?.rank ?? null,
    allRank: leaderboard(all, "all").find((row) => row.userId === user.id)?.rank ?? null,
  };
}

export type LeaderboardRow = {
  rank: number;
  nickname: string;
  points: number;
  reports: number;
  sites: number;
  badges: number;
  isMe: boolean;
};

const LEADERBOARD_SIZE = 50;

/** The top divers by points for this month or all time. Nicknames only. */
export async function getLeaderboard(periodInput: unknown): Promise<LeaderboardRow[]> {
  await ready();
  const period: LeaderboardPeriod = periodInput === "all" ? "all" : "month";
  const session = await currentSession();
  const store = readStore();
  return leaderboard(diverStats(store.reports, store.users, listMergedSites()), period)
    .slice(0, LEADERBOARD_SIZE)
    .map((row) => ({
      rank: row.rank,
      nickname: row.nickname,
      points: row.periodPoints,
      reports: row.reports,
      sites: row.sites,
      badges: row.badges.length,
      isMe: row.userId === session?.userId,
    }));
}

/** Where to go after signing in: a path on this site only. */
function safeNext(next: unknown): string {
  return typeof next === "string" && /^\/(?!\/)[^\s\\]*$/.test(next) ? next : "/";
}
