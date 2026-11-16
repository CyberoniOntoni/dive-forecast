package app.fiftybar.divecurrent.domain

import app.fiftybar.divecurrent.data.api.ApiHour
import app.fiftybar.divecurrent.data.api.Strength
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * The report form's dive time, always in Maldives wall clock, as on the web form: "This hour" and up to 3 h ago in one
 * tap, or another date and time. The server refuses times ahead of now or more than 14 days back.
 */
object ReportTime {
  /** Hours back offered as one-tap choices. */
  val QUICK_HOURS = listOf(0, 1, 2, 3)

  /** How far back a report may go (lib/actions.ts REPORT_MAX_AGE_DAYS). */
  const val MAX_AGE_DAYS = 14L

  private val WALL = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm", Locale.ROOT)

  fun quickLabel(hours: Int): String = if (hours == 0) "This hour" else "$hours h ago"

  /** The Maldives hour `hours` before the current one, "YYYY-MM-DDTHH:00". */
  fun hoursAgo(hours: Int, nowMs: Long = System.currentTimeMillis()): String {
    val now = MaldivesTime.parse(MaldivesTime.nowHour(nowMs))!!
    return now.minusHours(hours.toLong()).format(WALL)
  }

  /** A picked date and time as a wall time. */
  fun wall(date: LocalDate, time: LocalTime): String = date.atTime(time.withSecond(0).withNano(0)).format(WALL)

  /** Today in the Maldives. */
  fun today(nowMs: Long = System.currentTimeMillis()): LocalDate = MaldivesTime.parse(MaldivesTime.nowWall(nowMs))!!.toLocalDate()

  /** The forecast hour a dive time falls on exactly, for the one-tap "As forecast". Only whole hours match, as on the web. */
  fun forecastAt(hours: List<ApiHour>, wall: String): ApiHour? = hours.firstOrNull { it.time.take(16) == wall.take(16) }
}

/** A strength in the site page's words: `too_strong` is "very strong". */
fun strengthWord(strength: Strength): String =
  when (strength) {
    Strength.Slack -> "slack"
    Strength.Mild -> "mild"
    Strength.Strong -> "strong"
    Strength.TooStrong -> "very strong"
  }

/**
 * "As forecast: incoming, mild" or "As forecast: running NE, mild" for the one-tap report, in the form's own words
 * for this site. Null when the hour has a value this app does not know.
 */
fun asForecastLabel(hour: ApiHour, incoming: String, outgoing: String): String? {
  val strength = Strength.of(hour.strength) ?: return null
  val way =
    when (hour.direction) {
      "incoming" -> incoming
      "outgoing" -> outgoing
      else -> return null
    }
  return "As forecast: ${way.replaceFirstChar { it.lowercase() }}, ${strengthWord(strength)}"
}
