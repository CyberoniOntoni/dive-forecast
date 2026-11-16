package app.fiftybar.divecurrent.ui.site

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.fiftybar.divecurrent.data.DataRepository
import app.fiftybar.divecurrent.data.Loaded
import app.fiftybar.divecurrent.data.api.ApiException
import app.fiftybar.divecurrent.data.api.ApiForecast
import app.fiftybar.divecurrent.data.api.ApiSite
import app.fiftybar.divecurrent.domain.MaldivesTime
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SiteUiState(
  val site: ApiSite? = null,
  val forecast: ApiForecast? = null,
  /** When the phone received the forecast, Unix ms. */
  val savedAt: Long? = null,
  /** The hour on the slider. Opens on the current Maldives hour. */
  val selected: Int = 0,
  val loading: Boolean = true,
  val error: String? = null,
  val fromCache: Boolean = false,
  /** The server says the site is gone or hidden. */
  val notFound: Boolean = false,
)

class SiteViewModel(private val siteId: String, private val repository: DataRepository) : ViewModel() {
  private val _state = MutableStateFlow(SiteUiState())
  val state: StateFlow<SiteUiState> = _state.asStateFlow()

  init {
    viewModelScope.launch {
      repository.cachedSite(siteId)?.let { site -> _state.update { it.copy(site = site) } }
      repository.cachedForecast(siteId)?.let { cached -> _state.update { show(it, cached, keepSelection = false) } }
      refresh()
    }
  }

  fun photoUrl(path: String): String = repository.photoUrl(path)

  fun select(index: Int) = _state.update { it.copy(selected = index.coerceIn(0, (it.forecast?.hours?.lastIndex ?: 0).coerceAtLeast(0))) }

  fun selectNow() =
    _state.update { s -> s.copy(selected = MaldivesTime.currentIndex(s.forecast?.hours?.map { it.time }.orEmpty())) }

  fun refresh() {
    viewModelScope.launch {
      _state.update { it.copy(loading = true) }
      // The site and its forecast load side by side; a failed site load keeps whatever copy is showing.
      val siteJob = async { runCatching { repository.site(siteId) } }
      val forecastJob = async { runCatching { repository.forecast(siteId) } }
      siteJob.await().getOrNull()?.let { loaded -> _state.update { it.copy(site = loaded.value) } }
      try {
        val loaded = forecastJob.await().getOrThrow()
        _state.update { show(it, loaded, keepSelection = it.forecast != null) }
      } catch (e: ApiException) {
        val notFound = e is ApiException.Server && e.code == "not_found"
        _state.update { it.copy(loading = false, error = e.message, notFound = notFound) }
      }
    }
  }

  private fun show(current: SiteUiState, loaded: Loaded<ApiForecast>, keepSelection: Boolean): SiteUiState {
    val hours = loaded.value.hours
    val selected =
      if (keepSelection && current.forecast != null) {
        // Stay on the same wall time if it is still in the week, else go to now.
        val time = current.forecast.hours.getOrNull(current.selected)?.time
        hours.indexOfFirst { it.time == time }.takeIf { it >= 0 } ?: MaldivesTime.currentIndex(hours.map { it.time })
      } else MaldivesTime.currentIndex(hours.map { it.time })
    return current.copy(
      forecast = loaded.value,
      savedAt = loaded.savedAt,
      selected = selected,
      loading = false,
      error = loaded.offlineError?.message,
      fromCache = loaded.fromCache,
      notFound = false,
    )
  }
}
