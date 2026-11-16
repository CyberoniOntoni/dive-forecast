package app.fiftybar.divecurrent.ui.map

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import app.fiftybar.divecurrent.data.api.ApiShelterAtoll
import app.fiftybar.divecurrent.data.api.ApiShelterShapes
import app.fiftybar.divecurrent.domain.ShelterField
import kotlin.math.max

/** One atoll's shading as an image over its grid's box, for a MapLibre image source. */
class ShelterImage(
  val id: String,
  val bitmap: Bitmap,
  val south: Double,
  val west: Double,
  val north: Double,
  val east: Double,
  /** The 125 m cells near islands, drawn over the 500 m ones. */
  val fine: Boolean,
)

/**
 * Draws one atoll's field the way the web map does (lib/shelter-layer.ts draw): the lagoon and the sea outside as two
 * images, each scaled up smoothly between cells and cut to its side of the outline, islands cut out, so the reef is a
 * sharp line and the shading meets the coast. The web cuts on screen at every frame; here it is cut once into an image
 * a few pixels per cell, which MapLibre then stretches over the grid's box.
 */
object ShelterRaster {
  /** The image's longer side at most, pixels: a few MB per atoll. */
  private const val MAX_SIDE_PX = 1536
  /** Pixels per cell at most: past this the cut along the coast is finer than the satellite outline anyway. */
  private const val MAX_PX_PER_CELL = 8

  /** [values] are the field's decoded bytes; null when they do not fit its grid or the outline is too short to cut. */
  fun render(field: ApiShelterAtoll, values: IntArray, shapes: ApiShelterShapes, color: (Double) -> Int): ShelterImage? {
    val rows = field.rows
    val columns = field.columns
    if (rows <= 0 || columns <= 0 || values.size != rows * columns || shapes.outline.size < 3) return null
    val fine = field.layer == "fine"
    val sea = cells(rows, columns, values, outside = true, fadeSteps = if (fine) ShelterField.FINE_FADE_STEPS else ShelterField.SEA_FADE_STEPS, color)
    val lagoon = cells(rows, columns, values, outside = false, fadeSteps = if (fine) ShelterField.FINE_FADE_STEPS else 0, color)

    val scale = (MAX_SIDE_PX / max(rows, columns)).coerceIn(1, MAX_PX_PER_CELL)
    val width = columns * scale
    val height = rows * scale
    val north = field.south + rows * field.stepDeg
    val image = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(image)
    fun Path.ring(points: List<List<Double>>) {
      points.filter { it.size >= 2 }.forEachIndexed { index, (lat, lon) ->
        val x = ((lon - field.west) / field.stepDeg * scale).toFloat()
        val y = ((north - lat) / field.stepDeg * scale).toFloat()
        if (index == 0) moveTo(x, y) else lineTo(x, y)
      }
      close()
    }
    fun Path.screen() = addRect(-width.toFloat(), -height.toFloat(), 2f * width, 2f * height, Path.Direction.CW)
    // Islands are holes in the image; the lagoon is inside the outline, the sea is the image less the outline.
    val water = Path().apply {
      fillType = Path.FillType.EVEN_ODD
      screen()
      shapes.islands.forEach { ring(it) }
    }
    val outline = Path().apply { ring(shapes.outline) }
    val outside = Path().apply {
      fillType = Path.FillType.EVEN_ODD
      screen()
      ring(shapes.outline)
    }
    val smooth = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
    val whole = Rect(0, 0, width, height)
    for ((cells, cut) in listOf(sea to outside, lagoon to outline)) {
      canvas.save()
      canvas.clipPath(water)
      canvas.clipPath(cut)
      canvas.drawBitmap(cells, null, whole, smooth)
      canvas.restore()
      cells.recycle()
    }
    return ShelterImage(
      id = "${field.wayId}-${field.layer}",
      bitmap = image,
      south = field.south,
      west = field.west,
      north = north,
      east = field.west + columns * field.stepDeg,
      fine = fine,
    )
  }

  /** One side's cells as a bitmap, one pixel per cell, north at the top. */
  private fun cells(rows: Int, columns: Int, values: IntArray, outside: Boolean, fadeSteps: Int, color: (Double) -> Int): Bitmap =
    Bitmap.createBitmap(ShelterField.pixels(rows, columns, values, outside, fadeSteps, color), columns, rows, Bitmap.Config.ARGB_8888)
}
