package app.fiftybar.divecurrent.domain

import app.fiftybar.divecurrent.data.api.ApiEditablePlan
import app.fiftybar.divecurrent.data.api.ApiPlanLimits
import app.fiftybar.divecurrent.data.api.PlanDayBody
import app.fiftybar.divecurrent.data.api.PlanStopBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlanDraftTest {
  private val limits = ApiPlanLimits()
  private val known = setOf("furana-south", "banana-reef")
  private val channels = setOf("furana-south")

  private fun twoDives(): PlanDraft {
    var draft = PlanDraft.new("2026-11-17", limits).withTitle("North Malé week")
    val day = draft.days.single().key
    draft = draft.addStop(day).addStop(day)
    val (first, second) = draft.days.single().stops
    return draft
      .changeStop(day, first.key) { it.copy(siteId = "furana-south", want = "incoming") }
      .changeStop(day, second.key) { it.copy(siteId = "banana-reef", want = "incoming", note = "  Drift  ") }
  }

  @Test
  fun `a new plan starts today at the default boat speed, and dives at the usual times`() {
    val draft = twoDives()
    assertEquals("8", draft.speed)
    assertEquals("2026-11-17", draft.days.single().date)
    assertEquals(listOf("07:00", "10:30"), draft.days.single().stops.map { it.time })
    assertEquals("2026-11-18", draft.addDay("2026-11-17").days.last().date)
  }

  @Test
  fun `sends a wanted way only at a channel, and leaves out empty text`() {
    val body = twoDives().body { it in channels }
    assertNull(body.notes)
    assertEquals(
      listOf(PlanStopBody("furana-south", "07:00", null, "incoming"), PlanStopBody("banana-reef", "10:30", "Drift", null)),
      body.days.single().stops,
    )
    assertEquals(8.0, body.boatSpeedKn, 0.0)
  }

  @Test
  fun `moving a dive keeps each slot's time`() {
    val draft = twoDives()
    val moved = draft.moveStop(draft.days.single().key, 0, 1).days.single().stops
    assertEquals(listOf("banana-reef", "furana-south"), moved.map { it.siteId })
    assertEquals(listOf("07:00", "10:30"), moved.map { it.time })
    assertEquals(draft, draft.moveStop(draft.days.single().key, 1, 1))
  }

  @Test
  fun `finds what the server would refuse, in its words`() {
    val ok = twoDives()
    assertNull(ok.problem(limits) { it in known })
    assertEquals("Give the plan a title", ok.withTitle("  ").problem(limits) { it in known })
    assertEquals("Boat speed must be 3 to 40 knots", ok.withSpeed("2").problem(limits) { it in known })
    assertNull(ok.withSpeed("7,5").problem(limits) { it in known })
    val day = ok.days.single().key
    assertEquals("Pick a dive site for each dive on Tue 17 Nov", ok.addStop(day).problem(limits) { it in known })
    val twice = ok.addDay("2026-11-17").let { it.setDate(it.days.last().key, "2026-11-17") }
    assertEquals("Tue 17 Nov is in the plan twice", twice.problem(limits) { it in known })
    assertEquals("Add at least one day", ok.removeDay(day).problem(limits) { it in known })
  }

  @Test
  fun `opens a saved plan as it was`() {
    val plan =
      ApiEditablePlan(
        id = "Kq7vHtmWpdNrcXfa",
        title = "Ari",
        notes = "Bring a hook",
        boatSpeedKn = 7.5,
        days = listOf(PlanDayBody("2026-11-17", listOf(PlanStopBody("furana-south", "09:00", "Early", "outgoing")))),
      )
    val draft = PlanDraft.from(plan)
    assertEquals("7.5", draft.speed)
    assertEquals("Bring a hook", draft.notes)
    assertEquals(DraftStop(draft.days.single().stops.single().key, "furana-south", "09:00", "Early", "outgoing"), draft.days.single().stops.single())
    assertEquals(plan.days, draft.body { true }.days)
  }
}
