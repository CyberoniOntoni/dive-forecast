package app.fiftybar.divecurrent.data.api

import java.io.IOException
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

  suspend fun reports(siteId: String): Pair<ApiRecentReports, String> =
    get(listOf("api", "v1", "sites", siteId, "reports"))

  /** A plan by its share id; with the diver's token the answer says whether they made it. */
  suspend fun plan(id: String, token: String?): Pair<ApiPlan, String> = get(listOf("api", "v1", "plans", id), token)

  suspend fun planLegs(id: String, dayIndex: Int): Pair<ApiPlanLegs, String> =
    get(listOf("api", "v1", "plans", id, "days", dayIndex.toString(), "legs"))

  suspend fun myPlans(token: String): ApiPlanSummaries = get<ApiPlanSummaries>(listOf("api", "v1", "plans"), token).first

  /** Emails a sign-in code. */
  suspend fun requestCode(email: String): ApiCodeSent =
    post(listOf("api", "v1", "sign-in", "code"), ApiJson.encodeToString(CodeRequest(email)), token = null)

  /** Trades the emailed code (and a new diver's nickname) for the app's token. */
  suspend fun token(email: String, code: String, nickname: String?): ApiToken =
    post(listOf("api", "v1", "sign-in", "token"), ApiJson.encodeToString(TokenRequest(email, code, nickname)), token = null)

  suspend fun me(token: String): ApiMe = get<ApiMe>(listOf("api", "v1", "me"), token).first

  suspend fun signOutEverywhere(token: String) {
    post<ApiOk>(listOf("api", "v1", "sign-out-everywhere"), "{}", token)
  }

  suspend fun fileReport(token: String, siteId: String, report: ReportRequest): ApiReportSaved =
    post(listOf("api", "v1", "sites", siteId, "reports"), ApiJson.encodeToString(report), token)

  private fun url(segments: List<String>): HttpUrl =
    base.newBuilder().apply { segments.forEach { addPathSegment(it) } }.build()

  private suspend inline fun <reified T> get(segments: List<String>, token: String? = null): Pair<T, String> {
    val text = fetch(Request.Builder().url(url(segments)).get().withToken(token))
    return decode<T>(text) to text
  }

  private suspend inline fun <reified T> post(segments: List<String>, json: String, token: String?): T =
    decode(fetch(Request.Builder().url(url(segments)).post(json.toRequestBody(JSON)).withToken(token)))

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
            code = detail?.code ?: "server_error",
            message = detail?.message ?: "The forecast server had a problem (${response.code}).",
          )
        }
      } catch (e: IOException) {
        throw ApiException.Network(e)
      }
    }

  companion object {
    private val JSON = "application/json".toMediaType()

    fun defaultClient(): OkHttpClient =
      OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()
  }
}
