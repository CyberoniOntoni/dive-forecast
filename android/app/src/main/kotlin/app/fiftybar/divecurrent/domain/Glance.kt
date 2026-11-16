package app.fiftybar.divecurrent.domain

import app.fiftybar.divecurrent.data.api.ApiHour
import app.fiftybar.divecurrent.data.api.Confidence
import app.fiftybar.divecurrent.data.api.GlanceTone
import app.fiftybar.divecurrent.data.api.Strength

/*
 * How one forecast hour reads on screen. The server makes it (lib/nowcast-glance.ts through lib/api-v1.ts, the same
 * code the web map and site page use), so the app only checks it can read every value and draws what it is given.
 */

data class Glance(
  /** Degrees clockwise from north. */
  val arrowBearing: Double,
  /** "incoming", "outgoing", or "running NE" on a compass route. */
  val way: String,
  /** The way in a sentence: adds "along the reef" at a wall. */
  val spokenWay: String,
  /** At a channel also where the water heads: "incoming, toward NE". */
  val wayToward: String,
  /** "slack", "mild", "strong", "very strong". */
  val label: String,
  val strength: Strength,
  val confidence: Confidence,
  val opacity: Float,
  val tone: GlanceTone,
  /** Strongest first. */
  val rank: Int,
  /** True when the heading comes from the fallback heuristic, not a measurement or the atoll rim. */
  val estimatedHeading: Boolean,
)

/**
 * Null when there is no hour, the server sent no glance, or any value is one this app does not know: then it draws
 * no arrow rather than a wrong one.
 */
fun glance(hour: ApiHour?): Glance? {
  val g = hour?.glance ?: return null
  val strength = Strength.of(hour.strength) ?: return null
  val confidence = Confidence.of(hour.confidence) ?: return null
  val tone = GlanceTone.of(g.tone) ?: return null
  return Glance(
    arrowBearing = g.arrowBearing,
    way = g.way,
    spokenWay = g.spokenWay,
    wayToward = g.wayToward,
    label = g.label,
    strength = strength,
    confidence = confidence,
    opacity = g.opacity.toFloat().coerceIn(0f, 1f),
    tone = tone,
    rank = g.rank,
    estimatedHeading = g.estimatedHeading,
  )
}

fun confidenceLabel(confidence: Confidence): String = confidence.name.lowercase()

/** Rows with no glance sort after every reading. */
fun glanceRank(glance: Glance?): Int = glance?.rank ?: Int.MAX_VALUE

private val COMPASS_WORDS = listOf("N", "NE", "E", "SE", "S", "SW", "W", "NW")

/** The nearest of the eight compass points to a heading in degrees, for swell and wind. */
fun compassWord(headingDeg: Double): String {
  val wrapped = ((headingDeg % 360) + 360) % 360
  // Math.round like JavaScript's: halves go up, so 22.5 is NE on both.
  return COMPASS_WORDS[(Math.floor(wrapped / 45 + 0.5).toInt()) % 8]
}
