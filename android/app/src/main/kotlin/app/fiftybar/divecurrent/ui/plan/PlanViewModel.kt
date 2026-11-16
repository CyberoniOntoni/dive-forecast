package app.fiftybar.divecurrent.ui.plan

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.fiftybar.divecurrent.data.AccountRepository
import app.fiftybar.divecurrent.data.DataRepository
import app.fiftybar.divecurrent.data.Loaded
import app.fiftybar.divecurrent.data.SignedOutException
import app.fiftybar.divecurrent.data.api.ApiException
import app.fiftybar.divecurrent.data.api.ApiPlan
import app.fiftybar.divecurrent.data.api.ApiPlanLeg
import app.fiftybar.divecurrent.data.api.ApiPlanSummary
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class PlanUiState(
  val plan: ApiPlan? = null,
  /** When the phone received the plan, Unix ms. */
  val savedAt: Long? = null,
  val fromCache: Boolean = false,
  val loading: Boolean = true,
  val error: String? = null,
  /** The plan was deleted, or the link is wrong. */
  val notFound: Boolean = false,
  /** Each day's boat legs by day index, once loaded. */
  val legs: Map<Int, List<ApiPlanLeg>> = emptyMap(),
  /** Days whose legs could not be loaded and have no copy. */
  val legsFailed: Set<Int> = emptySet(),
)

/** A plan as its web page shows it, kept on the phone for the boat, with each day's legs fetched after it. */
class PlanViewModel(
  private val planId: String,
  private val repository: DataRepository,
  private val account: AccountRepository,
) : ViewModel() {
  private val _state = MutableStateFlow(PlanUiState())
  val state: StateFlow<PlanUiState> = _state.asStateFlow()

  init {
    viewModelScope.launch {
      repository.cachedPlan(planId)?.let { cached -> _state.update { show(it, cached) } }
      refresh()
    }
  }

  fun refresh() {
    viewModelScope.launch {
      _state.update { it.copy(loading = true) }
      try {
        val loaded = repository.plan(planId, account.sessions.current()?.token)
        _state.update { show(it, loaded) }
        loadLegs(loaded.value)
      } catch (e: ApiException) {
        val notFound = e is ApiException.Server && e.code == "not_found"
        _state.update { it.copy(loading = false, error = e.message, notFound = notFound) }
      }
    }
  }

  private suspend fun loadLegs(plan: ApiPlan) {
    plan.days.forEachIndexed { index, day ->
      if (day.stops.size < 2) return@forEachIndexed
      try {
        val legs = repository.planLegs(planId, index).value.legs
        _state.update { it.copy(legs = it.legs + (index to legs), legsFailed = it.legsFailed - index) }
      } catch (_: ApiException) {
        _state.update { it.copy(legsFailed = it.legsFailed + index) }
      }
    }
  }

  private fun show(current: PlanUiState, loaded: Loaded<ApiPlan>): PlanUiState =
    current.copy(
      plan = loaded.value,
      savedAt = loaded.savedAt,
      fromCache = loaded.fromCache,
      loading = false,
      error = loaded.offlineError?.message,
      notFound = false,
    )
}

data class PlansUiState(
  val plans: List<ApiPlanSummary>? = null,
  val loading: Boolean = false,
  val error: String? = null,
  /** What the diver typed or pasted in the "open a plan" box. */
  val link: String = "",
)

class PlansViewModel(private val account: AccountRepository) : ViewModel() {
  private val _state = MutableStateFlow(PlansUiState())
  val state: StateFlow<PlansUiState> = _state.asStateFlow()
  val session = account.sessions.session

  init {
    refresh()
  }

  fun link(value: String) = _state.update { it.copy(link = value) }

  fun refresh() {
    if (account.sessions.current() == null) return
    _state.update { it.copy(loading = true, error = null) }
    viewModelScope.launch {
      try {
        val plans = account.myPlans()
        _state.update { it.copy(plans = plans?.plans, loading = false) }
      } catch (_: SignedOutException) {
        _state.update { it.copy(plans = null, loading = false) }
      } catch (e: ApiException) {
        _state.update { it.copy(loading = false, error = e.message) }
      }
    }
  }
}
