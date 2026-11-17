package app.fiftybar.divecurrent.domain

import app.fiftybar.divecurrent.data.api.Confidence
import app.fiftybar.divecurrent.data.api.GlanceTone
import app.fiftybar.divecurrent.data.api.Strength
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SiteOutlookTest {
  // Kandooma Thila, 17 Nov 2026 from 00:00 (levelM rounded): high 05:00, low 12:00, high 17:00, low 23:00.
  private val day =
    listOf(-0.11, -0.03, 0.06, 0.15, 0.22, 0.25, 0.23, 0.17, 0.09, 0.01, -0.06, -0.10, -0.11, -0.09, -0.05, -0.01, 0.01,
      0.02, 0.01, -0.03, -0.07, -0.10, -0.12, -0.13, -0.12)

  @Test
  fun `highs and lows are found where the tide turns`() {
    val turns = SiteOutlook.tideTurns(day)
    assertEquals(listOf(TideTurn(5, true), TideTurn(12, false), TideTurn(17, true), TideTurn(23, false)), turns)
  }

  @Test
  fun `a flat top counts once and the ends are never turns`() {
    assertEquals(listOf(TideTurn(2, true)), SiteOutlook.tideTurns(listOf(0.0, 0.1, 0.2, 0.2, 0.1)))
    assertEquals(emptyList<TideTurn>(), SiteOutlook.tideTurns(listOf(0.3, 0.2, 0.1)))
  }

  @Test
  fun `next turn and trend read from the hour`() {
    val turns = SiteOutlook.tideTurns(day)
    assertEquals(TideTurn(12, false), SiteOutlook.nextTurn(turns, 7))
    assertEquals(TideTurn(12, false), SiteOutlook.nextTurn(turns, 5))
    assertNull(SiteOutlook.nextTurn(turns, 23))
    assertEquals(TideTrend.Falling, SiteOutlook.trend(day, 7))
    assertEquals(TideTrend.Rising, SiteOutlook.trend(day, 0))
    assertEquals(TideTrend.Rising, SiteOutlook.trend(day, 14))
    assertNull(SiteOutlook.trend(listOf(0.1), 0))
  }

  private fun g(label: String, tone: GlanceTone) =
    Glance(90.0, "outgoing", "outgoing", "outgoing, toward E", label, Strength.Mild, Confidence.Low, 1f, tone, 1, false)

  @Test
  fun `the flow changes on a new strength word or a new way`() {
    val week =
      listOf(
        g("strong", GlanceTone.Outgoing),
        g("strong", GlanceTone.Outgoing),
        g("mild", GlanceTone.Outgoing),
        g("mild", GlanceTone.Incoming),
      )
    assertEquals(2, SiteOutlook.nextFlowChange(week, 0))
    assertEquals(3, SiteOutlook.nextFlowChange(week, 2))
    assertNull(SiteOutlook.nextFlowChange(week, 3))
    // An hour without a reading stops the look-ahead rather than skipping over it.
    assertNull(SiteOutlook.nextFlowChange(listOf(g("strong", GlanceTone.Outgoing), null, g("mild", GlanceTone.Outgoing)), 0))
  }

  @Test
  fun `days start at the first hour and every midnight`() {
    val times = listOf("2026-11-16T22:00", "2026-11-16T23:00", "2026-11-17T00:00", "2026-11-17T01:00", "2026-11-18T00:00")
    val starts = SiteOutlook.dayStarts(times)
    assertEquals(listOf(0, 2, 4), starts)
    assertEquals(0, SiteOutlook.dayOf(starts, 1))
    assertEquals(1, SiteOutlook.dayOf(starts, 3))
    assertEquals(2, SiteOutlook.dayOf(starts, 4))
  }
}
