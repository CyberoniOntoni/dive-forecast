package app.fiftybar.divecurrent.domain

import app.fiftybar.divecurrent.data.api.ApiBounds
import app.fiftybar.divecurrent.data.api.ApiForecast
import app.fiftybar.divecurrent.data.api.ApiHour
import app.fiftybar.divecurrent.data.api.ApiSite
import kotlinx.serialization.Serializable

/**
 * An atoll saved on the phone for use without signal: its sites' pages and week of forecast, and the Allen Coral
 * Atlas shapes over it. [keys] are the phone's copies it saved, so removing it drops them (but not those another
 * saved atoll also holds).
 */
@Serializable
data class SavedArea(
  val atollId: String,
  val name: String,
  /** When the last save finished, Unix ms. */
  val savedAt: Long,
  val siteIds: List<String>,
  val keys: List<String>,
  /** Sites whose forecast could not be fetched on the last save: they keep an older copy, or none. */
  val missedSites: Int = 0,
  /** About what it takes on the phone, bytes. */
  val bytes: Long = 0,
)

/** What saving an atoll needs, worked out from what the server lists. */
object OfflineArea {
  /** Round the sites when the server gives no outline: about 11 km, enough for a small atoll's rim. */
  const val SITES_PAD_DEG = 0.1

  /** Round the outline: the outer reef slope and the pins just off it. */
  const val OUTLINE_PAD_DEG = 0.02

  /** A saved atoll older than this is fetched again when the app has signal. */
  const val REFRESH_AFTER_MS = 6 * 3_600_000L

  /** The box to save: the atoll's outline, or its sites when the server has none, padded either way. Null with neither. */
  fun box(bounds: ApiBounds?, sites: List<ApiSite>): ApiBounds? {
    if (bounds != null) return pad(bounds, OUTLINE_PAD_DEG)
    if (sites.isEmpty()) return null
    return pad(ApiBounds(sites.minOf { it.lat }, sites.minOf { it.lon }, sites.maxOf { it.lat }, sites.maxOf { it.lon }), SITES_PAD_DEG)
  }

  private fun pad(b: ApiBounds, by: Double) = ApiBounds(b.south - by, b.west - by, b.north + by, b.east + by)

  /** The saved atoll's forecast hour for [nowMs]: the Maldives hour nearest the clock, as the map's nowcast picks it. */
  fun hourNow(forecast: ApiForecast?, nowMs: Long): ApiHour? {
    if (forecast == null || forecast.unavailable) return null
    val hour = MaldivesTime.nearestHour(nowMs).take(13)
    return forecast.hours.firstOrNull { it.time.take(13) == hour }
  }

  /** The keys [area] holds that no other saved atoll in [others] holds too: the ones to drop when it is removed. */
  fun keysToDrop(area: SavedArea, others: Collection<SavedArea>): List<String> {
    val kept = others.filter { it.atollId != area.atollId }.flatMapTo(HashSet()) { it.keys }
    return area.keys.filter { it !in kept }
  }

  /** "12 MB", "640 KB": about what a saved atoll takes. */
  fun sizeLabel(bytes: Long): String =
    when {
      bytes >= 1_000_000 -> "${(bytes + 500_000) / 1_000_000} MB"
      else -> "${maxOf(1, (bytes + 500) / 1_000)} KB"
    }
}
