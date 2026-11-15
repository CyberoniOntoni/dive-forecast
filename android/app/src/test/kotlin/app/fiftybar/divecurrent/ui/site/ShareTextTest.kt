package app.fiftybar.divecurrent.ui.site

import app.fiftybar.divecurrent.BuildConfig
import app.fiftybar.divecurrent.data.api.ApiGlance
import app.fiftybar.divecurrent.data.api.ApiHour
import org.junit.Assert.assertEquals
import org.junit.Test

/** The web page opens on the current hour (?at= only fills the report form), so the shared hour goes in the text. */
class ShareTextTest {
  private val hour =
    ApiHour(
      time = "2026-11-15T14:00",
      direction = "outgoing",
      strength = "strong",
      confidence = "medium",
      glance =
        ApiGlance(
          arrowBearing = 150.0,
          way = "outgoing",
          spokenWay = "outgoing",
          wayToward = "outgoing, toward SE",
          label = "strong",
          tone = "outgoing",
          rank = 1,
        ),
    )

  @Test
  fun `names the hour and its reading, and links the page without at`() {
    assertEquals(
      "HP Reef, Sun 15 Nov, 14:00 Maldives: outgoing, toward SE, strong\n${BuildConfig.WEB_URL}/sites/hp-reef",
      shareText("hp-reef", "HP Reef", hour),
    )
  }

  @Test
  fun `no hour shares the link alone`() {
    assertEquals("${BuildConfig.WEB_URL}/sites/hp-reef", shareText("hp-reef", "HP Reef", null))
  }
}
