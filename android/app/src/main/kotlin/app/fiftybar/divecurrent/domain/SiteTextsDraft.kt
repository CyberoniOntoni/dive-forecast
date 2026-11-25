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
      val description = draft.description.takeIf { it != form.texts.description || waiting?.description != null }
      val howToDive =
        draft.howToDive.takeIf { !form.adderTextHidden && (it != form.texts.howToDive || waiting?.howToDive != null) }
      if (description == null && howToDive == null) return null
      return SiteTextsBody(
        texts = ApiTextChanges(description = description, howToDive = howToDive),
        based =
          ApiTextChanges(
            description = form.texts.description.takeIf { description != null },
            howToDive = form.texts.howToDive.takeIf { howToDive != null },
          ),
        note = draft.note.trim().takeIf { it.isNotEmpty() },
      )
    }
  }
}
