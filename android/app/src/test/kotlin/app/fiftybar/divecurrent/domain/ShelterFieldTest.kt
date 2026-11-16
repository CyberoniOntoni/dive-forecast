package app.fiftybar.divecurrent.domain

import app.fiftybar.divecurrent.data.api.ApiScaleStop
import app.fiftybar.divecurrent.data.api.ApiShelterScale
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The web's lib/shelter-layer.test.ts cases, and pixels checked against the web's fieldPixels for the same bytes. */
class ShelterFieldTest {
  /** The scale the server sends (lib/shelter-layer.ts SCALE_STOPS). */
  private val scale =
    ApiShelterScale(
      maxM = 2.0,
      stops =
        listOf(
          ApiScaleStop(0.0, "#26a678"),
          ApiScaleStop(0.5, "#e2cd40"),
          ApiScaleStop(1.0, "#f08c34"),
          ApiScaleStop(1.5, "#dc383c"),
          ApiScaleStop(2.0, "#961432"),
        ),
    )
  private val color = ShelterField.palette(scale)
  private val o = ShelterField.OUTSIDE

  private fun channels(argb: Int) = intArrayOf((argb shr 16) and 0xff, (argb shr 8) and 0xff, argb and 0xff)

  @Test
  fun `colours run from green when calm to red when rough, blending between`() {
    val calm = channels(color(0.0))
    val rough = channels(color(1.5))
    assertTrue(calm[1] > calm[0])
    assertTrue(rough[0] > rough[1])
    val middle = channels(color(0.25))
    assertTrue(middle[0] > calm[0])
    assertTrue(middle[0] < channels(color(0.5))[0])
    assertEquals(color(2.0), color(9.0))
    assertArrayEquals(intArrayOf(38, 166, 120), calm)
  }

  @Test
  fun `puts the south row at the bottom, fills land from water next to it, and leaves unknown and missing cells clear`() {
    val values = intArrayOf(10, ShelterField.LAND, ShelterField.UNKNOWN, ShelterField.NONE, ShelterField.NONE, ShelterField.NONE)
    val pixels = ShelterField.pixels(2, 3, values, outside = false, fadeSteps = 0, color = color)
    fun alpha(row: Int, column: Int) = (pixels[row * 3 + column] ushr 24)
    assertEquals(255, alpha(1, 0))
    assertEquals(255, alpha(1, 1))
    assertEquals(0, alpha(1, 2))
    assertEquals(0, alpha(0, 0))
    assertEquals(color(0.2) and 0xffffff, pixels[1 * 3 + 1] and 0xffffff)
  }

  @Test
  fun `draws one side of the outline at a time, filling the other side's water from its own`() {
    val values = intArrayOf(10, 50 or o)
    val lagoon = ShelterField.pixels(1, 2, values, outside = false, fadeSteps = 0, color = color)
    val sea = ShelterField.pixels(1, 2, values, outside = true, fadeSteps = 0, color = color)
    assertEquals(color(0.2), lagoon[1])
    assertEquals(color(1.0), sea[0])
    assertEquals(color(1.0), sea[1])
  }

  @Test
  fun `fades the sea out toward the grid's edge, but not toward a neighbouring atoll's sea`() {
    val sea = 25 or o
    val values = intArrayOf(ShelterField.NONE, sea, sea, sea, sea, sea, ShelterField.OTHER)
    val pixels = ShelterField.pixels(1, 7, values, outside = true, fadeSteps = 4, color = color)
    fun alpha(column: Int) = pixels[column] ushr 24
    assertEquals(0, alpha(0))
    assertTrue(alpha(1) < alpha(2))
    assertEquals(255, alpha(5))
    assertEquals(0, alpha(6))
  }

  @Test
  fun `matches the web's pixels for the same field`() {
    val n = ShelterField.NONE
    val values =
      intArrayOf(
        n, n, n, n, n, n,
        n, 20 or o, 30 or o, 40 or o, ShelterField.OTHER, n,
        n, 10, ShelterField.LAND, ShelterField.UNKNOWN, 55 or o, n,
        n, 15 or o, 25, 60 or o, 90 or o, n,
      )
    // From lib/shelter-layer.ts fieldPixels(4, 6, values, outside, fade), as ARGB.
    val lagoon =
      intArrayOf(
        0, 0xffaac151.toInt(), 0xffe2cd40.toInt(), 0xffe2cd40.toInt(), 0xffe2cd40.toInt(), 0,
        0, 0xff71b662.toInt(), 0xffaac151.toInt(), 0, 0xffe2cd40.toInt(), 0,
        0, 0xff71b662.toInt(), 0xff71b662.toInt(), 0xff8dbb59.toInt(), 0, 0,
        0, 0, 0, 0, 0, 0,
      )
    val seaFade4 =
      intArrayOf(
        0, 0x4097bd56, 0x80e9ad3a.toInt(), 0x80e86a37.toInt(), 0x40b22236, 0,
        0, 0x40c9c847, 0x80e6b83c.toInt(), 0x80ec7b36.toInt(), 0x40ec7b36, 0,
        0, 0x40bcc54b, 0x40e5c03e, 0x40eaa639, 0, 0,
        0, 0, 0, 0, 0, 0,
      )
    val seaFade2 =
      intArrayOf(
        0, 0x8097bd56.toInt(), 0xffe9ad3a.toInt(), 0xffe86a37.toInt(), 0x80b22236.toInt(), 0,
        0, 0x80c9c847.toInt(), 0xffe6b83c.toInt(), 0xffec7b36.toInt(), 0x80ec7b36.toInt(), 0,
        0, 0x80bcc54b.toInt(), 0x80e5c03e.toInt(), 0x80eaa639.toInt(), 0, 0,
        0, 0, 0, 0, 0, 0,
      )
    assertArrayEquals(lagoon, ShelterField.pixels(4, 6, values, outside = false, fadeSteps = 0, color = color))
    assertArrayEquals(seaFade4, ShelterField.pixels(4, 6, values, outside = true, fadeSteps = 4, color = color))
    assertArrayEquals(seaFade2, ShelterField.pixels(4, 6, values, outside = true, fadeSteps = 2, color = color))
  }

  @Test
  fun `decodes the bytes and spots water with no data`() {
    // 10, 50|128, 125|128.
    val values = ShelterField.decode("CrL9")
    assertArrayEquals(intArrayOf(10, 178, 253), values)
    assertTrue(ShelterField.hasUnknown(values))
    assertFalse(ShelterField.hasUnknown(intArrayOf(10, ShelterField.LAND, ShelterField.NONE, ShelterField.OTHER)))
  }
}
