package app.fiftybar.divecurrent.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The same cases as the web's lib/boat-nav.test.ts, so the app's panel reads as the web's. */
class BoatNavTest {
  /** One nautical mile of latitude is one minute of arc. */
  private val nmLat = 1.0 / 60

  private fun fix(timeS: Int, lat: Double, accuracyM: Double = 5.0, speedMs: Double? = null, headingDeg: Double? = null) =
    Fix(lat, 73.5, timeS * 1000L, accuracyM, speedMs, headingDeg)

  @Test
  fun `works out speed and course from positions when the phone gives no speed`() {
    val motion = BoatNav.motionFrom(listOf(fix(0, 4.0), fix(18, 4 + nmLat / 20), fix(36, 4 + nmLat / 10)))!!
    assertEquals(10.0, motion.knots, 0.5)
    assertEquals(0.0, motion.courseDeg!!, 0.5)
  }

  @Test
  fun `prefers the phone's own speed and heading`() {
    val motion = BoatNav.motionFrom(listOf(fix(0, 4.0), fix(10, 4.0001, speedMs = 5.144, headingDeg = 90.0)))!!
    assertEquals(10.0, motion.knots, 0.05)
    assertEquals(90.0, motion.courseDeg!!, 0.0)
  }

  @Test
  fun `calls a move inside the GPS accuracy drift, with no course`() {
    assertEquals(Motion(0.0, null), BoatNav.motionFrom(listOf(fix(0, 4.0, accuracyM = 20.0), fix(20, 4.0001, accuracyM = 20.0))))
    val withSpeed = BoatNav.motionFrom(listOf(fix(0, 4.0, accuracyM = 20.0), fix(20, 4.0001, accuracyM = 20.0, speedMs = 3.0)))!!
    assertTrue(withSpeed.knots > 5)
    assertNull(withSpeed.courseDeg)
  }

  @Test
  fun `says nothing until the fixes span a few seconds`() {
    assertNull(BoatNav.motionFrom(emptyList()))
    assertNull(BoatNav.motionFrom(listOf(fix(0, 4.0), fix(1, 4.0001))))
  }

  @Test
  fun `keeps only fixes inside the window, without out-of-order repeats`() {
    val window = (BoatNav.SPEED_WINDOW_MS / 1000).toInt()
    val kept = BoatNav.keepFixes(listOf(fix(0, 4.0), fix(10, 4.0), fix(window + 5, 4.0)), fix(window + 5, 4.1))
    assertEquals(listOf(10L to 4.0, (window + 5L) to 4.1), kept.map { it.timeMs / 1000 to it.lat })
  }

  private val route = listOf(LatLon(4.0, 73.5), LatLon(4 + nmLat, 73.5), LatLon(4 + nmLat, 73.5 + nmLat))

  @Test
  fun `measures what is left from the nearest point and steers for the next turn`() {
    val along = BoatNav.alongRoute(LatLon(4 + nmLat / 2, 73.5), route)
    assertEquals(0.0, along.offKm, 1e-3)
    val expected =
      BoatNav.distanceKm(LatLon(4.0, 73.5), LatLon(4 + nmLat / 2, 73.5)) + BoatNav.distanceKm(route[1], route[2])
    assertEquals(expected, along.remainingKm, 1e-3)
    assertEquals(route[1], along.next)
    assertEquals(1.11, BoatNav.alongRoute(LatLon(4 + nmLat / 4, 73.51), route).offKm, 0.05)
  }

  @Test
  fun `gives an ETA only under way, and words as the web panel`() {
    assertEquals(30.0, BoatNav.etaMinutes(1.852 * 5, 10.0)!!, 1e-6)
    assertNull(BoatNav.etaMinutes(5.0, 1.0))
    assertEquals("0.4 nm", BoatNav.formatNm(1.852 * 0.43))
    assertEquals("13 nm", BoatNav.formatNm(1.852 * 12.6))
    assertEquals("under 1 min", BoatNav.formatDuration(0.4))
    assertEquals("25 min", BoatNav.formatDuration(25.0))
    assertEquals("1 h 05 min", BoatNav.formatDuration(65.0))
    assertEquals("007° N", BoatNav.formatBearing(7.0))
    assertEquals("135° SE", BoatNav.formatBearing(135.4))
    assertEquals("000° N", BoatNav.formatBearing(359.7))
  }

  @Test
  fun `reads a point destination as the web writes it`() {
    val point = LatLon(4.123456, 73.5)
    assertEquals("4.12346,73.50000", PointDestination.id(point))
    assertEquals(LatLon(4.12346, 73.5), PointDestination.read("4.12346,73.50000"))
    assertNull(PointDestination.read("banana-reef"))
    assertNull(PointDestination.read("95.0,73.5"))
    assertEquals("Point 4.1235° N, 73.5000° E", PointDestination.name(point))
    assertTrue(PointDestination.inRouteArea(point))
    assertTrue(PointDestination.inRouteArea(LatLon(-0.69, 73.15)))
    assertFalse(PointDestination.inRouteArea(LatLon(51.5, -0.1)))
  }

  @Test
  fun `lists destinations nearest first, or by name, matching word starts in the site or atoll`() {
    val sites =
      listOf(
        Destination("a", "Banana Reef", "North Malé", 4.235, 73.535, null),
        Destination("b", "Fesdu Wreck", "Ari", 4.0, 72.8, null),
        Destination("c", "Kandooma Thila", "South Malé", 3.9, 73.48, null),
      )
    assertEquals(listOf("a", "b", "c"), Destinations.list(sites, "", null).first.map { it.id })
    val (near, total) = Destinations.list(sites, "", LatLon(3.9, 73.48))
    assertEquals(listOf("c", "a", "b"), near.map { it.id })
    assertEquals(3, total)
    assertEquals(0.0, near.first().km!!, 1e-9)
    assertEquals(listOf("b"), Destinations.list(sites, "fesdu-wreck", null).first.map { it.id })
    assertEquals(listOf("a", "c"), Destinations.list(sites, "male", null).first.map { it.id })
    assertEquals(emptyList<String>(), Destinations.list(sites, "reef ari", null).first.map { it.id })
  }
}
