package app.fiftybar.divecurrent.domain

import app.fiftybar.divecurrent.data.api.ApiBoatRoute
import app.fiftybar.divecurrent.data.api.ApiRouteCurrent
import app.fiftybar.divecurrent.data.api.ApiRouteCurrentHour
import app.fiftybar.divecurrent.data.api.ApiRouteCurrentSource
import app.fiftybar.divecurrent.data.api.ApiRouteGap
import kotlin.math.asin
import kotlin.math.sqrt
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The same cases as the web's lib/route-current.test.ts, plus the panel's readout. */
class RouteCurrentTest {
  private val nmLat = 1.0 / 60
  private val t0 = 1_793_329_200_000L // 30 Oct 2026, 03:00 UTC
  private val hour = 3_600_000L

  private fun northRoute(nm: Double) = listOf(LatLon(4.0, 73.5), LatLon(4 + nm * nmLat, 73.5))

  private data class H(val at: Int, val heading: Double, val knots: Double, val strength: String = "mild")

  private fun steady(hours: List<H>, samples: Int = 50) =
    ApiRouteCurrent(
      stepKm = 0.25,
      samples = List(samples) { 0 },
      sources =
        listOf(
          ApiRouteCurrentSource(
            siteId = "pass",
            name = "Test Kandu",
            hours =
              hours.map {
                val v = CurrentVector.of(it.heading, it.knots)
                ApiRouteCurrentHour(t0 + it.at * hour, v.eastKn, v.northKn, it.strength)
              },
          )
        ),
    )

  @Test
  fun `round-trips heading and speed`() {
    val current = CurrentVector.of(135.0, 2.0)
    assertEquals(2.0, current.knots, 1e-9)
    assertEquals(135.0, current.headingDeg, 1e-9)
  }

  @Test
  fun `crabs into a cross current, and gives up when it is too much`() {
    assertEquals(Crabbed(90.0, 10.0), RouteCurrents.crab(90.0, 10.0, CurrentVector(0.0, 0.0)))
    assertEquals(12.0, RouteCurrents.crab(0.0, 10.0, CurrentVector.of(0.0, 2.0))!!.groundKnots, 1e-9)
    assertEquals(8.0, RouteCurrents.crab(0.0, 10.0, CurrentVector.of(180.0, 2.0))!!.groundKnots, 1e-9)
    val made = RouteCurrents.crab(0.0, 10.0, CurrentVector.of(90.0, 2.0))!!
    assertEquals(360 - asin(0.2) * 180 / Math.PI, made.headingDeg, 1e-6)
    assertEquals(sqrt(96.0), made.groundKnots, 1e-6)
    assertNull(RouteCurrents.crab(0.0, 2.0, CurrentVector.of(90.0, 3.0)))
    assertNull(RouteCurrents.crab(0.0, 2.0, CurrentVector.of(180.0, 2.5)))
    assertEquals(0.4, RouteCurrents.crab(0.0, 8.0, CurrentVector.of(180.0, 7.6))!!.groundKnots, 1e-9)
  }

  @Test
  fun `takes the current out of the speed over ground`() {
    assertEquals(10.0, RouteCurrents.waterKnots(12.0, 0.0, CurrentVector.of(0.0, 2.0)), 1e-9)
    assertEquals(12.0, RouteCurrents.waterKnots(12.0, null, CurrentVector.of(0.0, 2.0)), 0.0)
    assertEquals(12.0, RouteCurrents.waterKnots(12.0, 0.0, null), 0.0)
  }

  @Test
  fun `reads the nearest hour within 90 minutes, and nothing where no source covers the route`() {
    val route = steady(listOf(H(0, 0.0, 1.0), H(1, 180.0, 1.0)))
    assertEquals(0.0, RouteCurrents.currentAt(route, 1.0, t0 + 20 * 60_000)!!.current.headingDeg, 1e-6)
    assertEquals(180.0, RouteCurrents.currentAt(route, 1.0, t0 + 40 * 60_000)!!.current.headingDeg, 1e-6)
    assertNull(RouteCurrents.currentAt(route, 1.0, t0 + 3 * hour))
    val gappy = steady(listOf(H(0, 0.0, 1.0))).copy(samples = listOf(0, -1, 0))
    assertNull(RouteCurrents.currentAt(gappy, 0.25, t0))
    assertNotNull(RouteCurrents.currentAt(gappy, 0.5, t0))
  }

