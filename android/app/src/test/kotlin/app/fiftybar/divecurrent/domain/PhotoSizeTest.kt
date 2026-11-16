package app.fiftybar.divecurrent.domain

import org.junit.Assert.assertEquals
import org.junit.Test

/** The sizes lib/photo-shrink.ts gives the same photos. */
class PhotoSizeTest {
  @Test
  fun `shrinks the long edge to 1600 and never enlarges`() {
    assertEquals(1600 to 1200, PhotoSize.target(4000, 3000))
    assertEquals(900 to 1600, PhotoSize.target(2700, 4800))
    assertEquals(800 to 600, PhotoSize.target(800, 600))
    assertEquals(1600 to 1, PhotoSize.target(16000, 3))
  }

  @Test
  fun `decodes at the biggest power of two that keeps 1600 px`() {
    assertEquals(2, PhotoSize.sampleSize(4000, 3000))
    assertEquals(4, PhotoSize.sampleSize(8000, 6000))
    assertEquals(1, PhotoSize.sampleSize(3000, 2000))
    assertEquals(1, PhotoSize.sampleSize(800, 600))
  }
}
