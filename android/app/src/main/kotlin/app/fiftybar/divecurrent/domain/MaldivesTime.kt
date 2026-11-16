package app.fiftybar.divecurrent.domain

import java.time.Duration
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.Locale

/**
 * Forecast and report times are Maldives wall-clock strings "YYYY-MM-DDTHH:MM" (UTC+5, no zone suffix), as the
 * server's toMaldivesWall writes them. Never parse them as the phone's local time.
 */
object MaldivesTime {
  val OFFSET: ZoneOffset = ZoneOffset.ofHours(5)

  private val WALL = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm", Locale.ROOT)
  private val DAY = DateTimeFormatter.ofPattern("EEE d MMM", Locale.ENGLISH)
  private val CLOCK = DateTimeFormatter.ofPattern("HH:mm", Locale.ROOT)

  fun parse(wall: String): LocalDateTime? =
    try {
      LocalDateTime.parse(wall.take(16), WALL)
    } catch (_: DateTimeParseException) {
      null
    }

  fun nowWall(nowMs: Long = System.currentTimeMillis()): String =
    LocalDateTime.ofInstant(Instant.ofEpochMilli(nowMs), OFFSET).format(WALL)

  /** The current Maldives hour, "YYYY-MM-DDTHH:00". */
  fun nowHour(nowMs: Long = System.currentTimeMillis()): String = nowWall(nowMs).take(13) + ":00"

  /** "Sun 15 Nov, 09:00". */
  fun label(wall: String): String {
    val t = parse(wall) ?: return wall
    return "${t.format(DAY)}, ${t.format(CLOCK)}"
  }

  fun dayLabel(wall: String): String = parse(wall)?.format(DAY) ?: wall.take(10)

  fun clock(wall: String): String = parse(wall)?.format(CLOCK) ?: wall.takeLast(5)

  /** Index of the hour to open on: the current Maldives hour, else the first hour after it, else the last. */
  fun currentIndex(times: List<String>, nowMs: Long = System.currentTimeMillis()): Int {
    if (times.isEmpty()) return 0
    val now = nowHour(nowMs)
    val exact = times.indexOfFirst { it.take(16) == now }
    if (exact >= 0) return exact
    val after = times.indexOfFirst { it > now }
    return if (after >= 0) after else times.lastIndex
  }
}

/** "fetched 3 h ago" style age of a Unix-ms time. */
fun ageLabel(thenMs: Long, nowMs: Long = System.currentTimeMillis()): String {
  val minutes = Duration.ofMillis((nowMs - thenMs).coerceAtLeast(0)).toMinutes()
  return when {
    minutes < 1 -> "just now"
    minutes < 60 -> "$minutes min ago"
    minutes < 48 * 60 -> "${minutes / 60} h ago"
    else -> "${minutes / (24 * 60)} days ago"
  }
}
