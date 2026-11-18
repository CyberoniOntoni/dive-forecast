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

/**
 * An atoll. [bounds] is the box round its outline, for saving it offline; null from an older server or when the server
 * has no outline (the app then pads the box round the atoll's sites).
 */
@Serializable data class ApiAtoll(val id: String, val name: String, val bounds: ApiBounds? = null)

/** A lat/lon box, degrees. */
@Serializable data class ApiBounds(val south: Double, val west: Double, val north: Double, val east: Double)

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
  /** Sites this diver added in the app: only they can add photos there. */
  val addedSiteIds: List<String> = emptyList(),
  val about: String = "",
  val ratings: Int = 0,
  /** Different sites reported at. */
  val reportSites: Int = 0,
  val atolls: Int = 0,
  /** Every badge, earned or not. */
  val badges: List<ApiBadge> = emptyList(),
  /** "How points work", one line each. */
  val pointsRules: List<String> = emptyList(),
  val aboutMaxChars: Int = 300,
  /** Agreed to the content rules (/terms); false for divers from before them, who agree once before posting. */
  val acceptedTerms: Boolean = true,
  /** Divers this one blocked, by nickname. */
  val blocked: List<String> = emptyList(),
)

@Serializable data class ApiBadge(val id: String, val label: String, val detail: String, val earned: Boolean = true)

@Serializable
data class ApiReportSaved(val apiVersion: Int, val report: ApiSavedReport, val award: ApiAward? = null)

@Serializable
data class ApiSavedReport(val id: String, val siteId: String, val time: String, val direction: String, val strength: String)

/** What a report earned; `line` says it in words. */
@Serializable
data class ApiAward(val points: Int, val reasons: List<String> = emptyList(), val uncounted: String? = null, val line: String = "")

@Serializable data class CodeRequest(val email: String)

/** `acceptTerms`: the "I agree to the content rules and privacy policy" box, always sent (no default, so it is encoded). */
@Serializable data class TokenRequest(val email: String, val code: String, val nickname: String? = null, val acceptTerms: Boolean)

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
data class ApiPlanLegs(
  val apiVersion: Int,
  val planId: String,
  val dayIndex: Int,
  val legs: List<ApiPlanLeg> = emptyList(),
  /** "4.2 nm by boat · about 35 min at 8 kn": the day's line; null from an older server or with no legs. */
  val total: String? = null,
)

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
  /** The boat's way round the reef, [lat, lon] pairs, for the day's map. */
  val points: List<List<Double>> = emptyList(),
)

/** GET /api/v1/plans: the signed-in diver's own plans. */
@Serializable
data class ApiPlanSummaries(
  val apiVersion: Int,
  val plans: List<ApiPlanSummary> = emptyList(),
  val limits: ApiPlanLimits = ApiPlanLimits(),
)

/**
 * What the plan editor allows (server lib/dive-plan.ts). The server sends these with every plan list and editable plan,
 * so the editor uses its numbers; the defaults are only a fallback when that list could not load.
 */
@Serializable
data class ApiPlanLimits(
  val titleMax: Int = 80,
  val notesMax: Int = 1500,
  val diveNoteMax: Int = 300,
  val daysMax: Int = 16,
  val divesPerDayMax: Int = 6,
  val plansMax: Int = 40,
  val boatSpeedMinKn: Double = 3.0,
  val boatSpeedMaxKn: Double = 40.0,
  val boatSpeedDefaultKn: Double = 8.0,
  val yearMin: Int = 2020,
  val yearMax: Int = 2100,
)

/**
 * A plan as its owner edits it (GET /api/v1/plans/{id}/edit), and the body POST /api/v1/plans and PUT
 * /api/v1/plans/{id} take: the same days and dives.
 */
@Serializable
data class ApiEditablePlan(
  val apiVersion: Int = 1,
  val id: String = "",
  val title: String = "",
  val notes: String? = null,
  val boatSpeedKn: Double = 8.0,
  val days: List<PlanDayBody> = emptyList(),
  val updatedAt: String = "",
  val limits: ApiPlanLimits = ApiPlanLimits(),
)

@Serializable
data class PlanBody(val title: String, val notes: String?, val boatSpeedKn: Double, val days: List<PlanDayBody>)

@Serializable data class PlanDayBody(val date: String, val stops: List<PlanStopBody> = emptyList())

