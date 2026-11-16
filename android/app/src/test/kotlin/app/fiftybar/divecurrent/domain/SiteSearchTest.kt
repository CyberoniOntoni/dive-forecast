package app.fiftybar.divecurrent.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The web's lib/site-search.ts rules. */
class SiteSearchTest {
  @Test
  fun `every word starts a word of the name or atoll, accents and dashes ignored`() {
    assertTrue(SiteSearch.matches("Fesdu Wreck", "North Ari", "fesdu-wreck"))
    assertTrue(SiteSearch.matches("Kandooma Thila", "South Malé", "male kand"))
    assertTrue(SiteSearch.matches("Kandooma Thila", "South Malé", ""))
    assertFalse(SiteSearch.matches("Kandooma Thila", "South Malé", "ooma"))
  }

  @Test
  fun `atolls with sites, counted and sorted by name`() {
    val choices = SiteSearch.atollChoices(listOf("nm" to "North Malé", "ari" to "Ari", "nm" to "North Malé", "x" to null))
    assertEquals(listOf(SiteSearch.AtollChoice("ari", "Ari", 1), SiteSearch.AtollChoice("nm", "North Malé", 2)), choices)
  }
}
