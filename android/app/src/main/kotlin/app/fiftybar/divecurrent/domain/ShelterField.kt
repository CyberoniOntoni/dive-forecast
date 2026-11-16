package app.fiftybar.divecurrent.domain

import app.fiftybar.divecurrent.data.api.ApiShelterScale
import java.util.Base64
import kotlin.math.max
import kotlin.math.min

/**
 * The "Sheltered water" layer's field, one byte per cell as the server sends it (lib/shelter-field.ts), and how one
 * side of an atoll's outline is turned into pixels: a port of fieldPixels in lib/shelter-layer.ts, so the app's
 * shading matches the web map's. Pure, so it is tested; the map scales the pixels up and cuts them to water.
 */
object ShelterField {
  /** Felt-height quantum, metres. */
  const val STEP_M = 0.02
  /** Another atoll's water, which that atoll's own field covers. */
  const val OTHER = 124
  /** Water with no wave or wind data this hour: left clear. */
  const val UNKNOWN = 125
  /** An island: filled from the water round it, then cut out along the coast. */
  const val LAND = 126
  /** Past the grid's edge: left clear, and the sea fades out toward it. */
  const val NONE = 127
  /** Set on water outside the atoll outline. */
  const val OUTSIDE = 128

  /** The sea outside the atolls fades out over this many 500 m cells toward the layer's edge. */
  const val SEA_FADE_STEPS = 4
  /** The 125 m cells fade out over their last cells, so the 500 m field beneath takes over smoothly. */
  const val FINE_FADE_STEPS = 2
  /** How many cells deep the field is extended past the water's edge, so the cut edge is full colour. */
  private const val EDGE_FILL_STEPS = 3

  private val SQRT2 = Math.sqrt(2.0)
  private val NEIGHBOURS = listOf(-1 to 0, 1 to 0, 0 to -1, 0 to 1, -1 to -1, -1 to 1, 1 to -1, 1 to 1)

  /** The cells' bytes, 0 to 255 each, or null when the text is not base64 (that atoll is skipped, not the app). */
  fun decode(base64: String): IntArray? =
    try {
      Base64.getDecoder().decode(base64).map { it.toInt() and 0xff }.toIntArray()
    } catch (_: IllegalArgumentException) {
      null
    }

  /** Some water in the field has no wave or wind data this hour. */
  fun hasUnknown(values: IntArray): Boolean = values.any { (it and 0x7f) == UNKNOWN }

  /** The server's scale as a colour per felt height: opaque ARGB, blended between its stops as the web does. */
  fun palette(scale: ApiShelterScale): (Double) -> Int {
    val stops = scale.stops.sortedBy { it.m }.map { it.m to rgb(it.color) }
    return { feltM -> color(stops, scale.maxM, feltM) }
  }

  private fun color(stops: List<Pair<Double, IntArray>>, maxM: Double, feltM: Double): Int {
    if (stops.isEmpty()) return 0xff808080.toInt()
    val m = max(0.0, min(maxM, feltM))
    for (index in 1 until stops.size) {
      val (lowM, low) = stops[index - 1]
      val (highM, high) = stops[index]
      if (m > highM) continue
      val share = if (highM == lowM) 0.0 else (m - lowM) / (highM - lowM)
      val channels = IntArray(3) { jsRound(low[it] + (high[it] - low[it]) * share) }
      return argb(255, channels[0], channels[1], channels[2])
    }
    val last = stops.last().second
    return argb(255, last[0], last[1], last[2])
  }

  /** "#26a678" as its three channels. */
  fun rgb(hex: String): IntArray {
    val value = hex.removePrefix("#").toIntOrNull(16) ?: 0x808080
    return intArrayOf((value shr 16) and 0xff, (value shr 8) and 0xff, value and 0xff)
  }

  private fun argb(alpha: Int, red: Int, green: Int, blue: Int): Int = (alpha shl 24) or (red shl 16) or (green shl 8) or blue

  /**
   * One side of the outline's field (the lagoon, or the sea outside when [outside]) as ARGB pixels, one per cell, row
   * 0 at the top (north). Islands and the other side's water take the mean of their neighbours on this side, a few
   * cells deep, so the shading runs right up to the coast and the reef before the map cuts it there. Unknown cells,
   * another atoll's water and cells past the grid stay clear. With [fadeSteps], the shading fades out over that many
   * cells toward the grid's outer edge.
   */
  fun pixels(rows: Int, columns: Int, values: IntArray, outside: Boolean, fadeSteps: Int, color: (Double) -> Int): IntArray {
    val size = rows * columns
    val felt = FloatArray(size) { Float.NaN }
    val fillable = BooleanArray(size)
    for (index in 0 until min(size, values.size)) {
      val value = values[index]
      if (value == NONE || value == OTHER) continue
      val mine = value != LAND && (value >= OUTSIDE) == outside
      val low = value and 0x7f
      if (!mine) fillable[index] = true else if (low != UNKNOWN) felt[index] = (low * STEP_M).toFloat()
    }
    repeat(EDGE_FILL_STEPS) {
      val next = felt.copyOf()
      for (row in 0 until rows) {
        for (column in 0 until columns) {
          val index = row * columns + column
          if (!fillable[index] || !felt[index].isNaN()) continue
          var sum = 0.0
          var count = 0
          for ((dr, dc) in NEIGHBOURS) {
            val r = row + dr
            val c = column + dc
            if (r < 0 || r >= rows || c < 0 || c >= columns) continue
            val value = felt[r * columns + c]
            if (value.isNaN()) continue
            sum += value
            count += 1
          }
          if (count > 0) next[index] = (sum / count).toFloat()
        }
      }
      next.copyInto(felt)
    }
    // Distance in cells from the grid's edge, so the fade follows the band's round edge, not the cells' staircase.
    val fromEdge = FloatArray(size) { fadeSteps.toFloat() }
    for (index in 0 until min(size, values.size)) if (values[index] == NONE) fromEdge[index] = 0f
    repeat(2 * fadeSteps) {
      for (row in 0 until rows) {
        for (column in 0 until columns) {
          // In doubles, stored as floats, as the web's Float32Array does, so the fades match to the pixel.
          var best = fromEdge[row * columns + column].toDouble()
          for (dr in -1..1) {
            for (dc in -1..1) {
              val r = row + dr
              val c = column + dc
              if (r < 0 || r >= rows || c < 0 || c >= columns || (dr == 0 && dc == 0)) continue
              best = min(best, fromEdge[r * columns + c] + if (dr != 0 && dc != 0) SQRT2 else 1.0)
            }
          }
          fromEdge[row * columns + column] = best.toFloat()
        }
      }
    }
    val pixels = IntArray(size)
    for (row in 0 until rows) {
      for (column in 0 until columns) {
        val value = felt[row * columns + column]
        if (value.isNaN()) continue
        val alpha = if (fadeSteps > 0) jsRound(255.0 * min(fadeSteps.toDouble(), fromEdge[row * columns + column].toDouble()) / fadeSteps) else 255
        if (alpha == 0) continue
        pixels[(rows - 1 - row) * columns + column] = (alpha shl 24) or (color(value.toDouble()) and 0xffffff)
      }
    }
    return pixels
  }
}
