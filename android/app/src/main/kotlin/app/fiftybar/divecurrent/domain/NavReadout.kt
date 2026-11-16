package app.fiftybar.divecurrent.domain

import app.fiftybar.divecurrent.data.api.ApiBoatRoute
import java.time.Instant
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.max

/**
 * Everything the boat panel shows at one moment, worked out as the web's BoatNav panel does (components/BoatNav.tsx):
 * distance left, speed, steer allowing for the current, ETA with the current each stretch has when the boat gets
 * there, and the warnings. Pure, so it is tested; the screen only draws it.
 */
data class NavReadout(
  val remainingKm: Double?,
  /** "To go, by route" when the route found a way round the reef. */
  val byRoute: Boolean,
  val motion: Motion?,
  val stopped: Boolean,
  /** The heading to steer, allowing for the current when it is known. */
  val steerDeg: Double?,
  /** Minutes to the end at the boat's speed through the water, or null. */
  val etaMinutes: Double?,
  /** "14:35", Maldives time, with [etaMinutes]. */
  val arrival: String?,
  /** Under way, but the current ahead is stronger than the boat makes through the water. */
  val currentBeatsBoat: Boolean,
  /** While stopped: "At 8 kn about 25 min, At 20 kn about 10 min". */
  val referenceLine: String?,
  /** The small line under the readouts: steer, current, course, route, gaps, GPS, not a chart. */
  val note: String,
  /** Route trouble, in amber. */
  val trouble: String?,
  /** "Very strong current forecast at Kandooma Thila around 14:10." */
  val veryStrongLine: String?,
  /** The route crosses a reef-flat sill. */
  val shallow: Boolean,
)

object NavReadouts {
  /** The steer names its track once they differ by this many degrees. */
  private const val STEER_NOTE_DEG = 2.0
  /** Below this the current is not worth a word. */
  private const val CURRENT_NOTE_KNOTS = 0.2
  private val CLOCK = DateTimeFormatter.ofPattern("HH:mm", Locale.ROOT)

  /** "14:35" in the Maldives for a Unix-ms time. */
  fun clock(timeMs: Long): String = LocalDateTime.ofInstant(Instant.ofEpochMilli(timeMs), MaldivesTime.OFFSET).format(CLOCK)

  fun points(route: ApiBoatRoute): List<LatLon> = route.points.filter { it.size >= 2 }.map { LatLon(it[0], it[1]) }