  @Test
  fun `times the route with the current each stretch has when the boat gets there`() {
    assertEquals(30.0, RouteCurrents.routeTime(northRoute(5.0), 0.0, null, 10.0, t0).minutes!!, 0.1)
    val behind = RouteCurrents.routeTime(northRoute(5.0), 0.0, steady(listOf(H(0, 0.0, 2.0))), 10.0, t0)
    assertEquals(25.0, behind.minutes!!, 0.1)
    assertEquals(5 * 1.852, behind.coveredKm, 0.1)
    assertEquals(37.5, RouteCurrents.routeTime(northRoute(5.0), 0.0, steady(listOf(H(0, 180.0, 2.0))), 10.0, t0).minutes!!, 0.1)
    assertEquals(6.0, RouteCurrents.routeTime(northRoute(5.0), 1.852 * 4, null, 10.0, t0).minutes!!, 0.1)
    val turning = steady(listOf(H(0, 0.0, 0.0), H(1, 0.0, 0.0), H(2, 180.0, 2.0), H(3, 180.0, 2.0), H(4, 180.0, 2.0)), 100)
    assertEquals(140.0, RouteCurrents.routeTime(northRoute(10.0), 0.0, turning, 5.0, t0).minutes!!, 0.5)
  }

  @Test
  fun `is null when the current ahead beats the boat, and names very strong sites once`() {
    val time = RouteCurrents.routeTime(northRoute(2.0), 0.0, steady(listOf(H(0, 180.0, 2.5, "too_strong"))), 2.0, t0)
    assertNull(time.minutes)
    assertEquals(listOf(VeryStrongSite("Test Kandu", "pass", t0)), time.veryStrong)
  }

  private fun route(current: ApiRouteCurrent?, routed: Boolean = true) =
    ApiBoatRoute(
      points = northRoute(5.0).map { listOf(it.lat, it.lon) },
      lengthKm = 5 * 1.852,
      directKm = 5 * 1.852,
      routed = routed,
      gaps = listOf(ApiRouteGap(4.05, 73.5, 300.0, shallow = true)),
      current = current,
    )

  @Test
  fun `the panel steers into the current and times the trip with it`() {
    val target = LatLon(4 + 5 * nmLat, 73.5)
    // Due north at 10 kn over the ground with 2 kn setting east.
    val fixes = listOf(Fix(4.0, 73.5, t0, 5.0, speedMs = 10 * BoatNav.MS_PER_KNOT, headingDeg = 0.0))
    val readout = NavReadouts.of(target, fixes, route(steady(listOf(H(0, 90.0, 2.0)))), routeFailed = false, nowMs = t0)!!
    assertTrue(readout.byRoute)
    assertEquals(BoatNav.distanceKm(LatLon(4.0, 73.5), target), readout.remainingKm!!, 1e-6)
    // Through the water: hypot(10, 2) kn, and the steer points west of north.
    val steer = readout.steerDeg!!
    assertTrue(steer > 340 && steer < 360)
    assertEquals(30.0, readout.etaMinutes!!, 0.5)
    assertEquals("08:30", readout.arrival)
    assertTrue(readout.note, readout.note.startsWith("Steer 349° N for track 000° N · current 2.0 kn toward E (Test Kandu)"))
    assertTrue(readout.note, readout.note.contains("1 reef gap") && readout.note.endsWith("GPS ±5 m"))
    assertTrue(readout.shallow)
    assertNull(readout.trouble)
    assertFalse(readout.currentBeatsBoat)
  }

  @Test
  fun `a stopped boat gets times at a dhoni's and a speedboat's speed, and route trouble is said`() {
    val target = LatLon(4 + 5 * nmLat, 73.5)
    val stopped = listOf(Fix(4.0, 73.5, t0, 5.0, speedMs = 0.0))
    val readout = NavReadouts.of(target, stopped, route(null), routeFailed = false, nowMs = t0)!!
    assertTrue(readout.stopped)
    assertNull(readout.etaMinutes)
    assertEquals("At 8 kn about 38 min · At 20 kn about 15 min", readout.referenceLine)
    val waiting = NavReadouts.of(target, stopped, null, routeFailed = false, nowMs = t0)!!
    assertTrue(waiting.note.startsWith("Planning the route… · "))
    val failed = NavReadouts.of(target, stopped, null, routeFailed = true, nowMs = t0)!!
    assertEquals("No route yet; the line is straight to the destination. Trying again shortly.", failed.trouble)
    val straight = NavReadouts.of(target, stopped, route(null, routed = false), routeFailed = false, nowMs = t0)!!
    assertEquals("No way round the mapped reef found; the line is straight to the destination.", straight.trouble)
    assertNull(NavReadouts.of(target, emptyList(), null, routeFailed = false, nowMs = t0))
  }

  @Test
  fun `asks for a route at first, then only off it, and never twice in 20 seconds`() {
    val boat = LatLon(4.0, 73.5)
    val onRoute = route(null)
    assertTrue(NavReadouts.shouldReroute(boat, null, null, busy = false, nowMs = t0))
    assertFalse(NavReadouts.shouldReroute(boat, null, null, busy = true, nowMs = t0))
    assertFalse(NavReadouts.shouldReroute(boat, null, t0 - 5_000, busy = false, nowMs = t0))
    assertFalse(NavReadouts.shouldReroute(boat, onRoute, t0 - 60_000, busy = false, nowMs = t0))
    assertTrue(NavReadouts.shouldReroute(LatLon(4.0, 73.51), onRoute, t0 - 60_000, busy = false, nowMs = t0))
  }
}
