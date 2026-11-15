package app.fiftybar.divecurrent.domain

import app.fiftybar.divecurrent.data.api.ApiGlance
import app.fiftybar.divecurrent.data.api.ApiHour
import app.fiftybar.divecurrent.data.api.Confidence
import app.fiftybar.divecurrent.data.api.GlanceTone
import app.fiftybar.divecurrent.data.api.Strength
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The glance is made on the server; the app only reads it, and draws nothing for a value it does not know. */
class GlanceTest {
  private val serverGlance =
    ApiGlance(
      arrowBearing = 150.0,
      way = "outgoing",
      spokenWay = "outgoing",
      wayToward = "outgoing, toward SE",
      label = "very strong",
      tone = "stop",
      opacity = 0.74,
      rank = 0,
    )

  private val hour =
    ApiHour(time = "2026-11-15T09:00", direction = "outgoing", strength = "too_strong", confidence = "medium", glance = serverGlance)

  @Test
  fun `draws what the server sends`() {
    val g = glance(hour)!!
    assertEquals(150.0, g.arrowBearing, 0.0)
    assertEquals("outgoing, toward SE", g.wayToward)
    assertEquals("very strong", g.label)
    assertEquals(GlanceTone.Stop, g.tone)
    assertEquals(Strength.TooStrong, g.strength)
    assertEquals(Confidence.Medium, g.confidence)
    assertEquals(0, glanceRank(g))
  }

  @Test
  fun `no hour or no glance draws nothing and sorts last`() {
    assertNull(glance(null))
    assertNull(glance(hour.copy(glance = null)))
    assertEquals(Int.MAX_VALUE, glanceRank(null))
  }

  @Test
  fun `an unknown strength, confidence or tone draws nothing instead of a wrong reading`() {
    assertNull(glance(hour.copy(strength = "raging")))
    assertNull(glance(hour.copy(confidence = "certain")))
    assertNull(glance(hour.copy(glance = serverGlance.copy(tone = "purple"))))
  }

  @Test
  fun `compass words round halves up like the web`() {
    assertEquals("N", compassWord(0.0))
    assertEquals("NE", compassWord(22.5))
    assertEquals("NW", compassWord(-45.0))
    assertEquals("N", compassWord(359.0))
  }
}
