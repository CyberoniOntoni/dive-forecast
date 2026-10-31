"use server";

import { finishLogin, normalizeEmail, requireAbout, requireNickname, startLogin } from "./accounts";
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
import { siteScouts } from "./site-scouts";
import { hashLoginCode, newLoginCode, sameText } from "./session-token";
import { localPath } from "./sign-in";
import { listMergedSites, mutateStore, readStore } from "./store";
import type { StoreData } from "./types";

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
    const link = base ? `${base}/login?${new URLSearchParams({ email, code, next: localPath(next) })}` : null;
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
    .filter((site) => site.addedBy && nickname.has(site.addedBy))
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
    sitesAdded: store.sites.filter((site) => site.addedBy === user.id).length,
    allRank,
    badges: badges.filter((badge) => badge.earned),
    isMe: session?.userId === user.id,
  };
}
