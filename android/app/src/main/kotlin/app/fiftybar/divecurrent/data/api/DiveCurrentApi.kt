package app.fiftybar.divecurrent.data.api

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request

/** A failed call. [message] is safe to show: either the server's own error text or a plain one of ours. */
sealed class ApiException(message: String) : Exception(message) {
  /** The server answered with an error body. */
  class Server(val status: Int, val code: String, message: String) : ApiException(message)

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
 * Reads /api/v1 (GET only). Each call returns the decoded body and the raw JSON, so the repository can keep the
 * exact text for offline use.
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

  private suspend inline fun <reified T> get(segments: List<String>): Pair<T, String> {
    val url = base.newBuilder().apply { segments.forEach { addPathSegment(it) } }.build()
    val text = fetch(url)
    return try {
      ApiJson.decodeFromString<T>(text) to text
    } catch (e: SerializationException) {
      throw ApiException.Malformed(e)
    } catch (e: IllegalArgumentException) {
      throw ApiException.Malformed(e)
    }
  }

  private suspend fun fetch(url: HttpUrl): String =
    withContext(Dispatchers.IO) {
      val request = Request.Builder().url(url).header("Accept", "application/json").get().build()
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
    fun defaultClient(): OkHttpClient =
      OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()
  }
}
