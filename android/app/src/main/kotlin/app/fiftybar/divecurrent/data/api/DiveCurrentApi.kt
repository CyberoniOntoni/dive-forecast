package app.fiftybar.divecurrent.data.api

import app.fiftybar.divecurrent.domain.AtlasIndex
import java.io.IOException
import java.util.Locale
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** A failed call. [message] is safe to show: either the server's own error text or a plain one of ours. */
sealed class ApiException(message: String) : Exception(message) {
  /** The server answered with an error body. */
  class Server(val status: Int, val code: String, message: String) : ApiException(message) {
    /** The token no longer works (expired, signed out everywhere): sign in again. */
    val signedOut: Boolean
      get() = status == 401
  }

  /** No answer: offline, timed out, DNS. */
  class Network(cause: IOException) : ApiException("No connection to the forecast server.") {
    init {
      initCause(cause)
    }
  }

  /** An answer we could not read. */
  class Malformed(cause: Throwable) : ApiException("The forecast server sent something this app cannot read.") {
    init {
      initCause(cause)
    }
  }
}

val ApiJson = Json {
  ignoreUnknownKeys = true
  explicitNulls = false
  coerceInputValues = true
}

/**
 * Talks to /api/v1. Each read returns the decoded body and the raw JSON, so the repository can keep the exact text
 * for offline use. Calls about one diver send the app's token as `Authorization: Bearer`; writes send JSON.
 */
class DiveCurrentApi(baseUrl: String, private val client: OkHttpClient = defaultClient()) {
  private val base: HttpUrl = baseUrl.trimEnd('/').toHttpUrl()

  /** A server path ("/site-photos/…") as a full URL, for Coil. */
  fun absolute(path: String): String =
    if (path.startsWith("http://") || path.startsWith("https://")) path else base.resolve(path)?.toString() ?: path

  suspend fun sites(): Pair<ApiSites, String> = get(listOf("api", "v1", "sites"))

  suspend fun site(id: String): Pair<ApiSite, String> = get(listOf("api", "v1", "sites", id))

  suspend fun forecast(siteId: String): Pair<ApiForecast, String> =
    get(listOf("api", "v1", "sites", siteId, "forecast"))

  suspend fun nowcast(): Pair<ApiNowcast, String> = get(listOf("api", "v1", "nowcast"))

  /** With the diver's token the list also holds what only they may see (the store-review account's own reports). */
  suspend fun reports(siteId: String, token: String? = null): Pair<ApiRecentReports, String> =
    get(listOf("api", "v1", "sites", siteId, "reports"), token)

  /** A plan by its share id; with the diver's token the answer says whether they made it. */
  suspend fun plan(id: String, token: String?): Pair<ApiPlan, String> = get(listOf("api", "v1", "plans", id), token)

  suspend fun planLegs(id: String, dayIndex: Int): Pair<ApiPlanLegs, String> =
    get(listOf("api", "v1", "plans", id, "days", dayIndex.toString(), "legs"))

  suspend fun myPlans(token: String): ApiPlanSummaries = get<ApiPlanSummaries>(listOf("api", "v1", "plans"), token).first

  /** Every site the plan editor can pick. */
  suspend fun planSites(): Pair<ApiPlanSites, String> = get(listOf("api", "v1", "plan-sites"))

  /** The diver's own plan for the editor. */
  suspend fun editablePlan(token: String, id: String): ApiEditablePlan =
    get<ApiEditablePlan>(listOf("api", "v1", "plans", id, "edit"), token).first

  suspend fun createPlan(token: String, plan: PlanBody): ApiPlanSaved =
    send("POST", listOf("api", "v1", "plans"), ApiJson.encodeToString(plan), token)

  suspend fun updatePlan(token: String, id: String, plan: PlanBody): ApiPlanSaved =
    send("PUT", listOf("api", "v1", "plans", id), ApiJson.encodeToString(plan), token)

  suspend fun deletePlan(token: String, id: String): ApiPlanDeleted = send("DELETE", listOf("api", "v1", "plans", id), null, token)

  /** Emails a sign-in code. */
  suspend fun requestCode(email: String): ApiCodeSent =
    post(listOf("api", "v1", "sign-in", "code"), ApiJson.encodeToString(CodeRequest(email)), token = null)

  /** Trades the emailed code (and a new diver's nickname) for the app's token. */
  suspend fun token(email: String, code: String, nickname: String?, acceptTerms: Boolean): ApiToken =
    post(listOf("api", "v1", "sign-in", "token"), ApiJson.encodeToString(TokenRequest(email, code, nickname, acceptTerms)), token = null)

  /** Reports a review, a site added in the app or a diver to the moderators. */
  suspend fun flag(token: String, body: FlagBody): ApiFlagSent = post(listOf("api", "v1", "flags"), ApiJson.encodeToString(body), token)

