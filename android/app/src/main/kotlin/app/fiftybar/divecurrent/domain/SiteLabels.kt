package app.fiftybar.divecurrent.domain

import app.fiftybar.divecurrent.data.api.ApiSite
import app.fiftybar.divecurrent.data.api.SeaBand
import kotlin.math.roundToInt

/** "5–30 m", "to 30 m", or null. */
fun depthLabel(site: ApiSite): String? {
  val top = site.diveTopM?.let(::metres)
  val max = site.diveMaxM?.let(::metres)
  return when {
    top != null && max != null -> "$top–$max m"
    max != null -> "to $max m"
    top != null -> "from $top m"
    else -> null
  }
}

private fun metres(value: Double): String =
  if (value == Math.floor(value)) value.toInt().toString() else "%.1f".format(value)

fun seaBandLabel(band: SeaBand): String = band.name.lowercase()

fun heightLabel(metres: Double): String = "%.1f m".format(metres)

/** Metres per second to whole knots: what boats talk in. */
fun windKnots(speedMs: Double): Int = (speedMs * 1.943844).roundToInt()