/** `want`: "incoming" or "outgoing", only at a channel. */
@Serializable
data class PlanStopBody(val siteId: String, val time: String, val note: String? = null, val want: String? = null)

@Serializable data class ApiPlanSaved(val apiVersion: Int = 1, val id: String)

@Serializable data class ApiPlanDeleted(val apiVersion: Int = 1, val id: String, val deleted: Boolean = true)

/** GET /api/v1/plan-sites: every site the editor can pick, and the Maldives date a new plan starts on. */
@Serializable data class ApiPlanSites(val apiVersion: Int = 1, val today: String = "", val sites: List<ApiPickerSite> = emptyList())

/** `channel`: the dive takes a wanted way (incoming or outgoing). */
@Serializable data class ApiPickerSite(val id: String, val name: String, val atoll: String? = null, val channel: Boolean = false)

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

/** GET /api/v1/boat-route: the route from the boat to a site or point, and the forecast current along it. */
@Serializable
data class ApiBoatRoute(
  val apiVersion: Int = 1,
  /** [lat, lon] from the boat to the destination; the straight line when [routed] is false. */
  val points: List<List<Double>> = emptyList(),
  val lengthKm: Double = 0.0,
  val directKm: Double = 0.0,
  val routed: Boolean = false,
  val gaps: List<ApiRouteGap> = emptyList(),
  val current: ApiRouteCurrent? = null,
)

@Serializable data class ApiRouteGap(val lat: Double, val lon: Double, val widthM: Double = 0.0, val shallow: Boolean = false)

@Serializable
data class ApiRouteCurrent(
  val stepKm: Double,
  /** One per sample every [stepKm]: an index into [sources], or -1 where no forecast covers the route. */
  val samples: List<Int> = emptyList(),
  val sources: List<ApiRouteCurrentSource> = emptyList(),
)

@Serializable
data class ApiRouteCurrentSource(
  /** Null for the ocean model offshore. */
  val siteId: String? = null,
  val name: String,
  val hours: List<ApiRouteCurrentHour> = emptyList(),
)

@Serializable
data class ApiRouteCurrentHour(
  /** Unix ms at the start of the hour. */
  val timeMs: Long,
  val eastKn: Double,
  val northKn: Double,
  /** The site forecast's band ("too_strong" is very strong); null offshore. */
  val strength: String? = null,
)

/** GET /api/v1/shelter: the "Sheltered water" layer for a map view at one hour. */
@Serializable
data class ApiShelter(
  val apiVersion: Int = 1,
  /** The hour shown, a Maldives wall hour. */
  val time: String,
  /** The hours that can be picked, from the current one. */
  val hours: List<String> = emptyList(),
  val stale: Boolean = false,
  val atolls: List<ApiShelterAtoll> = emptyList(),
  val scale: ApiShelterScale,
)

/** One atoll's grid: [rows] × [columns] cells from the south-west corner, one byte per cell (domain/ShelterField). */
@Serializable
data class ApiShelterAtoll(
  val wayId: String,
  /** coarse | fine */
  val layer: String,
  val south: Double,
  val west: Double,
  val stepDeg: Double,
  val rows: Int,
  val columns: Int,
  /** Base64. */
  val values: String,
)

@Serializable
data class ApiShelterScale(
  val maxM: Double,
  val stops: List<ApiScaleStop> = emptyList(),
  val ticks: List<ApiScaleTick> = emptyList(),
  val opacity: Double = 0.85,
)

@Serializable data class ApiScaleStop(val m: Double, val color: String)

@Serializable data class ApiScaleTick(val label: String, val m: Double)

/** GET /api/v1/shelter/shapes/{wayId}: what the shading is cut to. */
@Serializable
data class ApiShelterShapes(
  val apiVersion: Int = 1,
  val wayId: String,
  val outline: List<List<Double>> = emptyList(),
  val islands: List<List<List<Double>>> = emptyList(),
)

/** GET /api/v1/shelter/point: the sea state at a tapped spot, with the words to show. */
@Serializable
data class ApiShelterPoint(
  val apiVersion: Int = 1,
  val time: String,
  val inLayer: Boolean = false,
  val seaState: ApiSeaStateHour? = null,
  val head: String? = null,
  val detail: String? = null,
)

