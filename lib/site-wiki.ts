import { toMaldivesWall } from "./forecast";
import { requireTermsAccepted } from "./moderation";
import { cleanText } from "./site-details";
import { EDIT_NOTE_MAX, EDITS_PER_DAY, PENDING_EDITS_MAX, WIKI_LABELS, WIKI_MAX } from "./site-wiki-limits";
import { diffWords, type DiffPart } from "./text-diff";
import { WIKI_FIELDS, type Site, type SiteEdit, type StoreData, type User, type WikiField, type WikiTexts } from "./types";

/**
 * Site texts divers write together, wiki style: any signed-in diver who agreed to the content rules proposes a change
 * to a site's description or how to dive it; a moderator approves or rejects it at /moderation. The live text of each
 * field is the latest approved edit that changed it (or the site's own text before any), so every approved edit is a
 * revision in the site's history, and the divers who wrote them are credited on the site page. The forecast never
 * reads these texts. lib/wiki-actions.ts runs these for the signed-in diver.
 */

export type EditInput = { siteId: string; texts: WikiTexts; based: WikiTexts; note?: string };

/**
 * Reads a proposed edit from a request: the site, the full new text of the fields the form sent, the text each had
 * when the form was opened, and an optional note. Each text cleaned like the site notes and held to its length.
 */
export function readEditInput(input: unknown): EditInput {
  const record = (input ?? {}) as Record<string, unknown>;
  const siteId = typeof record.siteId === "string" ? record.siteId.trim() : "";
  if (!siteId) throw new Error("Say which site.");
  const texts: WikiTexts = {};
  const based: WikiTexts = {};
  const sentTexts = (record.texts ?? {}) as Record<string, unknown>;
  const sentBased = (record.based ?? {}) as Record<string, unknown>;
  for (const field of WIKI_FIELDS) {
    const value = sentTexts[field];
    if (value != null) {
      if (typeof value !== "string") throw new Error(`${WIKI_LABELS[field]} must be text.`);
      const cleaned = cleanText(value);
      if (cleaned.length > WIKI_MAX[field]) throw new Error(`${WIKI_LABELS[field]} must be at most ${WIKI_MAX[field]} characters.`);
      texts[field] = cleaned;
    }
    // What the form started from is only compared, never shown, so a wrong one cannot do harm; it is still held short.
    const base = sentBased[field];
    if (typeof base === "string") based[field] = cleanText(base).slice(0, WIKI_MAX[field]);
  }
  if (Object.keys(texts).length === 0) throw new Error("Write something first.");
  const note = typeof record.note === "string" ? cleanText(record.note) : "";
  if (note.length > EDIT_NOTE_MAX) throw new Error(`Keep the note to ${EDIT_NOTE_MAX} characters.`);
  return { siteId, texts, based, ...(note ? { note } : {}) };
}

/** A site's own texts, before any diver's edit: the catalog's or the adder's. */
export function originalTexts(site: Pick<Site, WikiField> | null | undefined): Record<WikiField, string> {
  return { description: site?.description ?? "", howToDive: site?.howToDive ?? "" };
}

/** Approved edits not taken back, in the order they went live. */
function liveRevisions(edits: readonly SiteEdit[], siteId: string): SiteEdit[] {
  return edits
    .filter((edit) => edit.siteId === siteId && edit.status === "approved" && !edit.revertedAt)
    .sort((a, b) => (a.reviewedAt ?? a.createdAt).localeCompare(b.reviewedAt ?? b.createdAt) || a.id.localeCompare(b.id));
}

export type LiveTexts = { texts: Record<WikiField, string>; source: Record<WikiField, SiteEdit | null> };

/** Each field's live text, and the edit it came from (null: the site's own text). */
export function liveTexts(original: Record<WikiField, string>, edits: readonly SiteEdit[], siteId: string): LiveTexts {
  const texts = { ...original };
  const source: Record<WikiField, SiteEdit | null> = { description: null, howToDive: null };
  for (const edit of liveRevisions(edits, siteId)) {
    for (const field of WIKI_FIELDS) {
      const text = edit.changes[field];
      if (text == null) continue;
      texts[field] = text;
      source[field] = edit;
    }
  }
  return { texts, source };
}

/**
 * The texts each standing revision went live over, replayed from the site's own texts through the revisions still
 * standing, so the public history never shows text a moderator took back.
 */
export function standingBefore(original: Record<WikiField, string>, edits: readonly SiteEdit[], siteId: string): Map<string, WikiTexts> {
  const texts = { ...original };
  const before = new Map<string, WikiTexts>();
  for (const edit of liveRevisions(edits, siteId)) {
    before.set(edit.id, { ...texts });
    for (const field of WIKI_FIELDS) {
      const text = edit.changes[field];
      if (text != null) texts[field] = text;
    }
  }
  return before;
}

