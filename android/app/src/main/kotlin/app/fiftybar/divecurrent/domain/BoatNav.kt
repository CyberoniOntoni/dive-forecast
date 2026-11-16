package app.fiftybar.divecurrent.domain

import java.util.Locale
import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToLong
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Boat navigation on the phone, as the web's Navigate panel does it (lib/boat-nav.ts, lib/geometry.ts): speed and
 * course over ground from GPS fixes, where the boat is along the route, and the words the panel shows. Pure, so it is
 * tested; the route itself comes from the server (GET /api/v1/boat-route).
 */
data class LatLon(val lat: Double, val lon: Double)

/** One GPS fix. [speedMs] and [headingDeg] are null when the phone does not give them. */
data class Fix(
  val lat: Double,
  val lon: Double,
  val timeMs: Long,
  val accuracyM: Double,
  val speedMs: Double? = null,
  val headingDeg: Double? = null,
) {
  val point: LatLon
    get() = LatLon(lat, lon)
}

data class Motion(val knots: Double, val courseDeg: Double?)

data class AlongRoute(
  /** Km left from the nearest point of the route to its end. */
  val remainingKm: Double,
  /** How far the boat is off the route. */
  val offKm: Double,
  /** The next turn (or the end) ahead of the nearest point: what to steer for. */
  val next: LatLon,
)

object BoatNav {
  const val KM_PER_NM = 1.852
  const val MS_PER_KNOT = KM_PER_NM / 3.6

  /** Fixes this old still count toward the speed worked out from positions. */
  const val SPEED_WINDOW_MS = 30_000L
  /** Positions this far apart in time at least, before a speed is worked out from them. */
  private const val SPEED_MIN_SPAN_MS = 4_000L
  /** Under this the boat counts as stopped: GPS drift, a drifting dhoni, no useful ETA. */
  const val UNDERWAY_KNOTS = 2.0
  /** Cruising speeds quoted while the boat is stopped: a dhoni and a speedboat. */
  val REFERENCE_KNOTS = listOf(8.0, 20.0)

  /** Off the route by this much, the route is planned again from where the boat is. */
  const val REROUTE_OFF_KM = 0.3
  /** At most one new route this often, however far off the boat goes. */
  const val REROUTE_EVERY_MS = 20_000L

  /** Great-circle distance, km. */
  fun distanceKm(a: LatLon, b: LatLon): Double {
    val toRad = Math.PI / 180
    val dLat = (b.lat - a.lat) * toRad
    val dLon = (b.lon - a.lon) * toRad
    val h = sin(dLat / 2).let { it * it } + cos(a.lat * toRad) * cos(b.lat * toRad) * sin(dLon / 2).let { it * it }
    return 2 * 6371 * asin(min(1.0, sqrt(h)))
  }

  /** Initial great-circle bearing from a to b, degrees clockwise from north, in [0, 360). */
  fun bearingDeg(a: LatLon, b: LatLon): Double {
    val toRad = Math.PI / 180
    val startLat = a.lat * toRad
    val endLat = b.lat * toRad
    val deltaLon = (b.lon - a.lon) * toRad
    val east = sin(deltaLon) * cos(endLat)
    val north = cos(startLat) * sin(endLat) - sin(startLat) * cos(endLat) * cos(deltaLon)
    val degrees = atan2(east, north) * 180 / Math.PI
    return ((degrees % 360) + 360) % 360
  }

  fun polylineKm(points: List<LatLon>): Double = points.zipWithNext { a, b -> distanceKm(a, b) }.sum()

  /**
   * Speed and course over ground from the latest fixes. The phone's own speed wins when it gives one; otherwise the
   * distance between the oldest fix in the last [SPEED_WINDOW_MS] and the newest, over the time between them. A move
   * smaller than the fixes' accuracy is drift, not way: speed 0. Null until there is enough to say.
   */
  fun motionFrom(fixes: List<Fix>): Motion? {
    val latest = fixes.lastOrNull() ?: return null
    val oldest = fixes.firstOrNull { latest.timeMs - it.timeMs <= SPEED_WINDOW_MS } ?: latest
    val span = latest.timeMs - oldest.timeMs
    val movedKm = distanceKm(oldest.point, latest.point)
    val driftM = (oldest.accuracyM + latest.accuracyM) / 2
    val derivedCourse = if (span >= SPEED_MIN_SPAN_MS && movedKm * 1000 > driftM) bearingDeg(oldest.point, latest.point) else null
    val deviceCourse = latest.headingDeg?.takeIf { it.isFinite() }
    val speed = latest.speedMs
    if (speed != null && speed.isFinite()) {
      val knots = max(0.0, speed) / MS_PER_KNOT
      return Motion(knots, if (knots >= UNDERWAY_KNOTS) deviceCourse ?: derivedCourse else null)
    }
    if (span < SPEED_MIN_SPAN_MS) return null
    if (movedKm * 1000 <= driftM) return Motion(0.0, null)
    val knots = movedKm / KM_PER_NM / (span / 3_600_000.0)
    return Motion(knots, if (knots >= UNDERWAY_KNOTS) deviceCourse ?: derivedCourse else null)
  }