  /** Blocks (or unblocks) a diver for the signed-in one. */
  suspend fun block(token: String, nickname: String, blocked: Boolean): ApiBlocked =
    // OkHttp needs a body on POST; the server reads none.
    send(if (blocked) "POST" else "DELETE", listOf("api", "v1", "divers", nickname, "block"), if (blocked) "{}" else null, token)

  /** Agrees to the content rules, for divers who signed up before them. */
  suspend fun acceptTerms(token: String) {
    post<ApiOk>(listOf("api", "v1", "me", "terms"), "{}", token)
  }

  suspend fun me(token: String): ApiMe = get<ApiMe>(listOf("api", "v1", "me"), token).first

  /** One scoreboard (month, all or sites); with a token the diver's own row is marked. */
  suspend fun scoreboard(board: String, token: String?): ApiScoreboard {
    val url = url(listOf("api", "v1", "scoreboard")).newBuilder().addQueryParameter("board", board).build()
    return decode(fetch(Request.Builder().url(url).get().withToken(token)))
  }

  /** A diver's public page by nickname; with a token it says whether it is theirs. */
  suspend fun diver(nickname: String, token: String?): ApiDiver = get<ApiDiver>(listOf("api", "v1", "divers", nickname), token).first

  suspend fun saveAbout(token: String, about: String): ApiAboutSaved =
    send("PUT", listOf("api", "v1", "me", "about"), ApiJson.encodeToString(AboutBody(about)), token)

  suspend fun saveNickname(token: String, nickname: String): ApiNicknameSaved =
    send("PUT", listOf("api", "v1", "me", "nickname"), ApiJson.encodeToString(NicknameBody(nickname)), token)

  /** Deletes the diver's account and data (API.md § DELETE /api/v1/me); every token of the diver stops working. */
  suspend fun deleteAccount(token: String) {
    send<ApiOk>("DELETE", listOf("api", "v1", "me"), null, token)
  }

  suspend fun signOutEverywhere(token: String) {
    post<ApiOk>(listOf("api", "v1", "sign-out-everywhere"), "{}", token)
  }

  suspend fun fileReport(token: String, siteId: String, report: ReportRequest): ApiReportSaved =
    post(listOf("api", "v1", "sites", siteId, "reports"), ApiJson.encodeToString(report), token)

  /** A boat route from [fromLat], [fromLon] to a site id or a "lat,lon" point. Never kept: it is about one position. */
  suspend fun boatRoute(fromLat: Double, fromLon: Double, to: String): ApiBoatRoute {
    val url =
      url(listOf("api", "v1", "boat-route"))
        .newBuilder()
        .addQueryParameter("from", "${"%.5f".format(Locale.ROOT, fromLat)},${"%.5f".format(Locale.ROOT, fromLon)}")
        .addQueryParameter("to", to)
        .build()
    return decode(fetch(Request.Builder().url(url).get()))
  }

  /** The site's ratings and reviews; with a token, the diver's own too. */
  suspend fun reviews(siteId: String, token: String?): ApiReviews = get<ApiReviews>(listOf("api", "v1", "sites", siteId, "reviews"), token).first

  suspend fun rate(token: String, siteId: String, score: Int): ApiReviews =
    send("PUT", listOf("api", "v1", "sites", siteId, "rating"), ApiJson.encodeToString(RatingBody(score)), token)

  suspend fun removeRating(token: String, siteId: String): ApiReviews = send("DELETE", listOf("api", "v1", "sites", siteId, "rating"), null, token)

  suspend fun saveReview(token: String, siteId: String, text: String): ApiReviews =
    send("PUT", listOf("api", "v1", "sites", siteId, "review"), ApiJson.encodeToString(ReviewBody(text)), token)

  /** One photo for the diver's review: [jpeg] already shrunk (PhotoShrink), at most 1.5 MB. */
  suspend fun addReviewPhoto(token: String, siteId: String, jpeg: ByteArray): ApiReviews =
    postJpeg(listOf("api", "v1", "sites", siteId, "review", "photos"), jpeg, token)

  suspend fun removeReviewPhoto(token: String, siteId: String, photoId: String): ApiReviews =
    send("DELETE", listOf("api", "v1", "sites", siteId, "review", "photos", photoId), null, token)

  /** The edit form for the site's texts, with the diver's own edit (API.md § Site texts). */
  suspend fun siteTexts(token: String, siteId: String): ApiSiteTexts = get<ApiSiteTexts>(listOf("api", "v1", "sites", siteId, "texts"), token).first

  suspend fun proposeSiteTexts(token: String, siteId: String, body: SiteTextsBody): ApiSiteTexts =
    post(listOf("api", "v1", "sites", siteId, "texts"), ApiJson.encodeToString(body), token)

  suspend fun withdrawSiteEdit(token: String, siteId: String, editId: String): ApiSiteTexts =
    send("DELETE", listOf("api", "v1", "sites", siteId, "texts", editId), null, token)

