package app.fiftybar.divecurrent.domain

import app.fiftybar.divecurrent.data.api.Confidence
import app.fiftybar.divecurrent.data.api.GlanceTone
import app.fiftybar.divecurrent.data.api.Strength
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NowCountsTest {
  private fun g(strength: Strength) =
    Glance(90.0, "outgoing", "outgoing", "outgoing", strength.wire, strength, Confidence.Low, 1f, GlanceTone.Outgoing, 1, false)

  @Test
  fun `counts each strength and skips sites with no reading`() {
    val counts = NowCounts.of(listOf(g(Strength.TooStrong), g(Strength.Mild), g(Strength.Mild), null))
    assertEquals(1, counts.of(Strength.TooStrong))
    assertEquals(0, counts.of(Strength.Strong))
    assertEquals(2, counts.of(Strength.Mild))
    assertEquals(0, counts.of(Strength.Slack))
  }

  @Test
  fun `a picked strength passes only sites running it now`() {
    assertTrue(NowCounts.matches(null, null))
    assertTrue(NowCounts.matches(g(Strength.Strong), null))
    assertTrue(NowCounts.matches(g(Strength.Strong), Strength.Strong))
    assertFalse(NowCounts.matches(g(Strength.Mild), Strength.Strong))
    assertFalse(NowCounts.matches(null, Strength.Strong))
  }

  @Test
  fun `chips run strongest first`() {
    assertEquals(listOf(Strength.TooStrong, Strength.Strong, Strength.Mild, Strength.Slack), NowCounts.ORDER)
  }
}
