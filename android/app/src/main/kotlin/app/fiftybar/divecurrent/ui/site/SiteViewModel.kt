package app.fiftybar.divecurrent.ui.site

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.fiftybar.divecurrent.data.AccountRepository
import app.fiftybar.divecurrent.data.DataRepository
import app.fiftybar.divecurrent.data.SignedOutException
import app.fiftybar.divecurrent.data.Loaded
import app.fiftybar.divecurrent.data.api.ApiException
import app.fiftybar.divecurrent.data.api.ApiForecast
import app.fiftybar.divecurrent.data.api.ApiRecentReport
import app.fiftybar.divecurrent.data.api.ApiSite
import app.fiftybar.divecurrent.data.api.ReportRequest
import app.fiftybar.divecurrent.data.api.Strength
import app.fiftybar.divecurrent.data.session.Session
import app.fiftybar.divecurrent.domain.MaldivesTime
import app.fiftybar.divecurrent.domain.ReportTime
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
  /** Divers' newest reports here, newest first; null until loaded. */
  val reports: List<ApiRecentReport>? = null,
  /** When the phone saved the reports it shows, if they are an offline copy: their "2 days ago" is from then. */
  val reportsSavedAt: Long? = null,
  val report: ReportFormState = ReportFormState(),
)

/**
 * The report form. [quickHours] is one of ReportTime.QUICK_HOURS, or null for a picked [otherWall]. A sent report
 * leaves [savedLine] (what it earned) and keeps the button off until something changes, so one dive is not sent twice.
 */
data class ReportFormState(
  val quickHours: Int? = 0,
  val otherWall: String? = null,
  val direction: String? = null,
  val strength: Strength? = null,
  val sending: Boolean = false,
  val savedLine: String? = null,
  val error: String? = null,
)

class SiteViewModel(
  private val siteId: String,
  private val repository: DataRepository,
  private val account: AccountRepository,
  /** A plan's dive time to start the report form on, "YYYY-MM-DDTHH:MM". */
  reportAt: String? = null,
) : ViewModel() {
  private val _state =
    MutableStateFlow(SiteUiState(report = if (reportAt != null) ReportFormState(quickHours = null, otherWall = reportAt) else ReportFormState()))
  val state: StateFlow<SiteUiState> = _state.asStateFlow()
  val session: StateFlow<Session?> = account.sessions.session

  init {
    viewModelScope.launch {
      repository.cachedSite(siteId)?.let { site -> _state.update { it.copy(site = site) } }
      repository.cachedReports(siteId)?.let { cached ->
        _state.update { it.copy(reports = cached.value.reports, reportsSavedAt = cached.savedAt) }
      }
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
      val reportsJob = async { runCatching { repository.reports(siteId) } }
      siteJob.await().getOrNull()?.let { loaded -> _state.update { it.copy(site = loaded.value) } }
      reportsJob.await().getOrNull()?.let { loaded ->
        _state.update { it.copy(reports = loaded.value.reports, reportsSavedAt = loaded.savedAt.takeIf { loaded.fromCache }) }
      }
      try {
        val loaded = forecastJob.await().getOrThrow()
        _state.update { show(it, loaded, keepSelection = it.forecast != null) }
      } catch (e: ApiException) {
        val notFound = e is ApiException.Server && e.code == "not_found"
        _state.update { it.copy(loading = false, error = e.message, notFound = notFound) }
      }
    }
  }

  fun reportQuick(hours: Int) = editReport { it.copy(quickHours = hours) }

  fun reportOther(wall: String) = editReport { it.copy(quickHours = null, otherWall = wall) }

  fun reportDirection(direction: String) = editReport { it.copy(direction = direction) }

  fun reportStrength(strength: Strength) = editReport { it.copy(strength = strength) }

  /** The dive time picked on the form, Maldives wall clock. */
  fun reportTime(form: ReportFormState = _state.value.report, nowMs: Long = System.currentTimeMillis()): String? =
    form.quickHours?.let { ReportTime.hoursAgo(it, nowMs) } ?: form.otherWall

  /** Sends what is ticked on the form. */
  fun sendReport() {
    val form = _state.value.report
    send(form.direction ?: return, form.strength ?: return)
  }

  /** One tap: the current ran as the forecast said for the picked hour. */
  fun sendAsForecast() {
    val time = reportTime() ?: return
    val hour = ReportTime.forecastAt(_state.value.forecast?.hours.orEmpty(), time) ?: return
    send(hour.direction, Strength.of(hour.strength) ?: return)
  }

  private fun send(direction: String, strength: Strength) {
    val form = _state.value.report
    val time = reportTime(form) ?: return
    if (form.sending) return
    _state.update { it.copy(report = form.copy(direction = direction, strength = strength, sending = true, error = null, savedLine = null)) }
    viewModelScope.launch {
      try {
        val saved = account.fileReport(siteId, ReportRequest(time, direction, strength.wire))
        val line = saved.award?.line?.takeIf { it.isNotBlank() } ?: "Report saved."
        // A fresh form; the report joins the list below and the next hours take its pull.
        _state.update { it.copy(report = ReportFormState(savedLine = "Thanks! $line")) }
        refresh()
      } catch (_: SignedOutException) {
        _state.update { it.copy(report = it.report.copy(sending = false, error = "Sign in again to report.")) }
      } catch (e: ApiException) {
        _state.update { it.copy(report = it.report.copy(sending = false, error = e.message)) }
      }
    }
  }

  private fun editReport(change: (ReportFormState) -> ReportFormState) =
    _state.update { it.copy(report = change(it.report).copy(savedLine = null, error = null)) }

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