  suspend fun addSite(token: String, site: AddSiteBody): ApiSiteSaved =
    post(listOf("api", "v1", "sites"), ApiJson.encodeToString(site), token)

  /** One photo for a site the diver added: [jpeg] already shrunk (PhotoShrink), at most 1.5 MB. */
  suspend fun addSitePhoto(token: String, siteId: String, jpeg: ByteArray): ApiSiteSaved = postJpeg(listOf("api", "v1", "sites", siteId, "photos"), jpeg, token)

  /** The sheltered-water layer for a view, at a Maldives wall hour or (null) the current one. */
  suspend fun shelter(south: Double, west: Double, north: Double, east: Double, time: String?): ApiShelter {
    val url =
      url(listOf("api", "v1", "shelter"))
        .newBuilder()
        .addQueryParameter("south", degrees(south))
        .addQueryParameter("west", degrees(west))
        .addQueryParameter("north", degrees(north))
        .addQueryParameter("east", degrees(east))
        .apply { if (time != null) addQueryParameter("time", time) }
        .build()
    return decode(fetch(Request.Builder().url(url).get()))
  }

  suspend fun shelterShapes(wayId: String): ApiShelterShapes = get<ApiShelterShapes>(listOf("api", "v1", "shelter", "shapes", wayId)).first

  suspend fun shelterPoint(lat: Double, lon: Double, time: String): ApiShelterPoint {
    val url =
      url(listOf("api", "v1", "shelter", "point"))
        .newBuilder()
        .addQueryParameter("at", "${degrees(lat)},${degrees(lon)}")
        .addQueryParameter("time", time)
        .build()
    return decode(fetch(Request.Builder().url(url).get()))
  }

  /** An Atlas overlay's tile list, a static file on the server (public/overlays/<folder>/index.json). */
  suspend fun atlasIndex(folder: String): AtlasIndex = decode(atlasIndexText(folder))

  /** The same as its text, to keep a copy of. Checked to read as an index, so a broken body is never kept. */
  suspend fun atlasIndexText(folder: String): String =
    fetch(Request.Builder().url(url(listOf("overlays", folder, "index.json"))).get()).also { decode<AtlasIndex>(it) }

  /** One Atlas tile, as its JSON text (domain/AtlasOverlay.kt reads it). */
  suspend fun atlasTile(folder: String, file: String): String = fetch(Request.Builder().url(url(listOf("overlays", folder, file))).get())

  private fun degrees(value: Double): String = "%.5f".format(Locale.ROOT, value)

  private fun url(segments: List<String>): HttpUrl =
    base.newBuilder().apply { segments.forEach { addPathSegment(it) } }.build()

  private suspend inline fun <reified T> get(segments: List<String>, token: String? = null): Pair<T, String> {
    val text = fetch(Request.Builder().url(url(segments)).get().withToken(token))
    return decode<T>(text) to text
  }

  private suspend inline fun <reified T> post(segments: List<String>, json: String, token: String?): T =
    send("POST", segments, json, token)

  /** A photo upload: the JPEG itself as the body. */
  private suspend inline fun <reified T> postJpeg(segments: List<String>, jpeg: ByteArray, token: String): T =
    decode(fetch(Request.Builder().url(url(segments)).post(jpeg.toRequestBody(JPEG)).withToken(token)))

  /** A write: POST or PUT with a JSON body, or DELETE without one. */
  private suspend inline fun <reified T> send(method: String, segments: List<String>, json: String?, token: String?): T =
    decode(fetch(Request.Builder().url(url(segments)).method(method, json?.toRequestBody(JSON)).withToken(token)))

  private inline fun <reified T> decode(text: String): T =
    try {
      ApiJson.decodeFromString<T>(text)
    } catch (e: SerializationException) {
      throw ApiException.Malformed(e)
    } catch (e: IllegalArgumentException) {
      throw ApiException.Malformed(e)
    }

  private fun Request.Builder.withToken(token: String?): Request.Builder =
    apply { if (token != null) header("Authorization", "Bearer $token") }

  private suspend fun fetch(builder: Request.Builder): String =
    withContext(Dispatchers.IO) {
      val request = builder.header("Accept", "application/json").build()
      try {
        client.newCall(request).execute().use { response ->
          val body = response.body.string()
          if (response.isSuccessful) return@use body
          val detail = runCatching { ApiJson.decodeFromString<ApiErrorBody>(body).error }.getOrNull()
          throw ApiException.Server(
            status = response.code,
            // A 404 with no JSON body (a static file such as an Atlas tile) is still not found, so never shown from an old copy.
            code = detail?.code ?: if (response.code == 404) "not_found" else "server_error",
            message = detail?.message ?: "The forecast server had a problem (${response.code}).",
          )
        }
      } catch (e: IOException) {
        throw ApiException.Network(e)
      }
    }

  companion object {
    private val JSON = "application/json".toMediaType()
    private val JPEG = "image/jpeg".toMediaType()

    fun defaultClient(): OkHttpClient =
      OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()
  }
}
