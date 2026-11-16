package app.fiftybar.divecurrent.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlanLinkTest {
  private val id = "Kq7vHtmWpdNrcXfa"

  @Test
  fun `reads the id from a link, a path or the id itself`() {
    assertEquals(id, PlanLink.idOf("https://50bar.app/plans/$id"))
    assertEquals(id, PlanLink.idOf("  https://50bar.app/plans/$id?ref=chat "))
    assertEquals(id, PlanLink.idOf("/plans/$id"))
    assertEquals(id, PlanLink.idOf("/plans/$id/"))
    assertEquals(id, PlanLink.idOf(id))
  }

  @Test
  fun `refuses anything else, the editor's new-plan page included`() {
    assertNull(PlanLink.idOf(null))
    assertNull(PlanLink.idOf(""))
    assertNull(PlanLink.idOf("/plans/new"))
    assertNull(PlanLink.idOf("https://50bar.app/plans/$id/edit"))
    assertNull(PlanLink.idOf("/plans/${id}x"))
    // 0, 1, I, O and l are never in an id.
    assertNull(PlanLink.idOf("/plans/Kq7vHtmWpdNrcXf0"))
    assertNull(PlanLink.idOf("https://50bar.app/sites/banana-reef"))
  }
}
