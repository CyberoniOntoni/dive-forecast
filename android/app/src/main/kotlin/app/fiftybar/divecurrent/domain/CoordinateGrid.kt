package app.fiftybar.divecurrent.domain

import java.util.Locale
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToLong

/**
 * The web map's coordinate grid (lib/map-layers.ts: gridStep, gridValues, formatGridLabel): thin lat/long lines for the
 * view, at the finest of 10°, 5°, 2°, 1°, 30′, 10′, 5′, 2′, 1′ that keeps at most eight lines across, labelled the way
 * charts are (4°10′N, 73°30′E).
 */
object CoordinateGrid {
  private val STEPS = doubleArrayOf(10.0, 5.0, 2.0, 1.0, 1.0 / 2, 1.0 / 6, 1.0 / 12, 1.0 / 30, 1.0 / 60)
  private const val MAX_LINES = 8

  /** A line of latitude (`axis` "lat", at `value` north) or longitude ("lon"), with its label. */
  data class Line(val axis: String, val value: Double, val label: String)

  /** The finest spacing that keeps at most eight lines across the wider side of the view. */
  fun step(spanDeg: Double): Double {
    if (!(spanDeg > 0)) return STEPS[0]
    var chosen = STEPS[0]
    for (step in STEPS) if (spanDeg / step <= MAX_LINES) chosen = step
    return chosen
  }

  /** Multiples of `step` from `from` to `to`, rounded to the second so 10′ lines don't drift. */
  fun values(from: Double, to: Double, step: Double): List<Double> {
    val out = mutableListOf<Double>()
    var index = ceil(from / step - 1e-9).toLong()
    while (index * step <= to + 1e-9) {
      out += (index * step * 3600).roundToLong() / 3600.0
      index += 1
    }
    return out
  }

  /** Degrees and minutes: 4°10′N, 0°36′S, 73°30′E. The equator and meridian 0 have no letter. */
  fun label(value: Double, axis: String): String {
    val totalMinutes = (abs(value) * 60).roundToLong()
    val degrees = floor(totalMinutes / 60.0).toLong()
    val minutes = String.format(Locale.ROOT, "%02d", totalMinutes % 60)
    val hemisphere =
      when {
        totalMinutes == 0L -> ""
        axis == "lat" -> if (value > 0) "N" else "S"
        else -> if (value > 0) "E" else "W"
      }
    return "$degrees°$minutes′$hemisphere"
  }

  /** Every line for a view, latitudes first. */
  fun lines(south: Double, west: Double, north: Double, east: Double): List<Line> {
    val s = max(-85.0, south)
    val n = min(85.0, north)
    val step = step(max(n - s, east - west))
    return values(s, n, step).map { Line("lat", it, label(it, "lat")) } + values(west, east, step).map { Line("lon", it, label(it, "lon")) }
  }
}
