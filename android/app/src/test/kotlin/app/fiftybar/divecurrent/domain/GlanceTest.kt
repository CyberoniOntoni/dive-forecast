package app.fiftybar.divecurrent.domain

import app.fiftybar.divecurrent.data.api.ApiHour
import app.fiftybar.divecurrent.data.api.Direction.Incoming
import app.fiftybar.divecurrent.data.api.Direction.Outgoing
import app.fiftybar.divecurrent.data.api.ForecastRoute
import app.fiftybar.divecurrent.data.api.Strength
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The cases of lib/nowcast-glance.test.ts in the web repo, so the app reads an hour as the map does. */
class GlanceTest {
  private fun hour(direction: String, strength: String = "mild", confidence: String = "medium") =
    ApiHour("2026-11-15T09:00", direction, strength, confidence, 0.1)

  private val channel = Heading(ForecastRoute.Channel, inwardBearingDeg = 270.0, alongHeadingDeg = null)

  @Test
  fun `orders very strong, strong, mild, slack, then no forecast`() {
    val ranks = listOf("too_strong", "strong", "mild", "slack").map { glanceRank(glance(hour("incoming", it), channel)) }
    assertEquals(listOf(0, 1, 2, 3), ranks)
    assertEquals(4, glanceRank(null))
  }

  @Test
  fun `very strong takes the stop tone either way, others keep in or out`() {
    assertEquals(GlanceTone.Stop, glance(hour("outgoing", "too_strong"), channel)!!.tone)
    assertEquals(GlanceTone.Stop, glance(hour("incoming", "too_strong"), channel)!!.tone)
    assertEquals(GlanceTone.Incoming, glance(hour("incoming", "strong"), channel)!!.tone)
    assertEquals(GlanceTone.Outgoing, glance(hour("outgoing", "slack"), channel)!!.tone)
  }

  @Test
  fun `shows too_strong as very strong`() {
    assertEquals("very strong", strengthLabel(Strength.TooStrong))
  }

  @Test
  fun `wraps outgoing 270 to 90, not 450`() {
    assertEquals(90.0, passArrowBearing(270.0, Outgoing), 0.0)
    assertEquals(270.0, passArrowBearing(90.0, Outgoing), 0.0)
    assertEquals(270.0, passArrowBearing(270.0, Incoming), 0.0)
    assertEquals(90.0, glance(hour("outgoing"), channel)!!.arrowBearing, 0.0)
  }

  @Test
  fun `marks only a fallback heading as estimated`() {
    assertTrue(glance(hour("incoming"), channel.copy(bearingSource = "fallback"))!!.estimatedHeading)
    assertFalse(glance(hour("incoming"), channel.copy(bearingSource = "rim-derived"))!!.estimatedHeading)
  }

  @Test
  fun `draws no arrow when there is no bearing, even with an hour`() {
    assertNull(glance(hour("incoming"), channel.copy(inwardBearingDeg = null)))
  }

  @Test
  fun `names where a channel's water heads, and falls back to routeWay elsewhere`() {
    assertEquals("incoming, toward NE", routeWayToward(ForecastRoute.Channel, Incoming, 45.0, null))
    assertEquals("outgoing, toward SW", routeWayToward(ForecastRoute.Channel, Outgoing, 45.0, null))
    assertEquals("outgoing, toward W", routeWayToward(ForecastRoute.Channel, Outgoing, 45.0, null, 270.0))
    assertEquals("incoming", routeWayToward(ForecastRoute.Channel, Incoming, null, null))
    assertEquals("running E along the reef", routeWayToward(ForecastRoute.AlongReef, Incoming, 0.0, 90.0))
    assertEquals("running W", routeWayToward(ForecastRoute.Lagoon, Outgoing, 0.0, 90.0))
  }

  @Test
  fun `says incoming or outgoing on a channel, even with a stray heading`() {
    assertEquals("incoming" to "incoming", routeWay(ForecastRoute.Channel, Incoming, null))
    assertEquals("outgoing" to "outgoing", routeWay(ForecastRoute.Channel, Outgoing, 90.0))
  }

  @Test
  fun `calls a wall's flow along the reef and a lagoon's just running`() {
    assertEquals("running E" to "running E along the reef", routeWay(ForecastRoute.Strait, Incoming, 90.0))
    assertEquals("running S" to "running S along the reef", routeWay(ForecastRoute.AlongReef, Outgoing, 0.0))
    assertEquals("running E" to "running E", routeWay(ForecastRoute.Lagoon, Incoming, 90.0))
  }

  @Test
  fun `bends only a channel's outgoing arrow`() {
    assertEquals(150.0, routeArrowBearing(ForecastRoute.Channel, Outgoing, 300.0, null, 150.0), 0.0)
    assertEquals(270.0, routeArrowBearing(ForecastRoute.Strait, Outgoing, 300.0, 90.0, 150.0), 0.0)
    assertEquals(45.0, routeArrowBearing(ForecastRoute.Lagoon, Incoming, 300.0, 45.0), 0.0)
  }

  @Test
  fun `along a reef the tone is foam, not in or out`() {
    val along = Heading(ForecastRoute.AlongReef, inwardBearingDeg = 41.0, alongHeadingDeg = 131.0)
    val g = glance(hour("incoming", "strong"), along)!!
    assertEquals(GlanceTone.Along, g.tone)
    assertEquals(131.0, g.arrowBearing, 0.0)
    assertEquals("running SE", g.way)
  }

  @Test
  fun `compass words round halves up like JavaScript`() {
    assertEquals("N", compassWord(0.0))
    assertEquals("NE", compassWord(22.5))
    assertEquals("N", compassWord(359.0))
    assertEquals("W", compassWord(-90.0))
  }
}
