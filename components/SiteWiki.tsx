"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { POINTS } from "@/lib/points-rules";
import { ContentActions } from "./ContentActions";
import { signInHref } from "@/lib/sign-in";
import { creditJoiner, EDIT_NOTE_MAX, WIKI_LABELS, WIKI_MAX } from "@/lib/site-wiki-limits";
import type { WikiField } from "@/lib/types";
import { proposeSiteEdit, withdrawSiteEdit, type SiteWiki as Wiki, type WikiResult } from "@/lib/wiki-actions";

const FIELDS: readonly WikiField[] = ["description", "howToDive"];
const HINTS: Record<WikiField, string> = {
  description: "What the site is: the reef, the life, what it is known for, the best season.",
  howToDive: "Entry and exit, the route, depths, which tide to dive it on, hazards.",
};
const textareaClass =
  "min-h-32 w-full rounded-xl border border-foam/20 bg-ink px-3 py-2 text-sm leading-6 text-foam placeholder:text-foam/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming";
const primaryButton =
  "min-h-11 rounded-xl bg-incoming px-4 text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foam disabled:opacity-50";
const quietButton =
  "button-quiet justify-center px-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming disabled:opacity-50";
const link = "font-medium text-foam underline decoration-incoming underline-offset-4";

/**
 * The site page's "About this site" card: the description and how to dive it that divers wrote together, who wrote
 * them, and the form to propose a change. A moderator approves each change before it shows (lib/site-wiki.ts); a
 * moderator's own goes live at once.
 */