  /**
   * @param fixes the latest GPS fixes, oldest first.
   * @param route the last route from the server, or null while the first is on its way.
   * @param routeFailed the last request for a route failed (or the destination is unknown).
   * @param nowMs the phone's clock, for the arrival time.
   */
  fun of(
    destination: LatLon,
    fixes: List<Fix>,
    route: ApiBoatRoute?,
    routeFailed: Boolean,
    nowMs: Long,
  ): NavReadout? {
    val boat = fixes.lastOrNull() ?: return null
    val motion = BoatNav.motionFrom(fixes)
    val points = route?.let { points(it) }?.takeIf { it.isNotEmpty() }
    val along = points?.let { BoatNav.alongRoute(boat.point, it) }
    val remainingKm = along?.remainingKm ?: BoatNav.distanceKm(boat.point, destination)
    // How far along the route the boat is, and the forecast current there now.
    val routeKm = if (route != null && along != null) max(0.0, route.lengthKm - along.remainingKm) else 0.0
    val here = route?.current?.let { RouteCurrents.currentAt(it, routeKm, boat.timeMs) }
    val stopped = motion != null && motion.knots < BoatNav.UNDERWAY_KNOTS
    val throughWater = if (motion != null && !stopped) RouteCurrents.waterKnots(motion.knots, motion.courseDeg, here?.current) else null
    val track = BoatNav.bearingDeg(boat.point, along?.next ?: destination)
    val crabbed = if (here != null && throughWater != null) RouteCurrents.crab(track, throughWater, here.current) else null
    val steer = crabbed?.headingDeg ?: track

    fun timeAt(knots: Double): RouteTime? =
      if (points != null && along != null) RouteCurrents.routeTime(points, routeKm, route.current, knots, boat.timeMs) else null

    val timed = throughWater?.let(::timeAt)
    val eta =
      when {
        throughWater == null -> null
        timed != null -> timed.minutes
        else -> BoatNav.etaMinutes(remainingKm, throughWater)
      }
    val currentBeatsBoat = throughWater != null && timed != null && timed.minutes == null
    val referenceLine =
      if (stopped) {
        BoatNav.REFERENCE_KNOTS.joinToString(", ") { knots ->
          val walked = timeAt(knots)
          val minutes = if (walked != null) walked.minutes else BoatNav.etaMinutes(remainingKm, knots)
          val kn = knots.toInt()
          if (minutes == null) "At $kn kn the current is against you" else "At $kn kn about ${BoatNav.formatDuration(minutes)}"
        }
      } else null
    val veryStrong = (timed ?: if (stopped) timeAt(BoatNav.REFERENCE_KNOTS[0]) else null)?.veryStrong.orEmpty()

    val routed = route?.routed == true
    val gaps = if (routed) route.gaps.size else 0
    val knots = here?.current?.knots ?: 0.0
    val steerTrack = if (crabbed != null) track else null
    val steerOffTrack = steerTrack != null && BoatNav.headingGapDeg(steer, steerTrack) >= STEER_NOTE_DEG
    val parts =
      listOfNotNull(
        "Steer ${BoatNav.formatBearing(steer)}" + if (steerOffTrack) " for track ${BoatNav.formatBearing(steerTrack)}" else "",
        if (here != null && knots >= CURRENT_NOTE_KNOTS) {
          "current ${"%.1f".format(Locale.ROOT, knots)} kn toward ${compassWord(here.current.headingDeg)}" +
            (if (here.source.siteId != null) " (${here.source.name})" else "")
        } else null,
        motion?.courseDeg?.let { "course ${BoatNav.formatBearing(it)}" },
        route?.takeIf { routed }?.let { "${BoatNav.formatNm(it.lengthKm)} by route (${BoatNav.formatNm(it.directKm)} straight)" },
        when {
          gaps == 1 -> "1 reef gap"
          gaps > 1 -> "$gaps reef gaps"
          else -> null
        },
        "GPS ±${Math.round(boat.accuracyM)} m",
        "not a chart, keep a lookout",
      )
    val note = (if (route == null && !routeFailed) "Planning the route… · " else "") + parts.joinToString(" · ")
    val trouble =
      when {
        routeFailed && route != null -> "Could not update the route; showing the last one."
        routeFailed -> "No route yet; the line is straight to the destination. Trying again shortly."
        route != null && !route.routed -> "No way round the mapped reef found; the line is straight to the destination."
        else -> null
      }
    return NavReadout(
      remainingKm = remainingKm,
      byRoute = routed,
      motion = motion,
      stopped = stopped,
      steerDeg = steer,
      etaMinutes = eta,
      arrival = eta?.let { clock(nowMs + (it * 60_000).toLong()) },
      currentBeatsBoat = currentBeatsBoat,
      referenceLine = referenceLine,
      note = note,
      trouble = trouble,
      veryStrongLine =
        veryStrong.takeIf { it.isNotEmpty() }?.joinToString(", ", "Very strong current forecast at ", ".") {
          "${it.name} around ${clock(it.timeMs)}"
        },
      shallow = route?.gaps?.any { it.shallow } == true,
    )
  }

  /** Whether to ask for a new route now: none yet, or the boat has left it; never more often than every 20 s. */
  fun shouldReroute(boat: LatLon, route: ApiBoatRoute?, lastAskMs: Long?, busy: Boolean, nowMs: Long): Boolean {
    if (busy) return false
    if (lastAskMs != null && nowMs - lastAskMs < BoatNav.REROUTE_EVERY_MS) return false
    val points = route?.let { points(it) }?.takeIf { it.isNotEmpty() } ?: return true
    return BoatNav.alongRoute(boat, points).offKm > BoatNav.REROUTE_OFF_KM
  }
}
