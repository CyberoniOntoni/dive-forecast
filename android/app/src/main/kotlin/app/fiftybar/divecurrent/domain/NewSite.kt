package app.fiftybar.divecurrent.domain

import app.fiftybar.divecurrent.data.api.AddSiteBody
import java.util.Locale

/**
 * The web map's "Add a site" form (components/AddSiteForm.tsx) without the screen: the kinds a diver picks from, as
 * lib/site-details.ts words them, and the checks the server makes, so a mistake is said before anything is sent. The
 * server checks everything again.
 */
object NewSite {
  data class Kind(val type: String, val label: String, val hint: String)

  /** As DIVER_SITE_TYPES in lib/site-details.ts; "Not sure" is null. */
  val KINDS =
    listOf(
      Kind("pass", "Channel (kandu)", "A gap through the atoll rim, or a thila in one"),
      Kind("corner", "Channel corner", "The reef corner where a channel meets the ocean"),
      Kind("lagoon", "Inside the lagoon", "A thila, giri or reef inside the atoll"),
      Kind("outer-reef", "Wall outside the atoll", "The ocean side of the rim, away from a channel"),
    )

  const val NAME_MAX = 80
  const val HOW_TO_DIVE_MAX = 1500
  const val MAX_DEPTH_M = 100.0

  /** "Pin 4.25000, 73.45000.", as the web form says it. */
  fun pinLine(lat: Double, lon: Double): String = "Pin ${"%.5f".format(Locale.ROOT, lat)}, ${"%.5f".format(Locale.ROOT, lon)}."

  /** A depth typed in metres ("8", "8.5", "8,5"); null when blank. Throws with the form's words when it is not one. */
  fun depth(text: String, label: String): Double? {
    val trimmed = text.trim()
    if (trimmed.isEmpty()) return null
    val metres = trimmed.replace(',', '.').toDoubleOrNull()
    if (metres == null || !metres.isFinite() || metres < 0 || metres > MAX_DEPTH_M) {
      throw IllegalArgumentException("$label must be 0 to ${MAX_DEPTH_M.toInt()} m.")
    }
    return metres
  }

  /** The body to send, or the reason it cannot be sent (the server's words). */
  fun body(
    name: String,
    lat: Double,
    lon: Double,
    kind: String?,
    top: String,
    max: String,
    howToDive: String,
    rating: Int?,
  ): Result<AddSiteBody> = runCatching {
    val trimmed = name.trim()
    require(trimmed.isNotEmpty()) { "Site name is required." }
    require(trimmed.length <= NAME_MAX) { "Site name must be 1 to $NAME_MAX characters." }
    val topM = depth(top, "Shallowest depth")
    val maxM = depth(max, "Deepest depth")
    require(topM == null || maxM == null || topM <= maxM) { "The shallowest depth is deeper than the deepest." }
    require(howToDive.trim().length <= HOW_TO_DIVE_MAX) { "How to dive it must be at most $HOW_TO_DIVE_MAX characters." }
    AddSiteBody(
      name = trimmed,
      lat = lat,
      lon = lon,
      diverSiteType = kind?.takeIf { k -> KINDS.any { it.type == k } },
      diveTopM = topM,
      diveMaxM = maxM,
      howToDive = howToDive.trim().ifEmpty { null },
      rating = rating?.takeIf { it in 1..5 },
    )
  }
}
