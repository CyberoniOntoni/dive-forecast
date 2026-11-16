package app.fiftybar.divecurrent.data.api

import kotlinx.serialization.Serializable

/*
 * The /api/v1 bodies (API.md in the web repo, shaped by lib/api-v1.ts). The JSON parser ignores unknown fields, so a
 * field the server adds later never breaks this version of the app. Enums arrive as strings and are read through
 * the helpers below, which give null for a value this app does not know, so it draws nothing instead of a wrong
 * reading and never fails the whole body. How an hour reads (arrow, words, colour) comes from the server in `glance`.
 */

@Serializable
data class ApiSites(
  val apiVersion: Int,
  val atolls: List<ApiAtoll> = emptyList(),
  val sites: List<ApiSite> = emptyList(),
)

@Serializable data class ApiAtoll(val id: String, val name: String)

@Serializable
data class ApiSite(
  val id: String,
  val name: String,
  val atollId: String,
  val lat: Double,
  val lon: Double,
  /** pass | channel-thila | corner | outer-reef | lagoon | strait-wall, or null when not classified. */
  val siteType: String? = null,
  /** The kind of site in the site page's words ("Rim pass"); null when not classified. */
  val siteTypeLabel: String? = null,
  val atollName: String? = null,
  val userAdded: Boolean = false,
  val sourceUrl: String? = null,
  val diveTopM: Double? = null,
  val diveMaxM: Double? = null,
  val approximatePin: Boolean = false,
  val pinNote: String? = null,
  val howToDive: String? = null,
  /** Paths on the server, oldest first. */
  val photoUrls: List<String> = emptyList(),
)

/** A site-hour of the forecast. Times are Maldives wall clock, "YYYY-MM-DDTHH:MM". */
@Serializable
data class ApiHour(
  val time: String,
  /** incoming | outgoing */
  val direction: String,
  /** slack | mild | strong | too_strong ("very strong" on screen) */
  val strength: String,
  /** low | medium | high */
  val confidence: String,
  val levelM: Double = 0.0,
  /** How the hour reads on screen, made by the server; null when there is no arrow to draw. */
  val glance: ApiGlance? = null,
)

/** lib/api-v1.ts ApiGlance: the web's own reading of one site-hour. */
@Serializable
data class ApiGlance(
  val arrowBearing: Double,
  /** "incoming", "outgoing", or "running NE" on a compass route. */
  val way: String,
  /** The way in a sentence: adds "along the reef" at a wall. */
  val spokenWay: String,
  /** At a channel also where the water heads: "incoming, toward NE". */
  val wayToward: String,
  /** "slack", "mild", "strong", "very strong". */
  val label: String,
  /** incoming | outgoing | along | stop */
  val tone: String,
  val opacity: Double = 1.0,
  /** Strongest first: 0 very strong to 3 slack. */
  val rank: Int,
  val estimatedHeading: Boolean = false,
)

@Serializable data class ApiWave(val heightM: Double, val fromDeg: Double, val periodS: Double? = null)

@Serializable data class ApiWind(val speedMs: Double, val fromDeg: Double)

@Serializable
data class ApiSeaStateHour(
  val time: String,
  /** calm | moderate | choppy | rough */
  val band: String,
  val feltM: Double,
  val swell: ApiWave? = null,
  val windWaveM: Double = 0.0,
  val wind: ApiWind? = null,
  val againstCurrent: Boolean = false,
)

@Serializable
data class ApiForecast(
  val apiVersion: Int,
  val modelVersion: String,
  val siteId: String,
  val hours: List<ApiHour> = emptyList(),
  val unavailable: Boolean = false,
  val stale: Boolean = false,
  val notice: String = "",
  val siteNote: String? = null,
  val fetchedAt: Long? = null,
  /** Empty when the waves failed to load; null when the site has no sea state. */
  val seaState: List<ApiSeaStateHour>? = null,
  /** True when the sea state comes from an old cached wave or wind series. */
  val seaStale: Boolean = false,
)

@Serializable
data class ApiNowcast(
  val apiVersion: Int,
  val modelVersion: String,
  val maldivesWall: String,
  val nowcasts: List<ApiSiteNowcast> = emptyList(),
)

@Serializable
data class ApiSiteNowcast(
  val siteId: String,
  val atollId: String,
  val hour: ApiHour? = null,
  val unavailable: Boolean = false,
  val stale: Boolean = false,
  val fetchedAt: Long? = null,
)

@Serializable data class ApiErrorBody(val error: ApiErrorDetail)

@Serializable
data class ApiErrorDetail(
  /** not_found | bad_request | server_error */
  val code: String,
  /** Text the server says can be shown to the diver. */
  val message: String,
)

enum class Strength(val wire: String) {
  Slack("slack"),
  Mild("mild"),
  Strong("strong"),
  TooStrong("too_strong");

  companion object {
    fun of(value: String): Strength? = entries.firstOrNull { it.wire == value }
  }
}

enum class Confidence {
  Low,
  Medium,
  High;

  companion object {
    /** Null for a value this app does not know. */
    fun of(value: String): Confidence? = entries.firstOrNull { it.name.equals(value, ignoreCase = true) }
  }
}

/** Which colour a glance takes: very strong is the stop colour; along a reef there is no in/out colour. */
enum class GlanceTone {
  Incoming,
  Outgoing,
  Along,
  Stop;

  companion object {
    /** Null for a value this app does not know. */
    fun of(value: String): GlanceTone? = entries.firstOrNull { it.name.equals(value, ignoreCase = true) }
  }
}

enum class SeaBand {
  Calm,
  Moderate,
  Choppy,
  Rough;

  companion object {
    fun of(value: String): SeaBand? = entries.firstOrNull { it.name.equals(value, ignoreCase = true) }
  }
}
