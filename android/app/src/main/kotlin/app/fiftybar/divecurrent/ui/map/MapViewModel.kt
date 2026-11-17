package app.fiftybar.divecurrent.ui.map

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.fiftybar.divecurrent.data.DataRepository
import app.fiftybar.divecurrent.data.Loaded
import app.fiftybar.divecurrent.data.OfflineAreas
import app.fiftybar.divecurrent.data.api.ApiForecast
import app.fiftybar.divecurrent.domain.OfflineArea
import app.fiftybar.divecurrent.data.api.ApiException
import app.fiftybar.divecurrent.data.api.ApiNowcast
import app.fiftybar.divecurrent.data.api.ApiSite
import app.fiftybar.divecurrent.data.api.ApiSites
import app.fiftybar.divecurrent.domain.Glance
import app.fiftybar.divecurrent.domain.MaldivesTime
import app.fiftybar.divecurrent.domain.glance
import app.fiftybar.divecurrent.domain.glanceRank
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * One pin and list row: the site and how its current hour reads. [fromSaved] is set when the hour comes from the
 * atoll's saved week (no current map from the server), not from the nowcast.
 */
data class SiteRow(val site: ApiSite, val glance: Glance?, val stale: Boolean, val fromSaved: Boolean = false)

data class MapUiState(
  val rows: List<SiteRow> = emptyList(),
  /** The Maldives wall time the nowcast was picked for. */
  val maldivesWall: String? = null,
  /** When the phone received the nowcast, Unix ms. */
  val savedAt: Long? = null,
  val loading: Boolean = true,
  /** Set when the last refresh failed; the rows may still be the phone's copy. */
  val error: String? = null,
  val fromCache: Boolean = false,
  /**
   * The saved nowcast is for an earlier Maldives hour than now (offline, or the app left open), so its arrows are
   * not shown: they would read as the current hour. Set with the wall time it was for.
   */
  val outdatedWall: String? = null,
  /** How many rows draw this hour from a saved atoll's week, because the server's map for it is missing or old. */
  val savedRows: Int = 0,
)

class MapViewModel(private val repository: DataRepository, private val offline: OfflineAreas? = null) : ViewModel() {
  private val _state = MutableStateFlow(MapUiState())
  val state: StateFlow<MapUiState> = _state.asStateFlow()

  /** The last site list and nowcast shown, so the rows can be built again when the saved weeks change. */
  private var lastSites: ApiSites? = null
  private var lastNowcast: ApiNowcast? = null

  /** The saved atolls' weeks, by site id. */
  private var saved: Map<String, ApiForecast> = emptyMap()

  init {
    viewModelScope.launch {
      val sites = repository.cachedSites()
      val nowcast = repository.cachedNowcast()
      if (sites != null) {
        lastSites = sites.value
        lastNowcast = nowcast?.value
        _state.update {
          withRows(it, sites.value, nowcast?.value).copy(
            savedAt = nowcast?.savedAt,
            maldivesWall = nowcast?.value?.maldivesWall,
            outdatedWall = outdated(nowcast?.value),
          )
        }
      }
      refresh()
    }
    // A site added on this phone shows on the map at once.
    viewModelScope.launch { repository.sitesChanged.drop(1).collect { refresh() } }
    // An atoll saved, saved again or removed: its weeks fill the hours the server's map lacks.
    if (offline != null) {
      viewModelScope.launch {
        offline.areas.collect {
          saved = offline.savedForecasts()
          val sites = lastSites ?: return@collect
          _state.update { current -> withRows(current, sites, lastNowcast) }
        }
      }
    }
  }

  private fun withRows(current: MapUiState, sites: ApiSites, nowcast: ApiNowcast?): MapUiState {
    val rows = rows(sites, nowcast, saved)
    return current.copy(rows = rows, savedRows = rows.count { it.fromSaved })
  }

  /** On coming back to the map: fetch again once the Maldives hour has moved past the one shown. */
  fun refreshIfHourPassed(nowMs: Long = System.currentTimeMillis()) {
    // Saved weeks move on with the clock, signal or not.
    lastSites?.let { sites -> _state.update { withRows(it, sites, lastNowcast) } }
    val wall = _state.value.maldivesWall ?: return
    if (!_state.value.loading && wall.take(13) < MaldivesTime.nowHour(nowMs).take(13)) refresh()
  }

