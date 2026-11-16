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
  fun `opens on the current hour, else the next, else the last`() {
    val times = listOf("2026-11-15T08:00", "2026-11-15T09:00", "2026-11-15T10:00")
    assertEquals(1, MaldivesTime.currentIndex(times, now))
    assertEquals(0, MaldivesTime.currentIndex(listOf("2026-11-15T11:00", "2026-11-15T12:00"), now))
    assertEquals(1, MaldivesTime.currentIndex(listOf("2026-11-14T07:00", "2026-11-14T08:00"), now))
  }

  @Test
  fun `labels an hour`() {
    assertEquals("Sun 15 Nov, 09:00", MaldivesTime.label("2026-11-15T09:00"))
  }
}
