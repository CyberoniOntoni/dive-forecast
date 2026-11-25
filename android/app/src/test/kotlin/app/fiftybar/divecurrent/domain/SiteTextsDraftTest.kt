package app.fiftybar.divecurrent.domain

import app.fiftybar.divecurrent.data.api.ApiMyEdit
import app.fiftybar.divecurrent.data.api.ApiSiteTexts
import app.fiftybar.divecurrent.data.api.ApiTextChanges
import app.fiftybar.divecurrent.data.api.ApiTexts
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SiteTextsDraftTest {
  private val live = ApiTexts(description = "A slope.", howToDive = "Drop north.")

  private fun form(mine: ApiMyEdit? = null, hidden: Boolean = false) =
    ApiSiteTexts(siteId = "banana-reef", texts = live, canEdit = true, adderTextHidden = hidden, mine = mine)

  @Test
  fun `sends only the changed field, with the text it started from`() {
    val body = SiteTextsDraft.body(form(), SiteTextsDraft("A sandy slope.", "Drop north.", "  "))!!
    assertEquals(ApiTextChanges(description = "A sandy slope."), body.texts)
    assertEquals(ApiTextChanges(description = "A slope."), body.based)
    assertNull(body.note)
  }

  @Test
  fun `sends nothing when nothing changed`() {
    assertNull(SiteTextsDraft.body(form(), SiteTextsDraft.start(form())))
  }

  @Test
  fun `starts from the waiting edit and sends its fields again, even set back to the live text`() {
    val waiting = ApiMyEdit(id = "e1", status = "pending", changes = ApiTextChanges(howToDive = "Drop south."), note = "Dived it.")
    val start = SiteTextsDraft.start(form(waiting))
    assertEquals(SiteTextsDraft("A slope.", "Drop south.", "Dived it."), start)
    // Set back to what the site says: still sent, so the server drops it from the waiting edit.
    val body = SiteTextsDraft.body(form(waiting), start.copy(howToDive = "Drop north.", description = "A reef."))!!
    assertEquals(ApiTextChanges(description = "A reef.", howToDive = "Drop north."), body.texts)
    assertEquals("Dived it.", body.note)
  }

  @Test
  fun `a rejected edit is not where the form starts`() {
    val rejected = ApiMyEdit(id = "e1", status = "rejected", changes = ApiTextChanges(description = "Spam."), rejectReason = "No.")
    assertEquals(SiteTextsDraft("A slope.", "Drop north.", ""), SiteTextsDraft.start(form(rejected)))
  }

  @Test
  fun `never sends how to dive it while it is hidden`() {
    assertNull(SiteTextsDraft.body(form(hidden = true), SiteTextsDraft("A slope.", "Changed.", "")))
  }
}
