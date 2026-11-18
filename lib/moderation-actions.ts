"use server";

import { appSetting, runInBackground } from "./cloudflare";
import { appUrl, requireSession } from "./auth";
import { sendNotice } from "./email";
import {
  addFlag,
  banDiver,
  FLAG_REASON_LABELS,
  isModeratorEmail,
  readFlagInput,
  removeFlagged,
  resolveFlags,
  setBlocked,
  type StoredPhoto,
} from "./moderation";
import { ready } from "./ready";
import { deletePhotoBytes, photoUrl } from "./site-photos";
import { findSite, mutateStore, readStore } from "./store";
import type { ContentFlag, FlagKind, FlagReason } from "./types";

/**
 * The signed-in diver's side of Google Play's user-generated content rules (lib/moderation.ts): agree to the content
 * rules, report content or a diver, block a diver; and the moderators' side at /moderation. Every one returns its
 * refusal as a value.
 */

export type ModerationResult = { ok: boolean; error: string | null };

function failed(caught: unknown, fallback: string): ModerationResult {
  return { ok: false, error: caught instanceof Error && caught.message ? caught.message : fallback };
}

/** Records that the signed-in diver agrees to the content rules (/terms), for divers who signed up before them. */
export async function acceptTerms(): Promise<ModerationResult> {
  await ready();
  try {
    const session = await requireSession();
    await mutateStore((store) => {
      const user = store.users.find((item) => item.id === session.userId);
      if (!user) throw new Error("This account no longer exists.");
      user.acceptedTermsAt ??= new Date().toISOString();
    });
    return { ok: true, error: null };
  } catch (caught) {
    return failed(caught, "Could not save that.");
  }
}

/**
 * Reports a review (with its photos), a site added in the app, or a diver's nickname and About me. Moderators get an
 * email. Saying the same thing twice is not an error: the first report still stands.
 */
export async function reportContent(input: unknown): Promise<ModerationResult> {
  await ready();
  try {
    const session = await requireSession();
    const flag = readFlagInput(input);
    const outcome = await mutateStore((store) => addFlag(store, session.userId, flag, Date.now()));
    if (outcome.result === "missing") return { ok: false, error: "That is no longer there." };
    if (outcome.result === "own") return { ok: false, error: "That is your own." };
    if (outcome.result === "limit") return { ok: false, error: "You have sent a lot of reports today. Try again tomorrow." };
    if (outcome.result === "saved") runInBackground(notifyModerators(outcome.flag).catch((error) => console.error("Moderator email failed", error)));
    return { ok: true, error: null };
  } catch (caught) {
    return failed(caught, "Could not send the report.");
  }
}

