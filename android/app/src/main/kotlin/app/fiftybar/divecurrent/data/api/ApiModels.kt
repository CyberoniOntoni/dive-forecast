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
  /** The report form's words for this site; null from a server before reports came to the app. */
  val reportWays: ApiReportWays? = null,
)

/** What the report form's two choices say here: "Incoming" / "Outgoing", or "Running NE" / "Running SW" on a wall. */
@Serializable data class ApiReportWays(val legend: String, val incoming: String, val outgoing: String)

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
  /** not_found | bad_request | unauthorized | needs_nickname | server_error; go by the HTTP status for others. */
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

/** GET /api/v1/sites/{id}/reports: divers' newest reports, in the server's words. */
@Serializable
data class ApiRecentReports(val apiVersion: Int, val siteId: String, val reports: List<ApiRecentReport> = emptyList())

@Serializable
data class ApiRecentReport(
  val time: String,
  /** "Tue 30 Sep 09:00". */
  val `when`: String,
  /** "2 days ago", from when the server answered. */
  val ago: String,
  /** "Incoming", "Outgoing", or "Running NE". */
  val way: String,
  val strength: String,
  val forecast: ApiReportForecast? = null,
  val beforeAxis: Boolean = false,
  /** Nickname; null for reports from before sign-in. */
  val by: String? = null,
)

/** What the site showed at the report's hour; `match` is match | close | miss. */
@Serializable data class ApiReportForecast(val way: String, val strength: String, val match: String)

@Serializable data class ApiCodeSent(val apiVersion: Int, val newUser: Boolean = false)

/** The app's session: sent back as `Authorization: Bearer <token>`. `expiresAt` is Unix ms. */
@Serializable data class ApiToken(val apiVersion: Int, val token: String, val nickname: String, val expiresAt: Long)

@Serializable
data class ApiMe(
  val apiVersion: Int,
  val nickname: String,
  val points: Int = 0,
  val monthPoints: Int = 0,
  val reports: Int = 0,
  val monthRank: Int? = null,
  val allRank: Int? = null,
)

@Serializable
data class ApiReportSaved(val apiVersion: Int, val report: ApiSavedReport, val award: ApiAward? = null)

@Serializable
data class ApiSavedReport(val id: String, val siteId: String, val time: String, val direction: String, val strength: String)

/** What a report earned; `line` says it in words. */
@Serializable
data class ApiAward(val points: Int, val reasons: List<String> = emptyList(), val uncounted: String? = null, val line: String = "")

@Serializable data class CodeRequest(val email: String)

@Serializable data class TokenRequest(val email: String, val code: String, val nickname: String? = null)

/** A report as the app files it: Maldives wall time, incoming | outgoing, and a Strength wire value. */
@Serializable data class ReportRequest(val time: String, val direction: String, val strength: String)

/** A write that answers with nothing more than its version. */
@Serializable data class ApiOk(val apiVersion: Int)

/** GET /api/v1/plans/{id}: a dive plan in the plan page's words. Anyone with the id reads it. */
@Serializable
data class ApiPlan(
  val apiVersion: Int,
  val id: String,
  val title: String,
  val notes: String? = null,
  val boatSpeedKn: Double = 8.0,
  val span: String = "",
  val ownerNickname: String? = null,
  val isOwner: Boolean = false,
  val webPath: String = "",
  val updatedAt: String = "",
  val nowWall: String = "",
  val days: List<ApiPlanDay> = emptyList(),
)

@Serializable
data class ApiPlanDay(
  val date: String,
  /** "Tue 17 Nov". */
  val label: String,
  val today: Boolean = false,
  val past: Boolean = false,
  /** Dives with a warning. */
  val toCheck: Int = 0,
  val stops: List<ApiPlanStop> = emptyList(),
)

@Serializable
data class ApiPlanStop(
  val siteId: String,
  val name: String,
  val lat: Double,
  val lon: Double,
  val facts: String = "",
  val howToDive: String? = null,
  /** "HH:MM", Maldives. */
  val time: String,
  val note: String? = null,
  /** "Wanted: incoming". */
  val want: String? = null,
  /** forecast | unavailable | beyond | past */
  val status: String = "unavailable",
  val message: String? = null,
  val way: String? = null,
  val arrowBearing: Double? = null,
  val strength: String? = null,
  /** Very strong: the warning colour. */
  val veryStrong: Boolean = false,
  /** incoming | outgoing | stop | none */
  val tone: String = "none",
  val sea: String? = null,
  val seaRough: Boolean = false,
  val confidence: String? = null,
  /** "Forecast: fairly sure". */
  val confidenceLabel: String? = null,
  val warnings: List<String> = emptyList(),
  val better: String? = null,
  /** Set once the dive is over and still reportable: the report form's time. */
  val reportTime: String? = null,
)

/** GET /api/v1/plans/{id}/days/{day}/legs: the boat between one day's dives. */
@Serializable
data class ApiPlanLegs(val apiVersion: Int, val planId: String, val dayIndex: Int, val legs: List<ApiPlanLeg> = emptyList())

@Serializable
data class ApiPlanLeg(
  /** Index of the dive it leaves from. */
  val from: Int,
  /** "2.1 nm · about 20 min at 8 kn", or "Same spot". */
  val text: String,
  /** "Leave by 10:35". */
  val leaveBy: String? = null,
  val tight: Boolean = false,
  val tightNote: String? = null,
  /** "Straight line: no way round the reef found". */
  val note: String? = null,
  val routed: Boolean = true,
)

/** GET /api/v1/plans: the signed-in diver's own plans. */
@Serializable data class ApiPlanSummaries(val apiVersion: Int, val plans: List<ApiPlanSummary> = emptyList())

@Serializable
data class ApiPlanSummary(
  val id: String,
  val title: String,
  val span: String = "",
  /** "4 days · 11 dives". */
  val size: String = "",
  val first: String = "",
  val last: String = "",
)
