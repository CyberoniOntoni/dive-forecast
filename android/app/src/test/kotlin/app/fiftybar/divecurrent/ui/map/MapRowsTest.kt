package app.fiftybar.divecurrent.ui.map

import app.fiftybar.divecurrent.data.api.ApiGlance
import app.fiftybar.divecurrent.data.api.ApiHour
import app.fiftybar.divecurrent.data.api.ApiNowcast
import app.fiftybar.divecurrent.data.api.ApiSite
import app.fiftybar.divecurrent.data.api.ApiSiteNowcast
import app.fiftybar.divecurrent.data.api.ApiSites
import java.time.OffsetDateTime
import org.junit.Assert.assertEquals
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
    assertNotNull(MapViewModel.rows(sites, nowcast, now).single().glance)
  }

  @Test
  fun `draws nothing from a nowcast for an earlier hour`() {
    val now = maldivesMs("2026-11-15T10:05")
    assertEquals("2026-11-15T09:12", MapViewModel.outdated(nowcast, now))
    assertNull(MapViewModel.rows(sites, nowcast, now).single().glance)
  }
}
