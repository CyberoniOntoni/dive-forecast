package app.fiftybar.divecurrent.ui.nav

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.fiftybar.divecurrent.data.DataRepository
import app.fiftybar.divecurrent.data.api.ApiBoatRoute
import app.fiftybar.divecurrent.data.api.ApiException
import app.fiftybar.divecurrent.domain.BoatNav
import app.fiftybar.divecurrent.domain.Fix
import app.fiftybar.divecurrent.domain.NavReadouts
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

sealed interface GpsStatus {
  data object Waiting : GpsStatus

  data object Ok : GpsStatus

  data class Error(val message: String) : GpsStatus
}

data class NavState(
  val fixes: List<Fix> = emptyList(),
  val gps: GpsStatus = GpsStatus.Waiting,
  val route: ApiBoatRoute? = null,
  /** The last request for a route failed, or the destination is unknown; any earlier route stays. */
  val routeFailed: Boolean = false,
  /** Why, in the server's words when it gave some. */
  val routeError: String? = null,
  /** Bumped to ask the map to frame the boat and the route. */
  val frame: Int = 0,
)

/**
 * Follows the boat to one destination: keeps the latest GPS fixes, asks the server for a route on the first fix and
 * again when the boat has left it (at most every 20 s, a failed request too), as the web panel does.
 */
class NavigateViewModel(
  private val destinationId: String,
  private val repository: DataRepository,
  private val now: () -> Long = System::currentTimeMillis,
) : ViewModel() {
  private val _state = MutableStateFlow(NavState())
  val state: StateFlow<NavState> = _state.asStateFlow()
  private var busy = false
  private var lastAskMs: Long? = null

  fun onFix(fix: Fix) {
    _state.update { it.copy(fixes = BoatNav.keepFixes(it.fixes, fix), gps = GpsStatus.Ok) }
    maybeRoute(fix)
  }

  fun onGpsError(message: String) {
    _state.update { it.copy(gps = GpsStatus.Error(message)) }
  }

  fun frame() {
    _state.update { it.copy(frame = it.frame + 1) }
  }

  private fun maybeRoute(fix: Fix) {
    val nowMs = now()
    if (!NavReadouts.shouldReroute(fix.point, _state.value.route, lastAskMs, busy, nowMs)) return
    busy = true
    lastAskMs = nowMs
    val first = _state.value.route == null
    viewModelScope.launch {
      try {
        val route = repository.boatRoute(fix.lat, fix.lon, destinationId)
        _state.update { it.copy(route = route, routeFailed = false, routeError = null) }
      } catch (e: ApiException) {
        _state.update { it.copy(routeFailed = true, routeError = e.message) }
      } finally {
        busy = false
        // The first answer, route or not, frames the boat and where it is heading.
        if (first) frame()
      }
    }
  }
}
