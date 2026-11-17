package app.fiftybar.divecurrent.domain

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Test

class MaldivesTimeTest {
  // 2026-11-15T04:12Z is 09:12 in the Maldives.
  private val now = Instant.parse("2026-11-15T04:12:00Z").toEpochMilli()

  @Test
  fun `reads the wall clock as UTC+5, whatever the phone's zone`() {
    assertEquals("2026-11-15T09:12", MaldivesTime.nowWall(now))
    assertEquals("2026-11-15T09:00", MaldivesTime.nowHour(now))
  }

  @Test
  fun `opens on the nearest hour, else the next, else the last`() {
    val times = listOf("2026-11-15T08:00", "2026-11-15T09:00", "2026-11-15T10:00")
    assertEquals(1, MaldivesTime.currentIndex(times, now))
    assertEquals(0, MaldivesTime.currentIndex(listOf("2026-11-15T11:00", "2026-11-15T12:00"), now))
    assertEquals(1, MaldivesTime.currentIndex(listOf("2026-11-14T07:00", "2026-11-14T08:00"), now))
  }

  @Test
  fun `the nearest hour is the map's hour, half past keeping the earlier one`() {
    fun at(utc: String) = Instant.parse(utc).toEpochMilli()
    // 09:48 in the Maldives opens on 10:00, as the map's nowcast does; the report form's "this hour" stays 09:00.
    assertEquals("2026-11-15T10:00", MaldivesTime.nearestHour(at("2026-11-15T04:48:00Z")))
    assertEquals("2026-11-15T09:00", MaldivesTime.nowHour(at("2026-11-15T04:48:00Z")))
    assertEquals("2026-11-15T09:00", MaldivesTime.nearestHour(at("2026-11-15T04:30:00Z")))
    assertEquals("2026-11-15T10:00", MaldivesTime.nearestHour(at("2026-11-15T04:30:00.001Z")))
    assertEquals("2026-11-15T09:00", MaldivesTime.nearestHour(now))
    // Across midnight.
    assertEquals("2026-11-16T00:00", MaldivesTime.nearestHour(at("2026-11-15T18:45:00Z")))
    val times = listOf("2026-11-15T09:00", "2026-11-15T10:00")
    assertEquals(1, MaldivesTime.currentIndex(times, at("2026-11-15T04:48:00Z")))
  }

  @Test
  fun `labels an hour`() {
    assertEquals("Sun 15 Nov, 09:00", MaldivesTime.label("2026-11-15T09:00"))
  }
}