/** The sites with approved edits, for laying the texts over many sites at once (listMergedSites). */
export function editedSiteIds(edits: readonly SiteEdit[]): Set<string> {
  return new Set(edits.filter((edit) => edit.status === "approved" && !edit.revertedAt).map((edit) => edit.siteId));
}

/** The site with its live texts in place of its own. A new object when anything changed; the site itself otherwise. */
export function withWikiTexts<T extends Site>(site: T, edits: readonly SiteEdit[]): T {
  const { texts, source } = liveTexts(originalTexts(site), edits, site.id);
  if (!source.description && !source.howToDive) return site;
  const placed = { ...site };
  for (const field of WIKI_FIELDS) {
    if (texts[field]) placed[field] = texts[field];
    else delete placed[field];
  }
  return placed;
}

function findUser(store: Pick<StoreData, "users">, userId: string): User | undefined {
  return store.users.find((user) => user.id === userId);
}

export type ProposeOutcome = { edit: SiteEdit; created: boolean };

/**
 * Saves a diver's edit to a site's texts. Only the fields whose text differs from the live text become changes. A
 * diver's own edit still waiting on the same site is changed in place rather than queued twice. A moderator's edit
 * goes live at once (they would only approve it themselves). Throws the refusal in words.
 */
export function proposeEdit(
  store: StoreData,
  userId: string,
  input: EditInput,
  original: Record<WikiField, string>,
  nowMs: number,
  { moderator = false }: { moderator?: boolean } = {},
): ProposeOutcome {
  const user = findUser(store, userId);
  if (!user || user.bannedAt) throw new Error("This account cannot edit sites.");
  requireTermsAccepted(store, userId);
  const live = liveTexts(original, store.siteEdits, input.siteId).texts;
  const changes: WikiTexts = {};
  const based: WikiTexts = {};
  for (const field of WIKI_FIELDS) {
    const text = input.texts[field];
    if (text == null || text === live[field]) continue;
    changes[field] = text;
    based[field] = input.based[field] ?? live[field];
  }
  if (Object.keys(changes).length === 0) throw new Error("That is what the site already says.");
  const nowIso = new Date(nowMs).toISOString();
  const mine = store.siteEdits.find((edit) => edit.siteId === input.siteId && edit.userId === userId && edit.status === "pending");
  if (!mine && !moderator) {
    const waiting = store.siteEdits.filter((edit) => edit.userId === userId && edit.status === "pending").length;
    if (waiting >= PENDING_EDITS_MAX) throw new Error(`You have ${PENDING_EDITS_MAX} edits waiting for review. Try again once they are looked at.`);
    // Counted from the diver's own log of new edits, not the rows still kept, so withdrawing an edit (which deletes
    // it) never gives the slot back, and changing one that waits takes none.
    const since = nowMs - 24 * 60 * 60 * 1000;
    const today = (user.siteEditProposals ?? []).filter((at) => Date.parse(at) > since);
    if (today.length >= EDITS_PER_DAY) throw new Error(`You can propose ${EDITS_PER_DAY} edits a day. Try again tomorrow.`);
    user.siteEditProposals = [...today, nowIso];
  }
  const edit: SiteEdit = mine ?? { id: crypto.randomUUID(), siteId: input.siteId, userId, createdAt: nowIso, status: "pending", changes, based };
  edit.createdAt = nowIso;
  edit.changes = changes;
  edit.based = based;
  if (input.note) edit.note = input.note;
  else delete edit.note;
  if (!mine) store.siteEdits.push(edit);
  if (moderator) goLive(edit, live, userId, nowIso);
  return { edit, created: !mine };
}

function goLive(edit: SiteEdit, live: Record<WikiField, string>, reviewerId: string, nowIso: string): void {
  edit.status = "approved";
  edit.reviewedAt = nowIso;
  edit.reviewerId = reviewerId;
  edit.replaced = Object.fromEntries(Object.keys(edit.changes).map((field) => [field, live[field as WikiField]]));
  delete edit.rejectReason;
}

/** Why a moderator may not approve this edit, or null when they may. */
export function approveRefusal(store: Pick<StoreData, "users">, edit: SiteEdit): string | null {
  const author = findUser(store, edit.userId);
  if (!author) return "That diver is gone.";
  if (author.storeReview) return "The store-review account's edits are only for trying the form.";
  if (author.bannedAt) return "That diver is banned.";
  return null;
}

/**
 * A moderator approves (the edit goes live over whatever the site says now) or rejects (with an optional reason the
 * diver sees) an edit that is waiting. Throws the refusal in words.
 */