/** GET /api/v1/sites/{id}/reviews, and the answer to every review write: the site page's ratings and reviews card. */
@Serializable
data class ApiReviews(
  val apiVersion: Int = 1,
  val siteId: String,
  val summary: ApiRatingSummary = ApiRatingSummary(),
  /** "4.2 from 5 divers", or "No ratings yet". */
  val summaryLine: String = "",
  /** Other divers' reviews with text or photos, newest first. */
  val reviews: List<ApiReview> = emptyList(),
  /** The signed-in diver's own; null signed out or not rated. */
  val mine: ApiReview? = null,
  val ratingPoints: Int = 3,
  val reviewMaxChars: Int = 1500,
  val maxPhotos: Int = 6,
)

@Serializable data class ApiRatingSummary(val average: Double? = null, val count: Int = 0, val mine: Int? = null)

@Serializable
data class ApiReview(
  val nickname: String,
  val score: Int,
  val review: String? = null,
  val photos: List<ApiReviewPhoto> = emptyList(),
  val updatedAt: String = "",
  /** "9 Nov 2026". */
  val date: String = "",
)

/** [url] is a path on the server, `/site-photos/<site>/<photo>.jpg`. */
@Serializable data class ApiReviewPhoto(val id: String, val url: String)

@Serializable data class RatingBody(val score: Int)

@Serializable data class ReviewBody(val text: String)

/** POST /api/v1/sites: a new site at a pin. Nulls are left out, as the web form leaves blank fields out. */
@Serializable
data class AddSiteBody(
  val name: String,
  val lat: Double,
  val lon: Double,
  /** pass | corner | lagoon | outer-reef, or null for "Not sure". */
  val diverSiteType: String? = null,
  val diveTopM: Double? = null,
  val diveMaxM: Double? = null,
  val howToDive: String? = null,
  val rating: Int? = null,
)

/** The answer to adding a site or one of its photos: the site as GET /api/v1/sites/{id} gives it. */
@Serializable data class ApiSiteSaved(val apiVersion: Int = 1, val site: ApiSite)

/** GET /api/v1/scoreboard: one board, its words made on the server. */
@Serializable
data class ApiScoreboard(
  val apiVersion: Int = 1,
  /** month | all | sites */
  val board: String,
  val title: String = "",
  val note: String = "",
  val empty: String = "",
  val rows: List<ApiScoreRow> = emptyList(),
  /** The newest sites, on the sites board only. */
  val newest: List<ApiNewSite> = emptyList(),
)

@Serializable
data class ApiScoreRow(
  val rank: Int,
  val nickname: String,
  val detail: String = "",
  val score: Int = 0,
  /** "site" or "sites" on the sites board; null where the score is points. */
  val unit: String? = null,
  val isMe: Boolean = false,
)

@Serializable data class ApiNewSite(val siteId: String, val name: String, val nickname: String)

/** GET /api/v1/divers/{nickname}: a diver's public page. */
@Serializable
data class ApiDiver(
  val apiVersion: Int = 1,
  val nickname: String,
  val about: String = "",
  /** "Diving with us since Oct 2026 · #3 all time". */
  val sinceLine: String = "",
  val points: Int = 0,
  val reports: Int = 0,
  val reportSites: Int = 0,
  val ratings: Int = 0,
  val sitesAdded: Int = 0,
  val allRank: Int? = null,
  /** Earned badges only. */
  val badges: List<ApiBadge> = emptyList(),
  val isMe: Boolean = false,
  /** The signed-in diver blocked this one: `about` comes empty. */
  val blockedByMe: Boolean = false,
)

/** POST /api/v1/flags: a report of objectionable content (API.md § Content rules, reports and blocking). */
@Serializable
data class FlagBody(val kind: String, val siteId: String? = null, val nickname: String? = null, val reason: String, val note: String? = null)

@Serializable data class ApiFlagSent(val apiVersion: Int = 1, val sent: Boolean = true)

@Serializable data class ApiBlocked(val apiVersion: Int = 1, val blocked: Boolean = false)

@Serializable data class AboutBody(val about: String)

@Serializable data class NicknameBody(val nickname: String)

@Serializable data class ApiAboutSaved(val apiVersion: Int = 1, val about: String = "")

@Serializable data class ApiNicknameSaved(val apiVersion: Int = 1, val nickname: String)