  /** The phone has a network again (any thread): refresh if the last load failed, so the offline copy gives way. */
  fun onNetworkBack() {
    viewModelScope.launch {
      val s = _state.value
      if (s.error != null && !s.loading) refresh()
    }
  }

  fun refresh() {
    viewModelScope.launch {
      _state.update { it.copy(loading = true) }
      val sitesJob = async { runCatching { repository.sites() } }
      val nowcastJob = async { runCatching { repository.nowcast() } }
      val sites = sitesJob.await()
      val nowcast = nowcastJob.await()
      sites.getOrNull()?.let { lastSites = it.value }
      nowcast.getOrNull()?.let { lastNowcast = it.value }
      _state.update { current -> next(current, sites, nowcast) }
      // Signal: a good moment to bring saved atolls up to date.
      if (nowcast.getOrNull()?.fromCache == false) offline?.refreshStale()
    }
  }

  private fun next(
    current: MapUiState,
    sites: Result<Loaded<ApiSites>>,
    nowcast: Result<Loaded<ApiNowcast>>,
  ): MapUiState {
    val loadedSites = sites.getOrNull()
    val loadedNowcast = nowcast.getOrNull()
    val failure =
      sites.exceptionOrNull()
        ?: nowcast.exceptionOrNull()
        ?: loadedNowcast?.offlineError
        ?: loadedSites?.offlineError
    val withRows = if (loadedSites != null) withRows(current, loadedSites.value, loadedNowcast?.value ?: lastNowcast) else current
    return withRows.copy(
      maldivesWall = loadedNowcast?.value?.maldivesWall ?: current.maldivesWall,
      outdatedWall = if (loadedNowcast != null) outdated(loadedNowcast.value) else current.outdatedWall,
      savedAt = loadedNowcast?.savedAt ?: current.savedAt,
      loading = false,
      error = failure?.let { (it as? ApiException)?.message ?: "Could not load the forecast." },
      fromCache = loadedNowcast?.fromCache ?: true,
    )
  }

  companion object {
    /** The nowcast's wall time when it is for an earlier Maldives hour than [nowMs]; null when it is current. */
    fun outdated(nowcast: ApiNowcast?, nowMs: Long = System.currentTimeMillis()): String? {
      val wall = nowcast?.maldivesWall ?: return null
      return if (wall.take(13) < MaldivesTime.nowHour(nowMs).take(13)) wall else null
    }

    /**
     * Strongest first, as the web list sorts, then by name. A nowcast for an earlier hour gives every row no glance,
     * so an offline copy never draws last hour's water as now's. With no current nowcast (none, or one for an earlier
     * hour), a site takes this hour from its atoll's saved week in [saved], if the atoll was saved.
     */
    fun rows(
      sites: ApiSites,
      nowcast: ApiNowcast?,
      saved: Map<String, ApiForecast> = emptyMap(),
      nowMs: Long = System.currentTimeMillis(),
    ): List<SiteRow> {
      val current = nowcast?.takeIf { outdated(it, nowMs) == null }
      val byId = current?.nowcasts?.associateBy { it.siteId }.orEmpty()
      return sites.sites
        .map { site ->
          val n = byId[site.id]
          val g = glance(n?.hour)
          // The saved week only stands in when the server's map is missing or for an earlier hour: a current map that
          // leaves a site out (no data for it this hour) is the server's word.
          if (g != null || current != null) return@map SiteRow(site, g, stale = n?.stale == true)
          val week = saved[site.id]
          val fromWeek = glance(OfflineArea.hourNow(week, nowMs))
          if (fromWeek != null) SiteRow(site, fromWeek, stale = week?.stale == true, fromSaved = true)
          else SiteRow(site, null, stale = n?.stale == true)
        }
        .sortedWith(compareBy<SiteRow> { glanceRank(it.glance) }.thenBy { it.site.name.lowercase() })
    }
  }
}
