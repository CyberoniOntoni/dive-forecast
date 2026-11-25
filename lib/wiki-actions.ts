"use server";

import { appUrl, currentSession, requireSession } from "./auth";
import { appSetting, runInBackground } from "./cloudflare";
import { sendNotice } from "./email";
import { hasAcceptedTerms } from "./moderation";
import { moderatorId } from "./moderator";
import { ready } from "./ready";
import {
  approveRefusal,
  fieldChanges,
  liveTexts,
  originalTexts,
  proposeEdit,
  readEditInput,
  reviewEdit,
  revertEdit,
  siteContributors,
  staleFields,
  standingBefore,
  withdrawEdit,
  type Contributor,
  type FieldChange,
} from "./site-wiki";
import { WIKI_LABELS } from "./site-wiki-limits";
import { findSite, listMergedSites, mutateStore, readStore, siteRecord } from "./store";
import { WIKI_FIELDS, type SiteEdit, type StoreData, type WikiField, type WikiTexts } from "./types";

/**
 * Divers' edits to a site's description and how to dive it (lib/site-wiki.ts): the site page's card and edit form,
 * the moderators' queue at /moderation, and the site's history. Every write returns its refusal as a value.
 */

/** The signed-in diver's latest edit on the site, as the edit form shows it. */
export type MyEdit = {
  id: string;
  status: SiteEdit["status"];
  changes: WikiTexts;
  note: string | null;
  rejectReason: string | null;
  /** ISO UTC: when it was proposed, or looked at. */
  at: string;
};

export type SiteWiki = {
  siteId: string;
  texts: Record<WikiField, string>;
  contributors: Contributor[];
  /** Approved revisions in the history, taken-back ones included. */
  revisions: number;
  signedIn: boolean;
  /**
   * Signed in, not banned, and agreed to the content rules: the form can be sent. While `adderTextHidden`, it offers
   * About the site only.
   */
  canEdit: boolean;
  /** Signed in but has not agreed to the content rules yet. */
  needsTerms: boolean;
  /** A moderator's edit goes live at once. */
  moderator: boolean;
  /** Their edit waiting for review, or the last one looked at (shown for 30 days), newest first. */
  mine: MyEdit | null;
  /** The viewer blocked the diver who added the site, and how to dive it is still that diver's own text: hidden. */
  adderTextHidden: boolean;
  /**
   * Who a Report on each field goes to: the diver whose revision it shows now. Absent when the field is the site's
   * own text or that diver's is the viewer.
   */
  reportTo: Partial<Record<WikiField, Contributor>>;
};

const MY_EDIT_SHOWN_DAYS = 30;

function findNickname(store: StoreData, userId: string): string {
  const user = store.users.find((item) => item.id === userId);
  return user && !user.storeReview ? user.nickname : "a former diver";
}

function siteWiki(store: StoreData, siteId: string, viewerId: string | null, moderator: boolean): SiteWiki {
  const record = siteRecord(store, siteId);
  const { texts, source } = liveTexts(originalTexts(record), store.siteEdits, siteId);
  const viewer = viewerId ? store.users.find((user) => user.id === viewerId) : undefined;
  const adderTextHidden =
    Boolean(record?.addedBy && viewer?.blocked?.includes(record.addedBy)) && source.howToDive == null && Boolean(texts.howToDive);
  const since = Date.now() - MY_EDIT_SHOWN_DAYS * 24 * 60 * 60 * 1000;
  const own = viewerId
    ? store.siteEdits
        .filter((edit) => edit.siteId === siteId && edit.userId === viewerId)
        .filter((edit) => edit.status === "pending" || Date.parse(edit.reviewedAt ?? edit.createdAt) > since)
        .sort((a, b) => (b.reviewedAt ?? b.createdAt).localeCompare(a.reviewedAt ?? a.createdAt))
    : [];
  const reportTo: Partial<Record<WikiField, Contributor>> = {};
  for (const field of WIKI_FIELDS) {
    const edit = source[field];
    if (edit && edit.userId !== viewerId && texts[field]) reportTo[field] = { userId: edit.userId, nickname: findNickname(store, edit.userId) };
  }
  const latest = own.find((edit) => edit.status === "pending") ?? own[0] ?? null;
  return {
    siteId,
    texts: adderTextHidden ? { ...texts, howToDive: "" } : texts,
    contributors: siteContributors(store, siteId),
    revisions: store.siteEdits.filter((edit) => edit.siteId === siteId && edit.status === "approved" && (moderator || !edit.revertedAt)).length,
    signedIn: viewer != null,
    canEdit: Boolean(viewer && !viewer.bannedAt && hasAcceptedTerms(viewer)),
    needsTerms: Boolean(viewer && !hasAcceptedTerms(viewer)),
    moderator,
    mine: latest
      ? {
          id: latest.id,
          status: latest.status,
          changes: latest.changes,
          note: latest.note ?? null,
          rejectReason: latest.rejectReason ?? null,
          at: latest.reviewedAt ?? latest.createdAt,
        }
      : null,
    adderTextHidden,
    reportTo,
  };
}

