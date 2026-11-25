package app.fiftybar.divecurrent.ui.site

import org.junit.Assert.assertEquals
import org.junit.Test

/** The credit under a site's texts reads like the web's "Written by Ann, Bob and Cy". */
class WrittenByLineTest {
  @Test
  fun joinsNamesTheWayTheWebDoes() {
    assertEquals("Ann", writtenByLine(listOf("Ann")))
    assertEquals("Ann and Bob", writtenByLine(listOf("Ann", "Bob")))
    assertEquals("Ann, Bob and Cy", writtenByLine(listOf("Ann", "Bob", "Cy")))
  }
}
