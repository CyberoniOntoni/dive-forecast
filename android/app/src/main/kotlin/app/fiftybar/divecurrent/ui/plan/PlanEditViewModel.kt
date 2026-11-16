package app.fiftybar.divecurrent.ui.plan

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.fiftybar.divecurrent.data.AccountRepository
import app.fiftybar.divecurrent.data.DataRepository
import app.fiftybar.divecurrent.data.SignedOutException
import app.fiftybar.divecurrent.data.api.ApiException
import app.fiftybar.divecurrent.data.api.ApiPickerSite
import app.fiftybar.divecurrent.data.api.ApiPlanLimits
import app.fiftybar.divecurrent.domain.DraftStop
import app.fiftybar.divecurrent.domain.MaldivesTime
import app.fiftybar.divecurrent.domain.PlanDraft
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class PlanEditUiState(
  /** Null until the saved plan (or the site list for a new one) has loaded. */
  val draft: PlanDraft? = null,
  /** The draft as loaded, to tell whether leaving would lose changes. */
  val original: PlanDraft? = null,
  val sites: List<ApiPickerSite> = emptyList(),
  val limits: ApiPlanLimits = ApiPlanLimits(),
  /** Maldives date today, "YYYY-MM-DD". */
  val today: String = MaldivesTime.nowWall().take(10),
  val loading: Boolean = true,
  /** Could not load the plan or the sites: nothing to edit. */
  val loadError: String? = null,
  val saving: Boolean = false,
  /** Why the last save or delete did not go through. */
  val error: String? = null,
  /** The token stopped working: sign in again, then save. */
  val signedOut: Boolean = false,
  /** Saved: the plan's id, for the plan page. */
  val savedId: String? = null,
  val deleted: Boolean = false,
) {
  val dirty: Boolean
    get() = draft != null && draft != original

  fun site(id: String): ApiPickerSite? = sites.firstOrNull { it.id == id }
}

/** Makes a new plan ([planId] null) or changes the diver's own, with the web editor's checks before it sends. */
class PlanEditViewModel(
  private val planId: String?,
  private val repository: DataRepository,
  private val account: AccountRepository,
) : ViewModel() {
  private val _state = MutableStateFlow(PlanEditUiState())
  val state: StateFlow<PlanEditUiState> = _state.asStateFlow()

  init {
    load()
  }

  fun load() {
    _state.update { it.copy(loading = true, loadError = null) }
    viewModelScope.launch {
      try {
        val picker = repository.planSites().value
        val today = picker.today.ifBlank { _state.value.today }
        val (draft, limits) =
          if (planId == null) {
            val limits = runCatching { account.myPlans()?.limits }.getOrNull() ?: ApiPlanLimits()
            PlanDraft.new(today, limits) to limits
          } else {
            val plan = account.editablePlan(planId)
            PlanDraft.from(plan) to plan.limits
          }
        _state.update {
          it.copy(draft = draft, original = draft, sites = picker.sites, limits = limits, today = today, loading = false)
        }
      } catch (_: SignedOutException) {
        _state.update { it.copy(loading = false, loadError = "Sign in again to change this plan.", signedOut = true) }
      } catch (e: ApiException) {
        _state.update { it.copy(loading = false, loadError = e.message ?: "Could not load the plan.") }
      }
    }
  }

  fun edit(change: (PlanDraft) -> PlanDraft) =
    _state.update { state -> state.draft?.let { state.copy(draft = change(it), error = null) } ?: state }

  fun changeStop(dayKey: Long, stopKey: Long, change: (DraftStop) -> DraftStop) = edit { it.changeStop(dayKey, stopKey, change) }

  fun save() {
    val state = _state.value
    val draft = state.draft ?: return
    if (state.saving) return
    val known = state.sites.associateBy { it.id }
    draft.problem(state.limits) { it in known }?.let { problem ->
      _state.update { it.copy(error = problem) }
      return
    }
    _state.update { it.copy(saving = true, error = null) }
    viewModelScope.launch {
      try {
        val id = account.savePlan(planId, draft.body { known[it]?.channel == true })
        _state.update { it.copy(saving = false, savedId = id, original = draft) }
      } catch (_: SignedOutException) {
        _state.update { it.copy(saving = false, signedOut = true, error = "Sign in again, then save. Your changes stay here.") }
      } catch (e: ApiException) {
        _state.update { it.copy(saving = false, error = e.message ?: "Could not save the plan.") }
      }
    }
  }

  fun delete() {
    val id = planId ?: return
    if (_state.value.saving) return
    _state.update { it.copy(saving = true, error = null) }
    viewModelScope.launch {
      try {
        account.deletePlan(id)
        _state.update { it.copy(saving = false, deleted = true) }
      } catch (_: SignedOutException) {
        _state.update { it.copy(saving = false, signedOut = true, error = "Sign in again to delete this plan.") }
      } catch (e: ApiException) {
        _state.update { it.copy(saving = false, error = e.message ?: "Could not delete the plan.") }
      }
    }
  }

  /** Back from the sign-in screen: the token is new, so the error about it goes. */
  fun signedInAgain() {
    if (!_state.value.signedOut) return
    _state.update { it.copy(signedOut = false, error = null) }
    if (_state.value.draft == null) load()
  }
}
