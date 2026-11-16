package app.fiftybar.divecurrent.ui.map

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.fiftybar.divecurrent.data.DataRepository
import app.fiftybar.divecurrent.data.Loaded
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

/** One pin and list row: the site and how its current hour reads. */
data class SiteRow(val site: ApiSite, val glance: Glance?, val stale: Boolean)

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
)

class MapViewModel(private val repository: DataRepository) : ViewModel() {
  private val _state = MutableStateFlow(MapUiState())
  val state: StateFlow<MapUiState> = _state.asStateFlow()

  init {
    viewModelScope.launch {
      val sites = repository.cachedSites()
      val nowcast = repository.cachedNowcast()
      if (sites != null) {
        _state.update {
          it.copy(
            rows = rows(sites.value, nowcast?.value),
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
  }

  /** On coming back to the map: fetch again once the Maldives hour has moved past the one shown. */
  fun refreshIfHourPassed(nowMs: Long = System.currentTimeMillis()) {
    val wall = _state.value.maldivesWall ?: return
    if (!_state.value.loading && wall.take(13) < MaldivesTime.nowHour(nowMs).take(13)) refresh()
  }

  fun refresh() {
    viewModelScope.launch {
      _state.update { it.copy(loading = true) }
      val sitesJob = async { runCatching { repository.sites() } }
      val nowcastJob = async { runCatching { repository.nowcast() } }
      val sites = sitesJob.await()
      val nowcast = nowcastJob.await()
      _state.update { current -> next(current, sites, nowcast) }
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
    return current.copy(
      rows = if (loadedSites != null) rows(loadedSites.value, loadedNowcast?.value) else current.rows,
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
     * so an offline copy never draws last hour's water as now's.
     */
    fun rows(sites: ApiSites, nowcast: ApiNowcast?, nowMs: Long = System.currentTimeMillis()): List<SiteRow> {
      val current = nowcast?.takeIf { outdated(it, nowMs) == null }
      val byId = current?.nowcasts?.associateBy { it.siteId }.orEmpty()
      return sites.sites
        .map { site ->
          val n = byId[site.id]
          val g = glance(n?.hour)
          SiteRow(site, g, stale = n?.stale == true)
        }
        .sortedWith(compareBy<SiteRow> { glanceRank(it.glance) }.thenBy { it.site.name.lowercase() })
    }
  }
}
