package app.fiftybar.divecurrent.domain

import app.fiftybar.divecurrent.data.api.ApiHour
import app.fiftybar.divecurrent.data.api.Confidence
import app.fiftybar.divecurrent.data.api.Direction
import app.fiftybar.divecurrent.data.api.ForecastRoute
import app.fiftybar.divecurrent.data.api.Strength

/*
 * How one forecast hour reads on screen. A port of lib/nowcast-glance.ts in the web repo, so the app's arrows and
 * words match the map's: keep the two in step (GlanceTest mirrors the web tests' cases).
 */

/** Stored as too_strong; shown as "very strong", since whether it can be dived depends on the diver. */
fun strengthLabel(strength: Strength): String =
  when (strength) {
    Strength.Slack -> "slack"
    Strength.Mild -> "mild"
    Strength.Strong -> "strong"
    Strength.TooStrong -> "very strong"
  }

fun confidenceLabel(confidence: Confidence): String = confidence.name.lowercase()

/** Low confidence draws quieter. High stays solid. */
fun confidenceOpacity(confidence: Confidence): Float =
  when (confidence) {
    Confidence.Low -> 0.42f
    Confidence.Medium -> 0.74f
    Confidence.High -> 1f
  }

/** Which colour token a glance takes: very strong is the stop colour; along a reef there is no in/out colour. */
enum class GlanceTone {
  Incoming,
  Outgoing,
  Along,
  Stop,
}

data class Glance(
  /** Degrees clockwise from north. */
  val arrowBearing: Double,
  val direction: Direction,
  /** "incoming", "outgoing", or "running NE" on a compass route. */
  val way: String,
  /** The way in a sentence: adds "along the reef" at a wall. */
  val spokenWay: String,
  val strength: Strength,
  val confidence: Confidence,
  val opacity: Float,
  val tone: GlanceTone,
  /** True when the heading comes from the fallback heuristic, not a measurement or the atoll rim. */
  val estimatedHeading: Boolean,
)

/** Everything a site-hour's reading needs besides the hour itself. */
data class Heading(
  val route: ForecastRoute,
  val inwardBearingDeg: Double?,
  val alongHeadingDeg: Double?,
  val outgoingBearingDeg: Double? = null,
  val bearingSource: String? = null,
)

/** Null when there is no hour, an unknown strength, or no bearing to point the arrow. */
fun glance(hour: ApiHour?, heading: Heading): Glance? {
  if (hour == null) return null
  val inward = heading.inwardBearingDeg ?: return null
  val strength = Strength.of(hour.strength) ?: return null
  val direction = Direction.of(hour.direction)
  val confidence = Confidence.of(hour.confidence)
  val (way, spoken) = routeWay(heading.route, direction, heading.alongHeadingDeg)
  return Glance(
    arrowBearing =
      routeArrowBearing(heading.route, direction, inward, heading.alongHeadingDeg, heading.outgoingBearingDeg),
    direction = direction,
    way = way,
    spokenWay = spoken,
    strength = strength,
    confidence = confidence,
    opacity = confidenceOpacity(confidence),
    tone =
      when {
        strength == Strength.TooStrong -> GlanceTone.Stop
        onCompass(heading.route, heading.alongHeadingDeg) -> GlanceTone.Along
        direction == Direction.Incoming -> GlanceTone.Incoming
        else -> GlanceTone.Outgoing
      },
    estimatedHeading = heading.bearingSource == "fallback",
  )
}

/** True when the route reads as a compass direction and has the heading to read it by. */
fun onCompass(route: ForecastRoute, alongHeadingDeg: Double?): Boolean =
  route != ForecastRoute.Channel && alongHeadingDeg != null

/**
 * A channel says "incoming" or "outgoing". Every other route says "running NE" from its heading; at a wall the
 * spoken form adds "along the reef", and a lagoon site's flow just runs that way.
 */
fun routeWay(route: ForecastRoute, direction: Direction, alongHeadingDeg: Double?): Pair<String, String> {
  if (alongHeadingDeg == null || !onCompass(route, alongHeadingDeg)) {
    val word = direction.name.lowercase()
    return word to word
  }
  val way = "running ${compassWord(passArrowBearing(alongHeadingDeg, direction))}"
  return way to if (route == ForecastRoute.Lagoon) way else "$way along the reef"
}

/** routeWay's spoken words, with the compass way a channel's water heads: "incoming, toward NE". */
fun routeWayToward(
  route: ForecastRoute,
  direction: Direction,
  inwardBearingDeg: Double?,
  alongHeadingDeg: Double?,
  outgoingBearingDeg: Double? = null,
): String {
  if (route != ForecastRoute.Channel) return routeWay(route, direction, alongHeadingDeg).second
  val word = direction.name.lowercase()
  if (inwardBearingDeg == null) return word
  return "$word, toward ${compassWord(passArrowBearing(inwardBearingDeg, direction, outgoingBearingDeg))}"
}

fun routeArrowBearing(
  route: ForecastRoute,
  direction: Direction,
  inwardBearingDeg: Double,
  alongHeadingDeg: Double?,
  outgoingBearingDeg: Double? = null,
): Double {
  if (alongHeadingDeg != null && onCompass(route, alongHeadingDeg)) return passArrowBearing(alongHeadingDeg, direction)
  return passArrowBearing(inwardBearingDeg, direction, outgoingBearingDeg)
}

/** Smaller is earlier. Very strong, strong, mild, slack, then no forecast. */
fun glanceRank(glance: Glance?): Int =
  when (glance?.strength) {
    Strength.TooStrong -> 0
    Strength.Strong -> 1
    Strength.Mild -> 2
    Strength.Slack -> 3
    null -> 4
  }

private val COMPASS_WORDS = listOf("N", "NE", "E", "SE", "S", "SW", "W", "NW")

/** The nearest of the eight compass points to a heading in degrees. */
fun compassWord(headingDeg: Double): String {
  val wrapped = wrap360(headingDeg)
  // Math.round like JavaScript's: halves go up, so 22.5 is NE on both.
  return COMPASS_WORDS[(Math.floor(wrapped / 45 + 0.5).toInt()) % 8]
}

/**
 * Incoming along the inward bearing, outgoing straight back, unless a curved channel gives its own outgoing
 * heading.
 */
fun passArrowBearing(inwardBearingDeg: Double, direction: Direction, outgoingBearingDeg: Double? = null): Double =
  when {
    direction == Direction.Incoming -> wrap360(inwardBearingDeg)
    outgoingBearingDeg != null -> wrap360(outgoingBearingDeg)
    else -> wrap360(inwardBearingDeg + 180)
  }

private fun wrap360(deg: Double): Double = ((deg % 360) + 360) % 360