/** The site's texts, who wrote them, and the signed-in diver's own edit there. Null for an unknown site. */
export async function getSiteWiki(siteId: string): Promise<SiteWiki | null> {
  await ready();
  if (typeof siteId !== "string" || !findSite(siteId)) return null;
  const session = await currentSession();
  const moderator = session ? (await moderatorId()) != null : false;
  return siteWiki(readStore(), siteId, session?.userId ?? null, moderator);
}

export type WikiResult = { ok: boolean; error: string | null; wiki: SiteWiki | null; live: boolean };

function failed(caught: unknown, fallback: string): WikiResult {
  return { ok: false, error: caught instanceof Error && caught.message ? caught.message : fallback, wiki: null, live: false };
}

/**
 * Proposes an edit to a site's texts (a moderator's goes live at once). Changing one's own edit while it waits keeps
 * one in the queue. Moderators get an email for each new one.
 */
export async function proposeSiteEdit(input: unknown): Promise<WikiResult> {
  await ready();
  try {
    const session = await requireSession();
    const edit = readEditInput(input);
    const site = findSite(edit.siteId);
    if (!site) return failed(null, "That site is gone.");
    const moderator = (await moderatorId()) === session.userId;
    const outcome = await mutateStore((store) =>
      proposeEdit(store, session.userId, edit, originalTexts(siteRecord(store, edit.siteId)), Date.now(), { moderator }),
    );
    if (outcome.created && !moderator) {
      runInBackground(notifyModerators(site.name, outcome.edit).catch((error) => console.error("Moderator email failed", error)));
    }
    return { ok: true, error: null, wiki: siteWiki(readStore(), edit.siteId, session.userId, moderator), live: outcome.edit.status === "approved" };
  } catch (caught) {
    return failed(caught, "Could not save your edit.");
  }
}

