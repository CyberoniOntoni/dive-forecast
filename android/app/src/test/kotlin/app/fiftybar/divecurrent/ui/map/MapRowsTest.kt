package app.fiftybar.divecurrent.ui.map

import app.fiftybar.divecurrent.data.api.ApiForecast
import app.fiftybar.divecurrent.data.api.ApiGlance
import app.fiftybar.divecurrent.data.api.ApiHour
import app.fiftybar.divecurrent.data.api.ApiNowcast
import app.fiftybar.divecurrent.data.api.ApiSite
import app.fiftybar.divecurrent.data.api.ApiSiteNowcast
import app.fiftybar.divecurrent.data.api.ApiSites
import java.time.OffsetDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/** A saved nowcast is for its own hour: once the Maldives hour moves on, the map draws no arrows from it. */
class MapRowsTest {
  private fun maldivesMs(wall: String) = OffsetDateTime.parse("$wall:00+05:00").toInstant().toEpochMilli()

  private val sites =
    ApiSites(apiVersion = 1, sites = listOf(ApiSite(id = "a", name = "A", atollId = "x", lat = 4.0, lon = 73.0)))

  private val nowcast =
    ApiNowcast(
      apiVersion = 1,
      modelVersion = "m",
      maldivesWall = "2026-11-15T09:12",
      nowcasts =
        listOf(
          ApiSiteNowcast(
            siteId = "a",
            atollId = "x",
            hour =
              ApiHour(
                time = "2026-11-15T09:00",
                direction = "incoming",
                strength = "mild",
                confidence = "medium",
                glance =
                  ApiGlance(
                    arrowBearing = 40.0,
                    way = "incoming",
                    spokenWay = "incoming",
                    wayToward = "incoming, toward NE",
                    label = "mild",
                    tone = "incoming",
                    rank = 2,
                  ),
              ),
          )
        ),
    )

  @Test
  fun `draws the nowcast within its hour`() {
    val now = maldivesMs("2026-11-15T09:55")
    assertNull(MapViewModel.outdated(nowcast, now))
    assertNotNull(MapViewModel.rows(sites, nowcast, nowMs = now).single().glance)
  }

  @Test
  fun `draws nothing from a nowcast for an earlier hour`() {
    val now = maldivesMs("2026-11-15T10:05")
    assertEquals("2026-11-15T09:12", MapViewModel.outdated(nowcast, now))
    assertNull(MapViewModel.rows(sites, nowcast, nowMs = now).single().glance)
  }

  @Test
  fun `a map fetched just before the hour is for that hour and still current in it`() {
    // Fetched at 09:59, the server's map is the 10:00 one: at 10:00 it is not an earlier hour.
    val late = nowcast.copy(maldivesWall = "2026-11-15T09:59")
    assertNull(MapViewModel.outdated(late, maldivesMs("2026-11-15T10:00")))
    assertNull(MapViewModel.outdated(late, maldivesMs("2026-11-15T10:59")))
    assertEquals("2026-11-15T09:59", MapViewModel.outdated(late, maldivesMs("2026-11-15T11:00")))
  }

  @Test
  fun `a map fetched at exactly half past is for the earlier hour`() {
    // As the server picks: 09:30 keeps 09:00, so at 10:00 the map is for an earlier hour.
    val half = nowcast.copy(maldivesWall = "2026-11-15T09:30")
    assertNull(MapViewModel.outdated(half, maldivesMs("2026-11-15T09:59")))
    assertEquals("2026-11-15T09:30", MapViewModel.outdated(half, maldivesMs("2026-11-15T10:00")))
  }

  /** A saved atoll's week: the 09:00 hour of the nowcast above, then 10:00 running outgoing. */
  private val week =
    ApiForecast(
      apiVersion = 1,
      modelVersion = "m",
      siteId = "a",
      hours =
        listOf(
          nowcast.nowcasts.single().hour!!,
          nowcast.nowcasts.single().hour!!.let { h ->
            h.copy(time = "2026-11-15T10:00", direction = "outgoing", glance = h.glance!!.copy(arrowBearing = 220.0, way = "outgoing", tone = "outgoing"))
          },
        ),
    )

  @Test
  fun `takes this hour from a saved week when the nowcast is for an earlier hour`() {
    val now = maldivesMs("2026-11-15T10:05")
    val row = MapViewModel.rows(sites, nowcast, mapOf("a" to week), now).single()
    assertTrue(row.fromSaved)
    assertEquals(220.0, row.glance!!.arrowBearing, 0.0)
  }

  @Test
  fun `takes a saved week with no nowcast at all, at the hour nearest the clock`() {
    // 09:40 reads as 10:00, as the server's map picks its hour.
    val row = MapViewModel.rows(sites, null, mapOf("a" to week), maldivesMs("2026-11-15T09:40")).single()
    assertEquals("2026-11-15T10:00", week.hours[1].time)
    assertEquals(220.0, row.glance!!.arrowBearing, 0.0)
  }

  @Test
  fun `prefers the current nowcast to a saved week`() {
    val row = MapViewModel.rows(sites, nowcast, mapOf("a" to week), maldivesMs("2026-11-15T09:20")).single()
    assertFalse(row.fromSaved)
    assertEquals(40.0, row.glance!!.arrowBearing, 0.0)
  }

  @Test
  fun `keeps to a current nowcast that leaves a site out`() {
    val empty = nowcast.copy(nowcasts = emptyList())
    val row = MapViewModel.rows(sites, empty, mapOf("a" to week), maldivesMs("2026-11-15T09:20")).single()
    assertNull(row.glance)
    assertFalse(row.fromSaved)
  }

  @Test
  fun `draws nothing once the saved week has run out`() {
    val row = MapViewModel.rows(sites, null, mapOf("a" to week), maldivesMs("2026-11-15T13:00")).single()
    assertNull(row.glance)
    assertFalse(row.fromSaved)
  }
}
