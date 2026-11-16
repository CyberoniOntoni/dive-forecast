package app.fiftybar.divecurrent.data

import app.fiftybar.divecurrent.data.api.ApiException
import app.fiftybar.divecurrent.data.api.ApiForecast
import app.fiftybar.divecurrent.data.api.ApiJson
import app.fiftybar.divecurrent.data.api.ApiNowcast
import app.fiftybar.divecurrent.data.api.ApiRecentReports
import app.fiftybar.divecurrent.data.api.ApiSite
import app.fiftybar.divecurrent.data.api.ApiSites
import app.fiftybar.divecurrent.data.api.DiveCurrentApi
import app.fiftybar.divecurrent.data.db.CachedBody
import app.fiftybar.divecurrent.data.db.CachedBodyDao
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException

/**
 * A body to show, fresh or from the phone's copy.
 *
 * @property savedAt when this phone received it (Unix ms).
 * @property offlineError set when the fetch failed and this is the last copy; its message can be shown.
 */
data class Loaded<T>(val value: T, val savedAt: Long, val offlineError: ApiException? = null) {
  val fromCache: Boolean
    get() = offlineError != null
}

/**
 * Network first, then the last copy. A fetch that works replaces the copy; one that fails falls back to it, and only
 * a failure with no copy at all reaches the caller as an exception. A 404 is never hidden behind an old copy: the
 * site is gone or hidden.
 */
class DataRepository(
  private val api: DiveCurrentApi,
  private val cache: CachedBodyDao,
  private val now: () -> Long = System::currentTimeMillis,
) {
  suspend fun sites(): Loaded<ApiSites> = load("sites", ApiSites.serializer()) { api.sites().second }

  suspend fun nowcast(): Loaded<ApiNowcast> = load("nowcast", ApiNowcast.serializer()) { api.nowcast().second }

  suspend fun site(siteId: String): Loaded<ApiSite> = load("site/$siteId", ApiSite.serializer()) { api.site(siteId).second }

  suspend fun forecast(siteId: String): Loaded<ApiForecast> =
    load("forecast/$siteId", ApiForecast.serializer()) { api.forecast(siteId).second }

  suspend fun reports(siteId: String): Loaded<ApiRecentReports> =
    load("reports/$siteId", ApiRecentReports.serializer()) { api.reports(siteId).second }

  suspend fun cachedReports(siteId: String): Loaded<ApiRecentReports>? =
    cached("reports/$siteId", ApiRecentReports.serializer(), null)

  /** The phone's copy only, for showing something while the first fetch runs. */
  suspend fun cachedSites(): Loaded<ApiSites>? = cached("sites", ApiSites.serializer(), null)

  suspend fun cachedNowcast(): Loaded<ApiNowcast>? = cached("nowcast", ApiNowcast.serializer(), null)

  /** This site's own copy, else its row in the copy of the whole list. */
  suspend fun cachedSite(siteId: String): ApiSite? =
    cached("site/$siteId", ApiSite.serializer(), null)?.value
      ?: cachedSites()?.value?.sites?.firstOrNull { it.id == siteId }

  suspend fun cachedForecast(siteId: String): Loaded<ApiForecast>? =
    cached("forecast/$siteId", ApiForecast.serializer(), null)

  fun photoUrl(path: String): String = api.absolute(path)

  private suspend fun <T> load(key: String, serializer: KSerializer<T>, fetch: suspend () -> String): Loaded<T> {
    val text =
      try {
        fetch()
      } catch (e: ApiException) {
        if (e is ApiException.Server && e.code == "not_found") throw e
        return cached(key, serializer, e) ?: throw e
      }
    val savedAt = now()
    cache.put(CachedBody(key, text, savedAt))
    return Loaded(ApiJson.decodeFromString(serializer, text), savedAt)
  }

  private suspend fun <T> cached(key: String, serializer: KSerializer<T>, error: ApiException?): Loaded<T>? {
    val body = cache.get(key) ?: return null
    val value =
      try {
        ApiJson.decodeFromString(serializer, body.json)
      } catch (_: SerializationException) {
        return null
      } catch (_: IllegalArgumentException) {
        return null
      }
    return Loaded(value, body.savedAt, error)
  }
}