async function notifyModerators(siteName: string, edit: SiteEdit): Promise<void> {
  const to = (appSetting("MODERATOR_EMAILS") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (to.length === 0) return;
  const base = (await appUrl()) ?? "https://50bar.app";
  const fields = (Object.keys(edit.changes) as WikiField[]).map((field) => WIKI_LABELS[field]).join(" and ");
  const text = [`A diver proposed an edit to ${siteName}: ${fields}.`, edit.note ? `Their note: ${edit.note}` : null, "", `Review it at ${base}/moderation`]
    .filter((line) => line !== null)
    .join("\n");
  for (const address of to) await sendNotice(address, `50Bar site edit: ${siteName}`, text);
}

/** The diver takes back their own edit while it waits for review. */
export async function withdrawSiteEdit(editId: unknown): Promise<WikiResult> {
  await ready();
  try {
    const session = await requireSession();
    if (typeof editId !== "string" || !editId) return failed(null, "Unknown edit.");
    const siteId = readStore().siteEdits.find((edit) => edit.id === editId)?.siteId;
    const done = await mutateStore((store) => withdrawEdit(store, session.userId, editId));
    if (!done || !siteId) return failed(null, "That edit was already looked at.");
    const moderator = (await moderatorId()) != null;
    return { ok: true, error: null, wiki: siteWiki(readStore(), siteId, session.userId, moderator), live: false };
  } catch (caught) {
    return failed(caught, "Could not withdraw that.");
  }
}

export type PendingEditView = {
  id: string;
  site: { id: string; name: string };
  diver: { userId: string; nickname: string; storeReview: boolean } | null;
  note: string | null;
  createdAt: string;
  /** Each changed field against the text the site has now. */
  changes: FieldChange[];
  /** Fields someone else changed after this diver started: approving writes over that text. */
  stale: string[];
  /** Why Approve is not offered (approveRefusal), or null. */
  cannotApprove: string | null;
};

/** Edits waiting for review, oldest first, for /moderation. Null for anyone but a moderator. */
export async function listPendingEdits(): Promise<PendingEditView[] | null> {
  await ready();
  if (!(await moderatorId())) return null;
  const store = readStore();
  // One merge of all sites for the names, not one per edit.
  const names = new Map(listMergedSites().map((site) => [site.id, site.name]));
  return store.siteEdits
    .filter((edit) => edit.status === "pending")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((edit) => {
      const live = liveTexts(originalTexts(siteRecord(store, edit.siteId)), store.siteEdits, edit.siteId).texts;
      const user = store.users.find((item) => item.id === edit.userId);
      return {
        id: edit.id,
        site: { id: edit.siteId, name: names.get(edit.siteId) ?? edit.siteId },
        diver: user ? { userId: user.id, nickname: user.nickname, storeReview: Boolean(user.storeReview) } : null,
        note: edit.note ?? null,
        createdAt: edit.createdAt,
        changes: fieldChanges(live, edit.changes),
        stale: staleFields(edit, live).map((field) => WIKI_LABELS[field]),
        cannotApprove: approveRefusal(store, edit),
      };
    });
}

export type ModeratorResult = { ok: boolean; error: string | null };

/** A moderator approves or rejects an edit waiting for review; a rejection can carry a reason for the diver. */
export async function reviewSiteEdit(editId: unknown, action: unknown, reason?: unknown): Promise<ModeratorResult> {
  await ready();
  try {
    const moderator = await moderatorId();
    if (!moderator) return { ok: false, error: "Only moderators can do that." };
    if (typeof editId !== "string" || !editId) return { ok: false, error: "Unknown edit." };
    if (action !== "approve" && action !== "reject") return { ok: false, error: "Unknown action." };
    const words = typeof reason === "string" ? reason : undefined;
    await mutateStore((store) => {
      const siteId = store.siteEdits.find((edit) => edit.id === editId)?.siteId;
      return reviewEdit(store, editId, action, moderator, originalTexts(siteId ? siteRecord(store, siteId) : null), Date.now(), words);
    });
    return { ok: true, error: null };
  } catch (caught) {
    return { ok: false, error: caught instanceof Error && caught.message ? caught.message : "Could not do that." };
  }
}

/** A moderator takes back the live revision of a site's text (lib/site-wiki.ts revertEdit). */
export async function revertSiteEdit(editId: unknown): Promise<ModeratorResult> {
  await ready();
  try {
    const moderator = await moderatorId();
    if (!moderator) return { ok: false, error: "Only moderators can do that." };
    if (typeof editId !== "string" || !editId) return { ok: false, error: "Unknown edit." };
    await mutateStore((store) => {
      const siteId = store.siteEdits.find((edit) => edit.id === editId)?.siteId;
      return revertEdit(store, editId, originalTexts(siteId ? siteRecord(store, siteId) : null), new Date().toISOString());
    });
    return { ok: true, error: null };
  } catch (caught) {
    return { ok: false, error: caught instanceof Error && caught.message ? caught.message : "Could not do that." };
  }
}

export type RevisionView = {
  id: string;
  /** Null for a deleted account, or a diver whose credit is hidden (the store-review account). */
  diver: Contributor | null;
  /** ISO UTC, when it went live. */
  at: string;
  changes: FieldChange[];
  reverted: boolean;
  /** A moderator may take it back now (it is the live text of every field it changed). */
  canRevert: boolean;
};

export type SiteHistory = { siteId: string; siteName: string; original: Record<WikiField, string>; revisions: RevisionView[]; moderator: boolean };

/** Every approved edit of a site's texts, newest first, each with what it changed. Null for an unknown site. */
export async function getSiteHistory(siteId: string): Promise<SiteHistory | null> {
  await ready();
  const site = typeof siteId === "string" ? findSite(siteId) : null;
  if (!site) return null;
  const moderator = (await moderatorId()) != null;
  const store = readStore();
  const original = originalTexts(siteRecord(store, siteId));
  const { source } = liveTexts(original, store.siteEdits, siteId);
  // Divers see only the revisions still standing, each against the text it now follows; text a moderator took back
  // (vandalism, a removed report) stays visible to moderators alone.
  const before = standingBefore(original, store.siteEdits, siteId);
  const revisions = store.siteEdits
    .filter((edit) => edit.siteId === siteId && edit.status === "approved" && (moderator || !edit.revertedAt))
    .sort((a, b) => (b.reviewedAt ?? b.createdAt).localeCompare(a.reviewedAt ?? a.createdAt) || b.id.localeCompare(a.id))
    .map((edit): RevisionView => {
      const user = store.users.find((item) => item.id === edit.userId);
      const fields = Object.keys(edit.changes) as WikiField[];
      return {
        id: edit.id,
        diver: user && !user.storeReview ? { userId: user.id, nickname: user.nickname } : null,
        at: edit.reviewedAt ?? edit.createdAt,
        changes: fieldChanges(moderator ? (edit.replaced ?? edit.based) : (before.get(edit.id) ?? edit.based), edit.changes),
        reverted: Boolean(edit.revertedAt),
        canRevert: moderator && !edit.revertedAt && fields.every((field) => source[field]?.id === edit.id),
      };
    });
  return { siteId, siteName: site.name, original, revisions, moderator };
}