export function SiteWiki({ initial, siteName }: { initial: Wiki; siteName: string }) {
  const [wiki, setWiki] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<WikiField, string>>(wiki.texts);
  const [based, setBased] = useState<Record<WikiField, string>>(wiki.texts);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const pendingEdit = wiki.mine?.status === "pending" ? wiki.mine : null;
  // While how to dive it is hidden (the viewer blocked the adder), the form offers About the site only.
  const fields = wiki.adderTextHidden ? FIELDS.filter((field) => field !== "howToDive") : FIELDS;
  const empty = !wiki.texts.description && !wiki.texts.howToDive;
  const here = `/sites/${wiki.siteId}#about`;

  function open() {
    // Start from the diver's own edit while it waits, so changing it does not lose what they wrote.
    setDrafts({ ...wiki.texts, ...(pendingEdit?.changes ?? {}) });
    setBased(wiki.texts);
    setNote(pendingEdit?.note ?? "");
    setError(null);
    setDone(null);
    setEditing(true);
  }

  function run(action: () => Promise<WikiResult>, after: (result: WikiResult) => string) {
    setError(null);
    setDone(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok || !result.wiki) {
          setError(result.error ?? "Could not save that.");
          return;
        }
        setWiki(result.wiki);
        setEditing(false);
        setDone(after(result));
      } catch {
        setError("Could not save that. Check your connection and try again.");
      }
    });
  }

  function send() {
    // Only the fields the diver changed (and those of their own waiting edit, which this one replaces): sending an
    // untouched field would undo an edit approved to it while the form was open.
    const sent = fields.filter((field) => drafts[field] !== based[field] || pendingEdit?.changes[field] != null);
    if (sent.length === 0) {
      setError("Change something first.");
      return;
    }
    run(
      () =>
        proposeSiteEdit({
          siteId: wiki.siteId,
          texts: Object.fromEntries(sent.map((field) => [field, drafts[field]])),
          based: Object.fromEntries(sent.map((field) => [field, based[field]])),
          note,
        }),
      (result) =>
        result.live
          ? "Saved. Your edit is live."
          : `Thanks. A moderator will look at your edit; once approved it shows here with your name, and earns ${POINTS.edit} points.`,
    );
  }

  /** Report under a field divers wrote, to whoever wrote what it shows now. */
  function report(field: WikiField) {
    const author = wiki.reportTo[field];
    if (!author) return null;
    // Block is left out: a blocked diver's site texts still show (they are the site's, written together).
    return (
      <ContentActions
        kind="text"
        siteId={wiki.siteId}
        userId={author.userId ?? undefined}
        nickname={author.nickname}
        field={field}
        signedIn={wiki.signedIn}
        returnTo={here}
        canBlock={false}
      />
    );
  }

  return (
    <section id="about" className="flex min-w-0 scroll-mt-4 flex-col gap-3 surface p-4 sm:p-5" aria-labelledby="wiki-heading">
      <h2 id="wiki-heading" className="text-base font-semibold text-foam">
        About this site
      </h2>

      {editing ? (
        <form
          className="flex min-w-0 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          {fields.map((field) => (
            <label key={field} className="flex min-w-0 flex-col gap-1.5 text-sm text-foam">
              <span className="font-medium">{WIKI_LABELS[field]}</span>
              <span className="text-xs text-foam/70">{HINTS[field]}</span>
              <textarea
                value={drafts[field]}
                maxLength={WIKI_MAX[field]}
                onChange={(event) => setDrafts((current) => ({ ...current, [field]: event.target.value }))}
                className={textareaClass}
              />
              <span className="text-xs text-foam/60">
                {drafts[field].length} of {WIKI_MAX[field]}
              </span>
            </label>
          ))}
          <label className="flex min-w-0 flex-col gap-1.5 text-sm text-foam">
            <span className="font-medium">Note to the moderators (optional)</span>
            <span className="text-xs text-foam/70">What you changed and how you know: dived it last week, guide there for years.</span>
            <input
              value={note}
              maxLength={EDIT_NOTE_MAX}
              onChange={(event) => setNote(event.target.value)}
              className="min-h-11 w-full rounded-xl border border-foam/20 bg-ink px-3 text-sm text-foam focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
            />
          </label>
          <p className="text-xs leading-5 text-foam/70">
            {wiki.moderator
              ? "You are a moderator, so your edit goes live at once."
              : "A moderator reads every edit before it shows. Write what you know first-hand, in your own words, and leave out anything copied from a guide book or website."}{" "}
            The <Link href="/terms" className={link}>content rules</Link> apply.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending} className={primaryButton}>
              {pending ? "Saving…" : wiki.moderator ? "Save" : pendingEdit ? "Update my edit" : "Send for review"}
            </button>
            <button type="button" disabled={pending} onClick={() => setEditing(false)} className={quietButton}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          {wiki.texts.description ? (
            <p className="text-sm leading-6 break-words whitespace-pre-line text-foam/90">{wiki.texts.description}</p>
          ) : null}
          {report("description")}
          {wiki.texts.howToDive ? (
            <div className="flex min-w-0 flex-col gap-1">
              <h3 className="text-sm font-semibold text-foam">How to dive it</h3>
              <p className="text-sm leading-6 break-words whitespace-pre-line text-foam/90">{wiki.texts.howToDive}</p>
            </div>
          ) : null}
          {report("howToDive")}
          {wiki.adderTextHidden ? (
            <p className="text-sm text-foam/75">
              You blocked the diver who added this site, so their notes on how to dive it are hidden.
            </p>
          ) : empty ? (
            <p className="text-sm text-foam/75">
              Nobody has written about {siteName} yet. Dived it? Say what it is like and how to dive it.
            </p>
          ) : null}
          {wiki.contributors.length > 0 ? (
            <p className="text-xs leading-5 text-foam/70">
              Written by{" "}
              {wiki.contributors.map((diver, index) => (
                <span key={diver.userId}>
                  {creditJoiner(index, wiki.contributors.length)}
                  <Link href={`/divers/${diver.userId}`} className={link}>
                    {diver.nickname}
                  </Link>
                </span>
              ))}
              .
            </p>
          ) : null}
          {wiki.revisions > 0 ? (
            <p className="text-xs text-foam/70">
              <Link href={`/sites/${wiki.siteId}/history`} className={link}>
                History of this text
              </Link>
            </p>
          ) : null}
        </>
      )}

      {!editing && pendingEdit ? (
        <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-incoming/40 p-3 text-sm text-foam/85" role="status">
          <p>Your edit is waiting for a moderator. You can change it or withdraw it until then.</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => withdrawSiteEdit(pendingEdit.id), () => "Your edit was withdrawn.")}
              className={quietButton}
            >
              Withdraw my edit
            </button>
          </div>
        </div>
      ) : null}
      {!editing && wiki.mine?.status === "rejected" ? (
        <p className="text-sm text-foam/80" role="status">
          A moderator did not accept your last edit{wiki.mine.rejectReason ? `: ${wiki.mine.rejectReason}` : "."}
        </p>
      ) : null}

      {done ? (
        <p className="text-sm text-incoming" role="status">
          {done}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-outgoing" role="alert">
          {error}
        </p>
      ) : null}

      {editing ? null : wiki.canEdit ? (
        <div>
          <button type="button" onClick={open} className={quietButton}>
            {pendingEdit ? "Change my edit" : empty ? "Write about this site" : "Suggest an edit"}
          </button>
        </div>
      ) : !wiki.signedIn ? (
        <p className="text-sm text-foam/75">
          <Link href={signInHref(here)} className={link}>
            Sign in
          </Link>{" "}
          to write about this site or suggest an edit.
        </p>
      ) : wiki.needsTerms ? (
        <p className="text-sm text-foam/75">
          Agree to the content rules on your{" "}
          <Link href="/account" className={link}>
            account page
          </Link>{" "}
          to edit sites.
        </p>
      ) : null}
    </section>
  );
}
