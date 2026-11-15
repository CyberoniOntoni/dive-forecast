package app.fiftybar.divecurrent.domain

import app.fiftybar.divecurrent.data.api.ApiSite
import app.fiftybar.divecurrent.data.api.SeaBand
import kotlin.math.roundToInt

/** The kind of site, in the words of SITE_TYPE_LABEL in the web repo's lib/site-type.ts. */
fun siteTypeLabel(siteType: String?): String? =
  when (siteType) {
    "pass" -> "Rim pass"
    "channel-thila" -> "Channel thila"
    "corner" -> "Channel corner"
    "outer-reef" -> "Outer reef"
    "lagoon" -> "Lagoon"
    "strait-wall" -> "Strait wall"
    else -> null
  }

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

/** Wind in knots: what boats talk in. */
fun windLabel(speedMs: Double, fromDeg: Double): String =
  "${(speedMs * 1.943844).roundToInt()} kn from ${compassWord(fromDeg)}"
