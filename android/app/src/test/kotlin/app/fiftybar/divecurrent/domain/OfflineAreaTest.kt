package app.fiftybar.divecurrent.domain

import app.fiftybar.divecurrent.data.api.ApiBounds
import app.fiftybar.divecurrent.data.api.ApiForecast
import app.fiftybar.divecurrent.data.api.ApiHour
import app.fiftybar.divecurrent.data.api.ApiSite
import java.time.OffsetDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OfflineAreaTest {
  private fun site(id: String, lat: Double, lon: Double) = ApiSite(id = id, name = id, atollId = "x", lat = lat, lon = lon)

  private fun ms(wall: String) = OffsetDateTime.parse("$wall:00+05:00").toInstant().toEpochMilli()

  @Test
  fun `saves the outline's box, a little wider`() {
    val box = OfflineArea.box(ApiBounds(4.1, 73.3, 4.7, 73.7), listOf(site("a", 4.2, 73.4)))!!
    assertEquals(4.08, box.south, 1e-9)
    assertEquals(73.72, box.east, 1e-9)
  }

  @Test
  fun `pads the sites when the server has no outline, and gives up with neither`() {
    val box = OfflineArea.box(null, listOf(site("a", 4.2, 73.4), site("b", 4.3, 73.5)))!!
    assertEquals(4.1, box.south, 1e-9)
    assertEquals(73.3, box.west, 1e-9)
    assertEquals(4.4, box.north, 1e-9)
    assertEquals(73.6, box.east, 1e-9)
    assertNull(OfflineArea.box(null, emptyList()))
  }

  @Test
  fun `picks the saved hour nearest the clock, none from an unavailable week`() {
    val hours = listOf("2026-11-17T09:00", "2026-11-17T10:00").map { ApiHour(time = it, direction = "incoming", strength = "mild", confidence = "low") }
    val week = ApiForecast(apiVersion = 1, modelVersion = "m", siteId = "a", hours = hours)
    assertEquals("2026-11-17T09:00", OfflineArea.hourNow(week, ms("2026-11-17T09:29"))!!.time)
    assertEquals("2026-11-17T10:00", OfflineArea.hourNow(week, ms("2026-11-17T09:31"))!!.time)
    assertNull(OfflineArea.hourNow(week, ms("2026-11-17T11:00")))
    assertNull(OfflineArea.hourNow(week.copy(unavailable = true), ms("2026-11-17T09:00")))
  }

  @Test
  fun `keeps the copies another saved atoll also holds`() {
    val a = SavedArea("a", "A", 0, listOf("s1"), listOf("forecast/s1", "atlas/reef-outline/4.00_73.25.json"))
    val b = SavedArea("b", "B", 0, listOf("s2"), listOf("forecast/s2", "atlas/reef-outline/4.00_73.25.json"))
    assertEquals(listOf("forecast/s1"), OfflineArea.keysToDrop(a, listOf(a, b)))
    assertEquals(a.keys, OfflineArea.keysToDrop(a, listOf(a)))
  }

  @Test
  fun `says the size in KB or MB`() {
    assertEquals("1 KB", OfflineArea.sizeLabel(20))
    assertEquals("640 KB", OfflineArea.sizeLabel(640_000))
    assertEquals("4 MB", OfflineArea.sizeLabel(4_200_000))
  }
}
