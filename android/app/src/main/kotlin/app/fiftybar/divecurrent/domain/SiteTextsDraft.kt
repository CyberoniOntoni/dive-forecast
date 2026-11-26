package app.fiftybar.divecurrent.domain

import app.fiftybar.divecurrent.data.api.ApiSiteTexts
import app.fiftybar.divecurrent.data.api.ApiTextChanges
import app.fiftybar.divecurrent.data.api.SiteTextsBody

/**
 * The edit form's texts, as the web's card (components/SiteWiki.tsx) starts and sends them: from the diver's own
 * waiting edit if there is one, else from what the site says; only changed fields go out.
 */
data class SiteTextsDraft(val description: String, val howToDive: String, val note: String) {
  companion object {
    /** Where the form starts: the live texts with the diver's waiting edit laid over them. */
    fun start(form: ApiSiteTexts): SiteTextsDraft {
      val waiting = form.mine?.takeIf { it.status == "pending" }
      return SiteTextsDraft(
        description = waiting?.changes?.description ?: form.texts.description,
        howToDive = waiting?.changes?.howToDive ?: form.texts.howToDive,
        note = waiting?.note.orEmpty(),
      )
    }

    /**
     * What to send, or null when nothing changed. A field goes out when it differs from the live text or the diver's
     * waiting edit already changes it (sending it back as the live text drops it from that edit). Sending an untouched
     * field would undo an edit approved to it while the form was open. How to dive it is never sent while hidden.
     */
    fun body(form: ApiSiteTexts, draft: SiteTextsDraft): SiteTextsBody? {
      val waiting = form.mine?.takeIf { it.status == "pending" }?.changes
      // Compared and sent as the server will keep them, so a trailing space alone is no change.
      val description = clean(draft.description).takeIf { it != form.texts.description || waiting?.description != null }
      val howToDive =
        clean(draft.howToDive).takeIf { !form.adderTextHidden && (it != form.texts.howToDive || waiting?.howToDive != null) }
      if (description == null && howToDive == null) return null
      return SiteTextsBody(
        texts = ApiTextChanges(description = description, howToDive = howToDive),
        based =
          ApiTextChanges(
            description = form.texts.description.takeIf { description != null },
            howToDive = form.texts.howToDive.takeIf { howToDive != null },
          ),
        note = clean(draft.note).takeIf { it.isNotEmpty() },
      )
    }

    /** [text] cut to at most [max] characters, a character shorter where the cut would split an emoji in two. */
    fun cutAt(text: String, max: Int): String {
      if (text.length <= max) return text
      val end = if (max > 0 && text[max - 1].isHighSurrogate()) max - 1 else max
      return text.substring(0, end)
    }

    /** As cleanText in lib/site-details.ts: control characters dropped (newlines kept), blank-line runs squeezed, ends trimmed. */
    fun clean(text: String): String =
      text
        .replace(Regex("\r\n?"), "\n")
        .replace(Regex("[\u0000-\u0008\u000b-\u001f\u007f]"), "")
        .replace(Regex("\n{3,}"), "\n\n")
        .trim()
  }
}
