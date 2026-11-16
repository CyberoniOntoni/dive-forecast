package app.fiftybar.divecurrent.domain

import app.fiftybar.divecurrent.data.api.ApiRouteCurrent
import app.fiftybar.divecurrent.data.api.ApiRouteCurrentHour
import app.fiftybar.divecurrent.data.api.ApiRouteCurrentSource
import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/** A current in knots, as its east and north parts. */
data class CurrentVector(val eastKn: Double, val northKn: Double) {
  val knots: Double
    get() = hypot(eastKn, northKn)

  /** The heading the water runs toward, degrees. */
  val headingDeg: Double
    get() = ((atan2(eastKn, northKn) * 180 / Math.PI) + 360) % 360

  companion object {
    fun of(headingDeg: Double, knots: Double): CurrentVector {
      val radians = headingDeg * Math.PI / 180
      return CurrentVector(knots * sin(radians), knots * cos(radians))
    }
  }
}

data class CurrentHere(val current: CurrentVector, val source: ApiRouteCurrentSource, val hour: ApiRouteCurrentHour)

data class Crabbed(val headingDeg: Double, val groundKnots: Double)

/** A site on the route whose forecast is very strong when the boat gets there. */
data class VeryStrongSite(val name: String, val siteId: String?, val timeMs: Long)

data class RouteTime(
  /** Minutes to the end, or null when the current somewhere ahead is too much for the boat at this speed. */
  val minutes: Double?,
  /** Sites ahead whose forecast is very strong when the boat gets there, in order, each once. */
  val veryStrong: List<VeryStrongSite>,
  /** Km of the remaining route with a current forecast. */
  val coveredKm: Double,
)

/**
 * The sea current along a boat route and what it does to the steer and the ETA, as the web panel works it out
 * (lib/route-current.ts) from the server's samples. Pure, so it is tested.
 */
object RouteCurrents {
  /** An hour's current counts for this long either side of its time. */
  private const val HOUR_REACH_MS = 90 * 60 * 1000L
  /** The ETA walks the route in steps this long at most, km. */
  private const val ETA_STEP_KM = 0.1

  /** The current [km] along the route at [timeMs], or null where no forecast covers that place and hour. */
  fun currentAt(route: ApiRouteCurrent, km: Double, timeMs: Long): CurrentHere? {
    if (route.samples.isEmpty() || !(route.stepKm > 0)) return null
    val index = min(route.samples.size - 1, max(0, jsRound(km / route.stepKm)))
    val source = route.sources.getOrNull(route.samples[index]) ?: return null
    var hour: ApiRouteCurrentHour? = null
    for (candidate in source.hours) {
      if (abs(candidate.timeMs - timeMs) > HOUR_REACH_MS) continue
      if (hour == null || abs(candidate.timeMs - timeMs) < abs(hour.timeMs - timeMs)) hour = candidate
    }
    return hour?.let { CurrentHere(CurrentVector(it.eastKn, it.northKn), source, it) }
  }

  /**
   * The heading to steer so a boat making [speedKnots] through the water holds [trackDeg] over the ground, and its
   * speed along the track. Null when the current across the track is faster than the boat, or the current ahead stops
   * it making way.
   */
  fun crab(trackDeg: Double, speedKnots: Double, current: CurrentVector): Crabbed? {
    val radians = trackDeg * Math.PI / 180
    val along = current.eastKn * sin(radians) + current.northKn * cos(radians)
    // Positive when the current sets the boat to the right of its track.
    val right = current.eastKn * cos(radians) - current.northKn * sin(radians)
    if (!(speedKnots > 0) || abs(right) >= speedKnots) return null
    val groundKnots = along + sqrt(speedKnots * speedKnots - right * right)
    if (!(groundKnots > 0)) return null
    val headingDeg = trackDeg - asin(right / speedKnots) * 180 / Math.PI
    return Crabbed(((headingDeg % 360) + 360) % 360, groundKnots)
  }

  /** The boat's speed through the water: over the ground less the current under it; the ground speed without either. */
  fun waterKnots(groundKnots: Double, courseDeg: Double?, current: CurrentVector?): Double {
    if (courseDeg == null || current == null) return groundKnots
    val ground = CurrentVector.of(courseDeg, groundKnots)
    return hypot(ground.eastKn - current.eastKn, ground.northKn - current.northKn)
  }

  /**
   * Time to run the route from [fromKm] to its end at [speedKnots] through the water, starting at [startMs], with the
   * current each stretch has when the boat reaches it. A stretch with no forecast is run at the boat's own speed.
   */
  fun routeTime(points: List<LatLon>, fromKm: Double, route: ApiRouteCurrent?, speedKnots: Double, startMs: Long): RouteTime {
    var hours = 0.0
    var atKm = 0.0
    var coveredKm = 0.0
    var blocked = false
    val veryStrong = mutableListOf<VeryStrongSite>()
    for (index in 0 until points.size - 1) {
      val from = points[index]
      val to = points[index + 1]
      val legKm = BoatNav.distanceKm(from, to)
      val legEnd = atKm + legKm
      if (legEnd <= fromKm || legKm == 0.0) {
        atKm = legEnd
        continue
      }
      val trackDeg = BoatNav.bearingDeg(from, to)
      var km = max(atKm, fromKm)
      while (km < legEnd - 1e-9) {
        val stepKm = min(ETA_STEP_KM, legEnd - km)
        val nowMs = startMs + (hours * 3_600_000).toLong()
        val here = route?.let { currentAt(it, km + stepKm / 2, nowMs) }
        var groundKnots = speedKnots
        if (here != null) {
          coveredKm += stepKm
          val made = crab(trackDeg, speedKnots, here.current)
          if (made != null) groundKnots = made.groundKnots else blocked = true
          if (here.hour.strength == "too_strong" && veryStrong.none { it.name == here.source.name }) {
            veryStrong += VeryStrongSite(here.source.name, here.source.siteId, nowMs)
          }
        }
        if (groundKnots > 0) hours += stepKm / BoatNav.KM_PER_NM / groundKnots
        km += stepKm
      }
      atKm = legEnd
    }
    return RouteTime(if (blocked || !(speedKnots > 0)) null else hours * 60, veryStrong, coveredKm)
  }

  private fun jsRound(value: Double): Int = kotlin.math.floor(value + 0.5).roundToInt()
}
