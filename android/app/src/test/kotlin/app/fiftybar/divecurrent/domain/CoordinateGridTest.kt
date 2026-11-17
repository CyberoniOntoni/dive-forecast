package app.fiftybar.divecurrent.domain

import kotlin.math.roundToLong
import org.junit.Assert.assertEquals
import org.junit.Test

/** The web's lib/map-layers.test.ts "coordinate grid" cases. */
class CoordinateGridTest {
  @Test
  fun `picks the finest spacing with at most eight lines across the view`() {
    assertEquals(1.0, CoordinateGrid.step(8.0), 0.0)
    assertEquals(1.0 / 6, CoordinateGrid.step(1.2), 1e-12)
    assertEquals(1.0 / 60, CoordinateGrid.step(0.1), 1e-12)
    assertEquals(10.0, CoordinateGrid.step(80.0), 0.0)
    assertEquals(10.0, CoordinateGrid.step(0.0), 0.0)
  }

  @Test
  fun `lists the multiples inside the view without float drift`() {
    val sixths = listOf(4 + 1.0 / 6, 4 + 2.0 / 6).map { (it * 3600).roundToLong() / 3600.0 }
    assertEquals(sixths, CoordinateGrid.values(4.05, 4.4, 1.0 / 6))
    assertEquals(listOf(-0.5, 0.0), CoordinateGrid.values(-0.7, 0.2, 0.5).map { it + 0.0 })
  }

  @Test
  fun `labels in degrees and minutes with the hemisphere`() {
    assertEquals("4°10′N", CoordinateGrid.label(4 + 10.0 / 60, CoordinateGrid.Axis.Lat))
    assertEquals("0°36′S", CoordinateGrid.label(-0.6, CoordinateGrid.Axis.Lat))
    assertEquals("73°30′E", CoordinateGrid.label(73.5, CoordinateGrid.Axis.Lon))
    assertEquals("0°00′", CoordinateGrid.label(0.0, CoordinateGrid.Axis.Lat))
  }

  @Test
  fun `a view gets its latitude and longitude lines`() {
    // An atoll's width (1.2°): 10′ lines.
    val lines = CoordinateGrid.lines(3.9, 73.0, 4.9, 74.2)
    assertEquals(listOf("4°00′N", "4°10′N", "4°20′N", "4°30′N", "4°40′N", "4°50′N"), lines.filter { it.axis == CoordinateGrid.Axis.Lat }.map { it.label })
    val lon = lines.filter { it.axis == CoordinateGrid.Axis.Lon }.map { it.label }
    assertEquals(listOf("73°00′E", "74°10′E"), listOf(lon.first(), lon.last()))
    assertEquals(8, lon.size)
  }
}