  /** Fixes kept for [motionFrom]: those inside the window, plus the new one. */
  fun keepFixes(fixes: List<Fix>, next: Fix): List<Fix> =
    fixes.filter { next.timeMs - it.timeMs <= SPEED_WINDOW_MS && it.timeMs < next.timeMs } + next

  /** Where the boat is along a route (at least one point). */
  fun alongRoute(boat: LatLon, points: List<LatLon>): AlongRoute {
    val last = points.last()
    if (points.size == 1) {
      val km = distanceKm(boat, last)
      return AlongRoute(km, km, last)
    }
    // A degree of longitude is cos(lat) of a degree of latitude, so legs are measured in degrees of latitude.
    val lonScale = cos(boat.lat * Math.PI / 180)
    var bestFoot = points[0]
    var bestSegment = 0
    var bestSq = Double.POSITIVE_INFINITY
    for (index in 0 until points.size - 1) {
      val a = points[index]
      val b = points[index + 1]
      val dx = b.lat - a.lat
      val dy = (b.lon - a.lon) * lonScale
      val px = boat.lat - a.lat
      val py = (boat.lon - a.lon) * lonScale
      val lengthSq = dx * dx + dy * dy
      val along = if (lengthSq == 0.0) 0.0 else ((px * dx + py * dy) / lengthSq).coerceIn(0.0, 1.0)
      val footLat = a.lat + along * dx
      val footY = a.lon * lonScale + along * dy
      val sq = (footLat - boat.lat).let { it * it } + (footY - boat.lon * lonScale).let { it * it }
      // The first segment wins a tie, as on the web.
      if (sq < bestSq) {
        bestSq = sq
        bestSegment = index
        bestFoot = LatLon(footLat, footY / lonScale)
      }
    }
    return AlongRoute(
      remainingKm = polylineKm(listOf(bestFoot) + points.drop(bestSegment + 1)),
      offKm = distanceKm(boat, bestFoot),
      next = points[bestSegment + 1],
    )
  }

  /** Minutes to cover [km] at [knots], or null while the boat is stopped. */
  fun etaMinutes(km: Double, knots: Double): Double? = if (knots >= UNDERWAY_KNOTS) km / KM_PER_NM / knots * 60 else null

  /** "0.4 nm", "12 nm": tenths below 10 nm. */
  fun formatNm(km: Double): String {
    val nm = km / KM_PER_NM
    return if (nm < 10) "${"%.1f".format(Locale.ROOT, nm)} nm" else "${jsRound(nm)} nm"
  }

  /** "under 1 min", "25 min", "1 h 05 min". */
  fun formatDuration(minutes: Double): String {
    val rounded = jsRound(minutes)
    if (rounded < 1) return "under 1 min"
    if (rounded < 60) return "$rounded min"
    return "${rounded / 60} h ${(rounded % 60).toString().padStart(2, '0')} min"
  }

  private val COMPASS = listOf("N", "NE", "E", "SE", "S", "SW", "W", "NW")

  /** "135° SE". */
  fun formatBearing(deg: Double): String {
    val whole = (jsRound(deg) % 360 + 360) % 360
    return "${whole.toString().padStart(3, '0')}° ${COMPASS[jsRound(whole / 45.0) % 8]}"
  }

  /** The smaller angle between two headings, 0 to 180 degrees. */
  fun headingGapDeg(a: Double, b: Double): Double = abs(((a - b + 540) % 360) - 180)
}

/** Math.round as JavaScript does it (halves up), so the app's numbers and words match the web's. */
internal fun jsRound(value: Double): Int = floor(value + 0.5).roundToLong().toInt()
