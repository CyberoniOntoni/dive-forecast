package app.fiftybar.divecurrent.domain

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

/** Reading the web's Atlas tiles (lib/atlas-overlays.ts encodeRing / decodeRing). */
class AtlasTilesTest {
  @Test
  fun `decodes delta steps into a closed lon-lat ring`() {
    // 73.0,4.0 → 73.001,4.0 → 73.001,4.001, as encodeRing writes it.
    val ring = AtlasTiles.decodeRing(longArrayOf(7300000, 400000, 100, 0, 0, 100))
    assertArrayEquals(doubleArrayOf(73.0, 4.0, 73.001, 4.0, 73.001, 4.001, 73.0, 4.0), ring, 1e-9)
  }

  @Test
  fun `keeps a ring already closed as it is`() {
    val ring = AtlasTiles.decodeRing(longArrayOf(7300000, 400000, 100, 0, 0, 100, -100, -100))
    assertEquals(8, ring.size)
  }

  @Test
  fun `parses shapes with holes and drops specks`() {
    val text = "[[3,[7300000,400000,100,0,0,100],[7300020,400020,10,0,0,10]],[1,[7300000,400000,5,0]]]"
    val shapes = AtlasTiles.parse(text)
    assertEquals(1, shapes.size)
    assertEquals(3, shapes[0].classIndex)
    assertEquals(2, shapes[0].rings.size)
  }

  @Test
  fun `picks the tiles whose shapes reach into the view`() {
    val index =
      listOf(
        AtlasTileEntry("a.json", 4.0, 73.0, 4.2, 73.2),
        AtlasTileEntry("b.json", 5.0, 73.0, 5.2, 73.2),
        AtlasTileEntry("c.json", 4.1, 73.15, 4.3, 73.5),
      )
    assertEquals(listOf("a.json", "c.json"), AtlasTiles.inView(index, 4.1, 73.1, 4.15, 73.18))
  }
}
