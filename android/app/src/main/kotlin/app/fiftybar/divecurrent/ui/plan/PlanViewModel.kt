package app.fiftybar.divecurrent.ui.plan

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.fiftybar.divecurrent.data.AccountRepository
import app.fiftybar.divecurrent.data.DataRepository
import app.fiftybar.divecurrent.data.Loaded
import app.fiftybar.divecurrent.data.SignedOutException
import app.fiftybar.divecurrent.data.api.ApiException
import app.fiftybar.divecurrent.data.api.ApiPlan
import app.fiftybar.divecurrent.data.api.ApiPlanDay
import app.fiftybar.divecurrent.data.api.ApiPlanLeg
import app.fiftybar.divecurrent.data.api.ApiPlanLegs
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
  /** Each day's boat line with those legs, "4.2 nm by boat · about 35 min at 8 kn". */
  val totals: Map<Int, String> = emptyMap(),
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

  private var shownBefore = false

  /** Each time the screen shows; the first is the load in init, later ones (back from the editor) reload. */
  fun shown() {
    if (shownBefore) refresh()
    shownBefore = true
  }

  fun refresh() {
    viewModelScope.launch {
      _state.update { it.copy(loading = true) }
      try {
        val loaded = repository.plan(planId, account.sessions.current()?.token)
        _state.update { show(it, loaded) }
        loadLegs(loaded.value, planIsFresh = !loaded.fromCache)
      } catch (e: ApiException) {
        val notFound = e is ApiException.Server && e.code == "not_found"
        _state.update { it.copy(loading = false, error = e.message, notFound = notFound) }
      }
    }
  }

  private suspend fun loadLegs(plan: ApiPlan, planIsFresh: Boolean) {
    plan.days.forEachIndexed { index, day ->
      if (day.stops.size < 2) return@forEachIndexed
      val loaded =
        try {
          repository.planLegs(planId, index)
        } catch (_: ApiException) {
          null
        }
      val legs = loaded?.let { usableLegs(day, it, planIsFresh) }
      val total = loaded?.value?.total.takeIf { legs != null }
      _state.update {
        if (legs != null)
          it.copy(
            legs = it.legs + (index to legs),
            totals = if (total != null) it.totals + (index to total) else it.totals - index,
            legsFailed = it.legsFailed - index,
          )
        else it.copy(legs = it.legs - index, totals = it.totals - index, legsFailed = it.legsFailed + index)
      }
    }
  }

  companion object {
    /**
     * The legs to show under [day], or null when there are none to trust. The phone keeps each day's legs apart from
     * the plan, so an old copy of the legs may belong to a version of the plan from before it was edited: next to a
     * plan just fetched, only legs just fetched are used, and any copy must join as many dives as the day has.
     */
    fun usableLegs(day: ApiPlanDay, loaded: Loaded<ApiPlanLegs>, planIsFresh: Boolean): List<ApiPlanLeg>? {
      if (planIsFresh && loaded.fromCache) return null
      val legs = loaded.value.legs
      return legs.takeIf { list -> list.size == day.stops.size - 1 && list.all { it.from in 0 until day.stops.size - 1 } }
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

  private var shownBefore = false

  /** Each time the screen shows; later ones (back from a plan or the editor) reload the list. */
  fun shown() {
    if (shownBefore) refresh()
    shownBefore = true
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
