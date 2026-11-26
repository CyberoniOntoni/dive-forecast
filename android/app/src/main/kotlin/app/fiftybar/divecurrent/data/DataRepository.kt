package app.fiftybar.divecurrent.data

import app.fiftybar.divecurrent.domain.AtlasIndex
import app.fiftybar.divecurrent.data.api.ApiBoatRoute
import app.fiftybar.divecurrent.data.api.ApiException
import app.fiftybar.divecurrent.data.api.ApiForecast
import app.fiftybar.divecurrent.data.api.ApiJson
import app.fiftybar.divecurrent.data.api.ApiPlanSites
import app.fiftybar.divecurrent.data.api.ApiNowcast
import app.fiftybar.divecurrent.data.api.ApiPlan
import app.fiftybar.divecurrent.data.api.ApiPlanLegs
import app.fiftybar.divecurrent.data.api.ApiRecentReports
import app.fiftybar.divecurrent.data.api.ApiSite
import app.fiftybar.divecurrent.data.api.ApiShelter
import app.fiftybar.divecurrent.data.api.ApiShelterPoint
import app.fiftybar.divecurrent.data.api.ApiShelterShapes
import app.fiftybar.divecurrent.data.api.ApiSites
import app.fiftybar.divecurrent.data.api.DiveCurrentApi
import app.fiftybar.divecurrent.data.db.CachedBody
import app.fiftybar.divecurrent.data.db.CachedBodyDao
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
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
  private val _sitesChanged = MutableStateFlow(0)
  private val _siteVersions = MutableStateFlow<Map<String, Int>>(emptyMap())

  /** Counts every change to the sites made on this phone (a site added, a site's texts live), so the map reads the list again. */
  val sitesChanged: StateFlow<Int> = _sitesChanged.asStateFlow()

  /**
   * Counts changes made on this phone per site (its texts went live), so that site's page reads it again. A count per
   * site, not the latest id alone: two changes close together must not hide the first.
   */
  val siteVersions: StateFlow<Map<String, Int>> = _siteVersions.asStateFlow()

  /** [siteId]: the one site that changed; null for a change to the list only, such as a new site. */
  fun markSitesChanged(siteId: String? = null) {
    if (siteId != null) _siteVersions.update { it + (siteId to (it[siteId] ?: 0) + 1) }
    _sitesChanged.update { it + 1 }
  }

  suspend fun sites(): Loaded<ApiSites> = load(Keys.SITES, ApiSites.serializer()) { api.sites().second }

  suspend fun nowcast(): Loaded<ApiNowcast> = load("nowcast", ApiNowcast.serializer()) { api.nowcast().second }

  suspend fun site(siteId: String): Loaded<ApiSite> = load(Keys.site(siteId), ApiSite.serializer()) { api.site(siteId).second }

  suspend fun forecast(siteId: String): Loaded<ApiForecast> =
    load(Keys.forecast(siteId), ApiForecast.serializer()) { api.forecast(siteId).second }

  suspend fun reports(siteId: String, token: String? = null): Loaded<ApiRecentReports> =
    load(Keys.reports(siteId), ApiRecentReports.serializer()) { api.reports(siteId, token).second }

  suspend fun cachedReports(siteId: String): Loaded<ApiRecentReports>? =
    cached(Keys.reports(siteId), ApiRecentReports.serializer(), null)

  /**
   * A plan and its legs, kept for offline use like the forecast: a plan is read on the boat, often out of signal. The
   * copy is per plan, whoever is signed in; it holds nothing private but `isOwner`.
   */
  suspend fun plan(id: String, token: String?): Loaded<ApiPlan> =
    load("plan/$id", ApiPlan.serializer()) { api.plan(id, token).second }

  suspend fun cachedPlan(id: String): Loaded<ApiPlan>? = cached("plan/$id", ApiPlan.serializer(), null)

  suspend fun planLegs(id: String, dayIndex: Int): Loaded<ApiPlanLegs> =
    load("plan/$id/legs/$dayIndex", ApiPlanLegs.serializer()) { api.planLegs(id, dayIndex).second }

  /** The plan editor's site list, kept like every other read so the editor opens on the last copy when the server is slow. */
  suspend fun planSites(): Loaded<ApiPlanSites> = load("plan-sites", ApiPlanSites.serializer()) { api.planSites().second }

  /** A boat route, always from the server: it is about where the boat is now. */
  suspend fun boatRoute(fromLat: Double, fromLon: Double, to: String): ApiBoatRoute = api.boatRoute(fromLat, fromLon, to)

  /** The sheltered-water layer: always from the server, it is about one view and one hour. */
  suspend fun shelter(south: Double, west: Double, north: Double, east: Double, time: String?): ApiShelter =
    api.shelter(south, west, north, east, time)

  /** An atoll's outline and islands; the map keeps them in memory once fetched (ShelterViewModel). */
  suspend fun shelterShapes(wayId: String): ApiShelterShapes = api.shelterShapes(wayId)

  /** An Atlas overlay's tile list: kept like the forecast, so reef shapes draw offline. */
  suspend fun atlasIndex(folder: String): AtlasIndex =
    load(Keys.atlas(folder, "index.json"), AtlasIndex.serializer()) { api.atlasIndexText(folder) }.value

  /**
   * One Atlas tile's text. Each tile seen is kept (the three overlays are about 30 MB for the whole Maldives, far less
   * for what one diver looks at), so reef shapes once drawn draw again without signal.
   */
  suspend fun atlasTile(folder: String, file: String): String = loadText(Keys.atlas(folder, file)) { api.atlasTile(folder, file) }

  /** Whether the phone holds a copy under each key; for saving an area, so a static tile already kept is not fetched again. */
  suspend fun hasCopy(key: String): Boolean = cache.get(key) != null

  /** Drops the copies under [keys]: an offline area removed. */
  suspend fun deleteCopies(keys: Collection<String>) {
    keys.chunked(CachedBodyDao.MAX_KEYS).forEach { cache.delete(it) }
  }

  /** About how much the copies under [keys] take on the phone, in bytes (their text, one byte a character). */
  suspend fun copySize(keys: Collection<String>): Long = keys.chunked(CachedBodyDao.MAX_KEYS).sumOf { cache.size(it) }

  suspend fun shelterPoint(lat: Double, lon: Double, time: String): ApiShelterPoint = api.shelterPoint(lat, lon, time)

  /** The phone's copy only, for showing something while the first fetch runs. */
  suspend fun cachedSites(): Loaded<ApiSites>? = cached(Keys.SITES, ApiSites.serializer(), null)

  suspend fun cachedNowcast(): Loaded<ApiNowcast>? = cached("nowcast", ApiNowcast.serializer(), null)

  /** This site's own copy, else its row in the copy of the whole list. */
  suspend fun cachedSite(siteId: String): ApiSite? =
    cached(Keys.site(siteId), ApiSite.serializer(), null)?.value
      ?: cachedSites()?.value?.sites?.firstOrNull { it.id == siteId }

  suspend fun cachedForecast(siteId: String): Loaded<ApiForecast>? =
    cached(Keys.forecast(siteId), ApiForecast.serializer(), null)

  fun photoUrl(path: String): String = api.absolute(path)

  /** Network first, then the last copy, as [load], for a body kept as plain text. */
  private suspend fun loadText(key: String, fetch: suspend () -> String): String =
    fetchOrCopy(key, fetch) { error -> cache.get(key)?.json ?: throw error }

  private suspend fun <T> load(key: String, serializer: KSerializer<T>, fetch: suspend () -> String): Loaded<T> {
    var savedAt = 0L
    val text = fetchOrCopy(key, fetch, onFresh = { savedAt = it }) { error -> return cached(key, serializer, error) ?: throw error }
    return Loaded(ApiJson.decodeFromString(serializer, text), savedAt)
  }

  /**
   * The one network-first rule: a fetch that works replaces the copy under [key] and is returned; any other failure
   * goes to [onFailure], which falls back to the copy. A 404 (`not_found`) is never hidden behind an old copy.
   */
  private suspend inline fun fetchOrCopy(
    key: String,
    noinline fetch: suspend () -> String,
    onFresh: (savedAt: Long) -> Unit = {},
    onFailure: (ApiException) -> String,
  ): String {
    val text =
      try {
        fetch()
      } catch (e: ApiException) {
        if (e is ApiException.Server && e.code == "not_found") throw e
        return onFailure(e)
      }
    val savedAt = now()
    cache.put(CachedBody(key, text, savedAt))
    onFresh(savedAt)
    return text
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

  /** The phone's copy keys, one per endpoint; an offline area lists the ones it saved. */
  object Keys {
    const val SITES = "sites"

    fun site(id: String) = "site/$id"

    fun forecast(id: String) = "forecast/$id"

    fun reports(id: String) = "reports/$id"

    fun atlas(folder: String, file: String) = "atlas/$folder/$file"
  }
}