export function reviewEdit(
  store: StoreData,
  editId: string,
  action: "approve" | "reject",
  moderatorId: string,
  original: Record<WikiField, string>,
  nowMs: number,
  reason?: string,
): SiteEdit {
  const edit = store.siteEdits.find((item) => item.id === editId);
  if (!edit) throw new Error("That edit is gone.");
  if (edit.status !== "pending") throw new Error("That edit was already looked at.");
  const nowIso = new Date(nowMs).toISOString();
  if (action === "approve") {
    const refusal = approveRefusal(store, edit);
    if (refusal) throw new Error(refusal);
    goLive(edit, liveTexts(original, store.siteEdits, edit.siteId).texts, moderatorId, nowIso);
    return edit;
  }
  const words = reason ? cleanText(reason) : "";
  if (words.length > EDIT_NOTE_MAX) throw new Error(`Keep the reason to ${EDIT_NOTE_MAX} characters.`);
  edit.status = "rejected";
  edit.reviewedAt = nowIso;
  edit.reviewerId = moderatorId;
  if (words) edit.rejectReason = words;
  return edit;
}

/**
 * A moderator takes back an approved edit (vandalism that got through): its fields fall back to the revision before,
 * and its diver loses the credit and points for it. Only the live revision of every field it changed can go, so the
 * history never skips a step. Throws the refusal in words.
 */
export function revertEdit(store: StoreData, editId: string, original: Record<WikiField, string>, nowIso: string): SiteEdit {
  const edit = store.siteEdits.find((item) => item.id === editId);
  if (!edit || edit.status !== "approved" || edit.revertedAt) throw new Error("That revision is not live.");
  const { source } = liveTexts(original, store.siteEdits, edit.siteId);
  const fields = Object.keys(edit.changes) as WikiField[];
  if (fields.some((field) => source[field]?.id !== edit.id)) {
    throw new Error("A later edit changed the same text. Take that one back first.");
  }
  edit.revertedAt = nowIso;
  return edit;
}

/** The diver takes back their own edit while it is still waiting. False when there is no such edit of theirs. */
export function withdrawEdit(store: StoreData, userId: string, editId: string): boolean {
  const index = store.siteEdits.findIndex((edit) => edit.id === editId && edit.userId === userId && edit.status === "pending");
  if (index < 0) return false;
  store.siteEdits.splice(index, 1);
  return true;
}

export type Contributor = { userId: string; nickname: string };

/**
 * The divers credited for a site's texts: whoever wrote an approved edit still standing, in the order they first
 * did. A deleted account, a banned one and the store-review account are left out.
 */
export function siteContributors(store: Pick<StoreData, "users" | "siteEdits">, siteId: string): Contributor[] {
  const seen = new Set<string>();
  const credited: Contributor[] = [];
  for (const edit of liveRevisions(store.siteEdits, siteId)) {
    if (seen.has(edit.userId)) continue;
    seen.add(edit.userId);
    const user = findUser(store, edit.userId);
    // A banned diver's revisions that others wrote over stay standing (takeBackTexts), but they get no credit.
    if (user && !user.storeReview && !user.bannedAt) credited.push({ userId: user.id, nickname: user.nickname });
  }
  return credited;
}

/** One field's change, as a moderator or the history page shows it. */
export type FieldChange = { field: WikiField; label: string; diff: DiffPart[]; cleared: boolean };

export function fieldChanges(from: WikiTexts, to: WikiTexts): FieldChange[] {
  return WIKI_FIELDS.filter((field) => to[field] != null).map((field) => ({
    field,
    label: WIKI_LABELS[field],
    diff: diffWords(from[field] ?? "", to[field]!),
    cleared: to[field] === "",
  }));
}

/** Fields where the text changed after the diver opened the form, so approving would write over a newer edit. */
export function staleFields(edit: SiteEdit, live: Record<WikiField, string>): WikiField[] {
  return (Object.keys(edit.changes) as WikiField[]).filter((field) => (edit.based[field] ?? "") !== live[field]);
}

/**
 * The Maldives day of each diver's approved edits that earn points: at most `perDay` a day, by when each
 * went live. A moderator's own edit (approved by themselves) and an edit taken back earn nothing.
 */
export function countedEdits(edits: readonly SiteEdit[], perDay: number): Map<string, { day: string }[]> {
  const byUser = new Map<string, { day: string }[]>();
  const counted = new Map<string, number>();
  const ordered = edits
    .filter((edit) => edit.status === "approved" && !edit.revertedAt && edit.reviewedAt && edit.reviewerId !== edit.userId)
    .sort((a, b) => a.reviewedAt!.localeCompare(b.reviewedAt!) || a.id.localeCompare(b.id));
  for (const edit of ordered) {
    const day = toMaldivesWall(edit.reviewedAt!).slice(0, 10);
    const key = `${edit.userId}|${day}`;
    const today = counted.get(key) ?? 0;
    if (today >= perDay) continue;
    counted.set(key, today + 1);
    byUser.set(edit.userId, [...(byUser.get(edit.userId) ?? []), { day }]);
  }
  return byUser;
}
