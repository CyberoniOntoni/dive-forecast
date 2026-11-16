package app.fiftybar.divecurrent.domain

import app.fiftybar.divecurrent.data.api.ApiHour
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ReportTimeTest {
  // 04:30 UTC is 09:30 in the Maldives.
  private val now = Instant.parse("2026-11-16T04:30:00Z").toEpochMilli()

  @Test
  fun `quick choices are whole Maldives hours back from now`() {
    assertEquals("2026-11-16T09:00", ReportTime.hoursAgo(0, now))
    assertEquals("2026-11-16T06:00", ReportTime.hoursAgo(3, now))
    assertEquals("This hour", ReportTime.quickLabel(0))
    assertEquals("2 h ago", ReportTime.quickLabel(2))
  }

  @Test
  fun `crosses midnight in Maldives time, not the phone's`() {
    val early = Instant.parse("2026-11-15T19:10:00Z").toEpochMilli() // 00:10 on the 16th in the Maldives
    assertEquals("2026-11-15T22:00", ReportTime.hoursAgo(2, early))
    assertEquals(LocalDate.of(2026, 11, 16), ReportTime.today(early))
  }

  @Test
  fun `a picked date and time is a wall time`() {
    assertEquals("2026-11-14T07:05", ReportTime.wall(LocalDate.of(2026, 11, 14), LocalTime.of(7, 5, 30)))
  }

  @Test
  fun `as forecast only for a whole forecast hour, in the site's words`() {
    val hours = listOf(ApiHour("2026-11-16T09:00", "incoming", "too_strong", "medium"))
    val hour = ReportTime.forecastAt(hours, "2026-11-16T09:00")!!
    assertNull(ReportTime.forecastAt(hours, "2026-11-16T09:30"))
    assertEquals("As forecast: incoming, very strong", asForecastLabel(hour, "Incoming", "Outgoing"))
    assertEquals("As forecast: running NE, very strong", asForecastLabel(hour, "Running NE", "Running SW"))
    assertNull(asForecastLabel(hour.copy(strength = "whirlpool"), "Incoming", "Outgoing"))
  }
}
