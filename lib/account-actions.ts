"use server";

import { normalizeEmail, requireAbout, requireNickname, startLogin } from "./accounts";
import {
  appUrl,
  authSecret,
  clearSessionCookie,
  currentSession,
  issueAppToken,
  requestIpKey,
  requireSession,
  setSessionCookie,
} from "./auth";
import { mailRoutes, sendLoginEmail } from "./email";
import { diverStats, leaderboard, type DiverStats, type LeaderboardPeriod } from "./points";
import { BADGES, type BadgeId } from "./points-rules";
import { ready } from "./ready";
import { siteScouts } from "./site-scouts";
import { hashLoginCode, newLoginCode } from "./session-token";
import { checkSignInCode, NOT_SET_UP } from "./sign-in-code";
import { localPath } from "./sign-in";
import { listMergedSites, mutateStore, readStore } from "./store";
import type { StoreData } from "./types";

export type SignInStep = { ok: boolean; error: string | null; newUser?: boolean; needsNickname?: boolean };


/**
 * Emails a six-digit code (and a link that fills it in) to the address. `codeOnly` leaves the link out: the app asks
 * for the code, and the link would sign the phone's browser in instead, using up the code.
 */
export async function requestSignIn(emailInput: unknown, next?: unknown, codeOnly?: unknown): Promise<SignInStep> {
  await ready();
  try {
    const email = normalizeEmail(emailInput);
    const secret = authSecret();
    const routes = mailRoutes();
    if (!secret) return { ok: false, error: NOT_SET_UP };
    if (routes.length === 0 && process.env.NODE_ENV === "production") return { ok: false, error: NOT_SET_UP };

    const code = newLoginCode();
    const codeHash = await hashLoginCode(email, code, secret);
    const ipKey = await requestIpKey(secret);
    const { newUser } = await mutateStore((store) => startLogin(store, email, codeHash, Date.now(), ipKey));
    const base = await appUrl();
    const link = base && codeOnly !== true ? `${base}/login?${new URLSearchParams({ email, code, next: localPath(next) })}` : null;
    if (routes.length > 0) {
      await sendLoginEmail(routes, { to: email, code, link }).catch(() => {
        throw new Error("Could not send the email. Try again in a minute.");
      });
    } else {
      // Development only (production returned above): no email route is set up, so the code goes to the server log.
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
    const result = await checkSignInCode(input);
    if (!result.ok) return { ok: false, error: result.error, needsNickname: result.needsNickname };
    await setSessionCookie(result.user.id, result.user.nickname);
    return { ok: true, error: null };
  } catch (caught) {
    return { ok: false, error: caught instanceof Error ? caught.message : "Could not sign in." };
  }
}

export type AppSignInStep = SignInStep & { token?: string; nickname?: string; expiresAt?: number };

/**
 * The app's sign-in (POST /api/v1/sign-in/token): the same code check as completeSignIn, answered with the app's
 * encrypted bearer token instead of a cookie.
 */
export async function completeAppSignIn(input: { email: unknown; code: unknown; nickname?: unknown }): Promise<AppSignInStep> {
  await ready();
  try {
    const result = await checkSignInCode(input);
    if (!result.ok) return { ok: false, error: result.error, needsNickname: result.needsNickname };
    const { token, expiresAt } = await issueAppToken(result.user.id, result.user.nickname);
    return { ok: true, error: null, token, nickname: result.user.nickname, expiresAt };
  } catch (caught) {
    return { ok: false, error: caught instanceof Error ? caught.message : "Could not sign in." };
  }
}

export async function signOut(): Promise<void> {
  await clearSessionCookie();
}

/** Ends every session of the signed-in diver, on every device, this one included. */
export async function signOutEverywhere(): Promise<{ ok: boolean; error: string | null }> {
  await ready();
  try {
    const session = await requireSession();
    await mutateStore((store) => {
      const user = store.users.find((item) => item.id === session.userId);
      if (!user) throw new Error("This account no longer exists.");
      user.sessionsValidFrom = Date.now();
    });
    await clearSessionCookie();
    return { ok: true, error: null };
  } catch (caught) {
    return { ok: false, error: caught instanceof Error ? caught.message : "Could not sign out everywhere." };
  }
}

/** The signed-in diver's nickname for the header, from the cookie (and the store, for "Sign out everywhere"). */
export async function whoAmI(): Promise<{ nickname: string } | null> {
  await ready();
  const session = await currentSession();
  return session ? { nickname: session.nickname } : null;
}

/** Renames the signed-in diver. The web's cookie carries the nickname, so it is set again; the app's API passes `cookie: false`. */
export async function changeNickname(input: unknown, options?: { cookie?: boolean }): Promise<{ ok: boolean; error: string | null; nickname?: string }> {
  await ready();
  try {
    const session = await requireSession();
    const nickname = await mutateStore((store) => {
      const user = store.users.find((item) => item.id === session.userId);
      if (!user) throw new Error("This account no longer exists.");
      user.nickname = requireNickname(input, store.users, user.id);
      return user.nickname;
    });
    if (options?.cookie !== false) await setSessionCookie(session.userId, nickname);
    return { ok: true, error: null, nickname };
  } catch (caught) {
    return { ok: false, error: caught instanceof Error ? caught.message : "Could not change the nickname." };
  }
}

/** Saves the signed-in diver's "About me" (empty clears it). */
export async function changeAbout(input: unknown): Promise<{ ok: boolean; error: string | null; about?: string }> {
  await ready();
  try {
    const session = await requireSession();
    const about = requireAbout(input);
    await mutateStore((store) => {
      const user = store.users.find((item) => item.id === session.userId);
      if (!user) throw new Error("This account no longer exists.");
      if (about) user.about = about;
      else delete user.about;
    });
    return { ok: true, error: null, about };
  } catch (caught) {
    return { ok: false, error: caught instanceof Error ? caught.message : "Could not save About me." };
  }
}

export type BadgeView = { id: BadgeId; label: string; detail: string; earned: boolean };

/** A diver's numbers, for their own account page and their public page. */
export type DiverNumbers = Omit<DiverStats, "userId" | "nickname" | "badges">;

function allDiverStats(store: StoreData): DiverStats[] {
  return diverStats(store.reports, store.users, listMergedSites(), Date.now(), store.ratings);
}

/** One diver's numbers, every badge (earned or not) and their ranks, worked out from the whole store. */
function diverSummary(store: StoreData, userId: string) {
  const all = allDiverStats(store);
  const mine = all.find((item) => item.userId === userId);
  const earned = new Set(mine?.badges ?? []);
  const stats: DiverNumbers = {
    points: mine?.points ?? 0,
    monthPoints: mine?.monthPoints ?? 0,
    reports: mine?.reports ?? 0,
    ratings: mine?.ratings ?? 0,
    sites: mine?.sites ?? 0,
    atolls: mine?.atolls ?? 0,
    bestStreak: mine?.bestStreak ?? 0,
  };
  return {
    stats,
    badges: BADGES.map((badge): BadgeView => ({ ...badge, earned: earned.has(badge.id) })),
    monthRank: leaderboard(all, "month").find((row) => row.userId === userId)?.rank ?? null,
    allRank: leaderboard(all, "all").find((row) => row.userId === userId)?.rank ?? null,
  };
}

export type AccountView = {
  userId: string;
  nickname: string;
  email: string;
  about: string;
  stats: DiverNumbers;
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
  return { userId: user.id, nickname: user.nickname, email: user.email, about: user.about ?? "", ...diverSummary(store, user.id) };
}

export type LeaderboardRow = {
  userId: string;
  rank: number;
  nickname: string;
  points: number;
  reports: number;
  ratings: number;
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
  return leaderboard(allDiverStats(store), period)
    .slice(0, LEADERBOARD_SIZE)
    .map((row) => ({
      userId: row.userId,
      rank: row.rank,
      nickname: row.nickname,
      points: row.periodPoints,
      reports: row.reports,
      ratings: row.ratings,
      sites: row.sites,
      badges: row.badges.length,
      isMe: row.userId === session?.userId,
    }));
}

export type SiteScoutRow = { userId: string; rank: number; nickname: string; sites: number; reportedByOthers: number; isMe: boolean };
export type NewSiteRow = { id: string; name: string; userId: string; nickname: string };

const NEW_SITES = 8;

/** Divers ranked by the dive sites they added, and the newest sites with who added them. Nicknames only. */
export async function getSiteScouts(): Promise<{ scouts: SiteScoutRow[]; newest: NewSiteRow[] }> {
  await ready();
  const session = await currentSession();
  const store = readStore();
  const nickname = new Map(store.users.map((user) => [user.id, user.nickname]));
  const scouts = siteScouts(store.sites, store.users, store.reports)
    .slice(0, LEADERBOARD_SIZE)
    .map((row) => ({
      userId: row.userId,
      rank: row.rank,
      nickname: row.nickname,
      sites: row.sites,
      reportedByOthers: row.reportedByOthers,
      isMe: row.userId === session?.userId,
    }));
  // Store order is the order sites were added.
  const newest = store.sites
    .filter((site) => site.addedBy && !site.hidden && nickname.has(site.addedBy))
    .slice(-NEW_SITES)
    .reverse()
    .map((site) => ({ id: site.id, name: site.name, userId: site.addedBy!, nickname: nickname.get(site.addedBy!)! }));
  return { scouts, newest };
}

export type DiverProfile = {
  nickname: string;
  about: string;
  /** "YYYY-MM" the diver signed up. */
  since: string;
  stats: DiverNumbers;
  sitesAdded: number;
  allRank: number | null;
  /** Earned badges only. */
  badges: BadgeView[];
  isMe: boolean;
};

/** A diver's public page: nickname, About me, numbers and earned badges. Never the email. Null for an unknown id. */
export async function getDiverProfile(userId: unknown): Promise<DiverProfile | null> {
  await ready();
  if (typeof userId !== "string" || !userId) return null;
  const store = readStore();
  const user = store.users.find((item) => item.id === userId);
  if (!user) return null;
  const session = await currentSession();
  const { stats, badges, allRank } = diverSummary(store, user.id);
  return {
    nickname: user.nickname,
    about: user.about ?? "",
    since: user.createdAt.slice(0, 7),
    stats,
    sitesAdded: store.sites.filter((site) => site.addedBy === user.id && !site.hidden).length,
    allRank,
    badges: badges.filter((badge) => badge.earned),
    isMe: session?.userId === user.id,
  };
}
