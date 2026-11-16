package app.fiftybar.divecurrent.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NewSiteTest {
  private fun body(
    name: String = "Test Thila",
    top: String = "",
    max: String = "",
    how: String = "",
    kind: String? = null,
    rating: Int? = null,
    lat: Double = 4.25,
    lon: Double = 73.45,
  ) = NewSite.body(name, lat, lon, kind, top, max, how, rating)

  @Test
  fun `leaves blank fields out and trims the rest`() {
    val sent = body(name = "  Test Thila ", how = "  Drop east. ").getOrThrow()
    assertEquals("Test Thila", sent.name)
    assertEquals("Drop east.", sent.howToDive)
    assertNull(sent.diveTopM)
    assertNull(sent.diverSiteType)
    assertNull(sent.rating)
  }

  @Test
  fun `reads depths with a comma or a point`() {
    val sent = body(top = "8,5", max = "25", kind = "lagoon", rating = 4).getOrThrow()
    assertEquals(8.5, sent.diveTopM!!, 0.0)
    assertEquals(25.0, sent.diveMaxM!!, 0.0)
    assertEquals("lagoon", sent.diverSiteType)
    assertEquals(4, sent.rating)
  }

  @Test
  fun `says what is wrong in the web form's words`() {
    assertEquals("Site name is required", body(name = " ").exceptionOrNull()?.message)
    assertEquals("Shallowest depth must be 0 to 100 m.", body(top = "deep").exceptionOrNull()?.message)
    assertEquals("Deepest depth must be 0 to 100 m.", body(max = "130").exceptionOrNull()?.message)
    assertEquals("The shallowest depth is deeper than the deepest.", body(top = "30", max = "10").exceptionOrNull()?.message)
    assertEquals("Site name must be 1 to 80 characters", body(name = "x".repeat(81)).exceptionOrNull()?.message)
    assertEquals("Pick a site type from the list.", body(kind = "strait-wall").exceptionOrNull()?.message)
    assertEquals("Rating must be an integer from 1 to 5", body(rating = 9).exceptionOrNull()?.message)
  }

  @Test
  fun `takes only pins inside the server's Maldives box`() {
    assertEquals("Latitude is outside Maldives bounds [-2, 9]", body(lat = 9.5).exceptionOrNull()?.message)
    assertEquals("Longitude is outside Maldives bounds [71, 76]", body(lon = 70.5).exceptionOrNull()?.message)
    assertEquals(true, NewSite.inBounds(-2.0, 76.0))
    assertEquals(false, NewSite.inBounds(-2.5, 73.0))
  }

  @Test
  fun `words the pin as the web does`() {
    assertEquals("Pin 4.25000, 73.45000.", NewSite.pinLine(4.25, 73.45))
  }
}
