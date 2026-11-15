package app.fiftybar.divecurrent.ui.map

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.fiftybar.divecurrent.data.DataRepository
import app.fiftybar.divecurrent.data.Loaded
import app.fiftybar.divecurrent.data.api.ApiException
import app.fiftybar.divecurrent.data.api.ApiNowcast
import app.fiftybar.divecurrent.data.api.ApiSite
import app.fiftybar.divecurrent.data.api.ApiSites
import app.fiftybar.divecurrent.data.api.ForecastRoute
import app.fiftybar.divecurrent.domain.Glance
import app.fiftybar.divecurrent.domain.Heading
import app.fiftybar.divecurrent.domain.glance
import app.fiftybar.divecurrent.domain.glanceRank
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** One pin and list row: the site and how its current hour reads. */
data class SiteRow(val site: ApiSite, val atollName: String?, val glance: Glance?, val stale: Boolean)

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
)

class MapViewModel(private val repository: DataRepository) : ViewModel() {
  private val _state = MutableStateFlow(MapUiState())
  val state: StateFlow<MapUiState> = _state.asStateFlow()

  init {
    viewModelScope.launch {
      val sites = repository.cachedSites()
      val nowcast = repository.cachedNowcast()
      if (sites != null) _state.update { it.copy(rows = rows(sites.value, nowcast?.value), savedAt = nowcast?.savedAt) }
      refresh()
    }
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
      savedAt = loadedNowcast?.savedAt ?: current.savedAt,
      loading = false,
      error = failure?.let { (it as? ApiException)?.message ?: "Could not load the forecast." },
      fromCache = loadedNowcast?.fromCache ?: true,
    )
  }

  companion object {
    /** Strongest first, as the web list sorts, then by name. */
    fun rows(sites: ApiSites, nowcast: ApiNowcast?): List<SiteRow> {
      val atolls = sites.atolls.associate { it.id to it.name }
      val byId = nowcast?.nowcasts?.associateBy { it.siteId }.orEmpty()
      return sites.sites
        .map { site ->
          val n = byId[site.id]
          val g =
            n?.let {
              glance(
                it.hour,
                Heading(
                  route = ForecastRoute.of(it.forecastRoute),
                  inwardBearingDeg = it.inwardBearingDeg,
                  alongHeadingDeg = it.alongHeadingDeg,
                  outgoingBearingDeg = it.outgoingBearingDeg,
                  bearingSource = it.bearingSource,
                ),
              )
            }
          SiteRow(site, atolls[site.atollId], g, stale = n?.stale == true)
        }
        .sortedWith(compareBy<SiteRow> { glanceRank(it.glance) }.thenBy { it.site.name.lowercase() })
    }
  }
}
