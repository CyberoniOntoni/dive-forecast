package app.fiftybar.divecurrent.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NewSiteTest {
  private fun body(name: String = "Test Thila", top: String = "", max: String = "", how: String = "", kind: String? = null, rating: Int? = null) =
    NewSite.body(name, 4.25, 73.45, kind, top, max, how, rating)

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
    assertEquals("Site name is required.", body(name = " ").exceptionOrNull()?.message)
    assertEquals("Shallowest depth must be 0 to 100 m.", body(top = "deep").exceptionOrNull()?.message)
    assertEquals("Deepest depth must be 0 to 100 m.", body(max = "130").exceptionOrNull()?.message)
    assertEquals("The shallowest depth is deeper than the deepest.", body(top = "30", max = "10").exceptionOrNull()?.message)
    assertEquals("Site name must be 1 to 80 characters.", body(name = "x".repeat(81)).exceptionOrNull()?.message)
  }

  @Test
  fun `drops a kind or rating the server would refuse`() {
    val sent = body(kind = "strait-wall", rating = 9).getOrThrow()
    assertNull(sent.diverSiteType)
    assertNull(sent.rating)
  }

  @Test
  fun `words the pin as the web does`() {
    assertEquals("Pin 4.25000, 73.45000.", NewSite.pinLine(4.25, 73.45))
  }
}