async function notifyModerators(flag: ContentFlag): Promise<void> {
  const to = (appSetting("MODERATOR_EMAILS") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (to.length === 0) return;
  const base = (await appUrl()) ?? "https://50bar.app";
  const what = { review: "a review", site: "a site added in the app", diver: "a diver's profile" }[flag.kind];
  const text = [
    `A diver reported ${what}: ${FLAG_REASON_LABELS[flag.reason]}.`,
    flag.note ? `Their note: ${flag.note}` : null,
    "",
    `Review it at ${base}/moderation`,
  ]
    .filter((line) => line !== null)
    .join("\n");
  for (const address of to) await sendNotice(address, `50Bar report: ${FLAG_REASON_LABELS[flag.reason]}`, text);
}

/** Blocks (or unblocks) a diver for the signed-in one: their reviews, photos and page are hidden from them. */
export async function blockDiver(userId: unknown, blocked: unknown): Promise<ModerationResult> {
  await ready();
  try {
    const session = await requireSession();
    if (typeof userId !== "string" || !userId) return { ok: false, error: "Unknown diver." };
    const done = await mutateStore((store) => setBlocked(store, session.userId, userId, blocked !== false));
    return done ? { ok: true, error: null } : { ok: false, error: "Unknown diver." };
  } catch (caught) {
    return failed(caught, "Could not save that.");
  }
}

/** The divers the signed-in diver blocked, for their account page. */
export async function getBlockedDivers(): Promise<{ userId: string; nickname: string }[]> {
  await ready();
  const session = await requireSession().catch(() => null);
  if (!session) return [];
  const store = readStore();
  const ids = store.users.find((user) => user.id === session.userId)?.blocked ?? [];
  return ids.flatMap((id) => {
    const user = store.users.find((item) => item.id === id);
    return user ? [{ userId: user.id, nickname: user.nickname }] : [];
  });
}

/** Whether the signed-in diver is a moderator (their email is in MODERATOR_EMAILS). */
async function moderatorId(): Promise<string | null> {
  const session = await requireSession().catch(() => null);
  if (!session) return null;
  const user = readStore().users.find((item) => item.id === session.userId);
  return user && !user.bannedAt && isModeratorEmail(user.email, appSetting("MODERATOR_EMAILS")) ? user.id : null;
}

export async function isModerator(): Promise<boolean> {
  await ready();
  return (await moderatorId()) != null;
}

export type FlagView = {
  id: string;
  kind: FlagKind;
  reason: FlagReason;
  reasonLabel: string;
  note: string | null;
  createdAt: string;
  reporter: string | null;
  /** Whose content it is. */
  diver: { userId: string; nickname: string; about: string | null; banned: boolean } | null;
  site: { id: string; name: string; howToDive: string | null; hidden: boolean } | null;
  review: { score: number; text: string | null } | null;
  photos: string[];
  /** Other open reports on the same content. */
  alsoReported: number;
};

/** Open reports, oldest first, with what they are about, for /moderation. Null for anyone but a moderator. */
export async function listOpenFlags(): Promise<FlagView[] | null> {
  await ready();
  if (!(await moderatorId())) return null;
  const store = readStore();
  const nickname = (id: string | undefined) => store.users.find((user) => user.id === id)?.nickname ?? null;
  const open = store.flags.filter((flag) => !flag.resolvedAt);
  const seen = new Set<string>();
  const views: FlagView[] = [];
  for (const flag of open) {
    const key = `${flag.kind}|${flag.siteId ?? ""}|${flag.userId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const user = store.users.find((item) => item.id === flag.userId);
    const site = flag.siteId ? (store.sites.find((item) => item.id === flag.siteId) ?? findSite(flag.siteId)) : null;
    const rating =
      flag.kind === "review" ? store.ratings.find((item) => item.siteId === flag.siteId && item.userId === flag.userId && !item.removedAt) : undefined;
    const photos =
      flag.kind === "review"
        ? (rating?.photos ?? []).map((photo) => photoUrl(flag.siteId!, photo.id))
        : flag.kind === "site" && site
          ? (site.photos ?? []).map((photo) => photoUrl(site.id, photo.id))
          : [];
    views.push({
      id: flag.id,
      kind: flag.kind,
      reason: flag.reason,
      reasonLabel: FLAG_REASON_LABELS[flag.reason],
      note: flag.note ?? null,
      createdAt: flag.createdAt,
      reporter: nickname(flag.reporterId),
      diver: user ? { userId: user.id, nickname: user.nickname, about: user.about ?? null, banned: Boolean(user.bannedAt) } : null,
      site: site ? { id: site.id, name: site.name, howToDive: site.howToDive ?? null, hidden: Boolean(site.hidden) } : null,
      review: rating ? { score: rating.score, text: rating.review ?? null } : null,
      photos,
      alsoReported: open.filter((item) => `${item.kind}|${item.siteId ?? ""}|${item.userId ?? ""}` === key).length - 1,
    });
  }
  return views;
}

/**
 * A moderator acts on a report: "remove" takes the content down, "ban" bans its diver (and removes all they posted),
 * "dismiss" closes it with nothing changed. Every open report on the same content closes with it.
 */
export async function moderateFlag(flagId: unknown, action: unknown): Promise<ModerationResult> {
  await ready();
  try {
    const moderator = await moderatorId();
    if (!moderator) return { ok: false, error: "Only moderators can do that." };
    if (action !== "remove" && action !== "ban" && action !== "dismiss") return { ok: false, error: "Unknown action." };
    const photos = await mutateStore((store): StoredPhoto[] | null => {
      const flag = store.flags.find((item) => item.id === flagId);
      if (!flag) return null;
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      if (action === "dismiss") {
        resolveFlags(store, flag, "dismissed", nowIso);
        return [];
      }
      if (action === "ban") {
        if (!flag.userId) throw new Error("This report names no diver to ban.");
        if (flag.userId === moderator) throw new Error("You cannot ban yourself.");
        const removed = banDiver(store, flag.userId, nowMs) ?? [];
        resolveFlags(store, flag, "banned", nowIso);
        return removed;
      }
      const removed = removeFlagged(store, flag, nowIso);
      resolveFlags(store, flag, "removed", nowIso);
      return removed;
    });
    if (!photos) return { ok: false, error: "That report is gone." };
    await Promise.all(photos.map(({ siteId, photo }) => deletePhotoBytes(siteId, photo.id).catch(() => undefined)));
    return { ok: true, error: null };
  } catch (caught) {
    return failed(caught, "Could not do that.");
  }
}
