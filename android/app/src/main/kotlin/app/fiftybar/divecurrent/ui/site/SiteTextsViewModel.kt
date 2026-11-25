package app.fiftybar.divecurrent.ui.site

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.fiftybar.divecurrent.data.AccountRepository
import app.fiftybar.divecurrent.data.DataRepository
import app.fiftybar.divecurrent.data.SignedOutException
import app.fiftybar.divecurrent.data.api.ApiException
import app.fiftybar.divecurrent.data.api.ApiSiteTexts
import app.fiftybar.divecurrent.data.session.Session
import app.fiftybar.divecurrent.domain.SiteTextsDraft
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChangedBy
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SiteTextsUiState(
  val loading: Boolean = false,
  /** The form as the server last answered it; null until loaded. */
  val form: ApiSiteTexts? = null,
  /** Where the fields started (to tell an edited form), and what is in them now. */
  val start: SiteTextsDraft? = null,
  val draft: SiteTextsDraft = SiteTextsDraft("", "", ""),
  val busy: Boolean = false,
  val error: String? = null,
  /** What the last send or withdraw did: "Thanks. A moderator will look at your edit…". */
  val done: String? = null,
) {
  /** Typed something that leaving would lose. */
  val dirty: Boolean
    get() = start != null && draft != start

  /** The body Send would post, or null with nothing changed. */
  val body
    get() = form?.let { SiteTextsDraft.body(it, draft) }
}

/**
 * The web's "Suggest an edit" form (components/SiteWiki.tsx) for a site's About the site and How to dive it: an edit
 * a moderator approves before it shows, or that goes live at once from a moderator. API.md § Site texts.
 */
class SiteTextsViewModel(
  private val siteId: String,
  private val repository: DataRepository,
  private val account: AccountRepository,
) : ViewModel() {
  private val _state = MutableStateFlow(SiteTextsUiState())
  val state: StateFlow<SiteTextsUiState> = _state.asStateFlow()
  val session: StateFlow<Session?> = account.sessions.session

  init {
    load()
    // Signed in, out or as someone else while the screen is open: the form (their own edit, whether they may send)
    // was the last diver's, so start again for whoever is signed in now. A new nickname is the same diver.
    viewModelScope.launch {
      session.distinctUntilChangedBy { it?.token }.drop(1).collect { now ->
        _state.value = SiteTextsUiState()
        if (now != null) load()
      }
    }
  }

  fun load() {
    if (account.sessions.current() == null || _state.value.loading) return
    _state.update { it.copy(loading = true, error = null) }
    viewModelScope.launch {
      try {
        show(account.siteTexts(siteId), done = null)
      } catch (_: SignedOutException) {
        _state.update { it.copy(loading = false) }
      } catch (e: ApiException) {
        _state.update { it.copy(loading = false, error = e.message) }
      }
    }
  }

  fun edit(change: (SiteTextsDraft) -> SiteTextsDraft) {
    if (_state.value.busy) return
    _state.update { it.copy(draft = change(it.draft), error = null, done = null) }
  }

  fun send() {
    val s = _state.value
    if (s.busy) return
    val body = s.body
    if (body == null) {
      _state.update { it.copy(error = "Change something first.") }
      return
    }
    act {
      val saved = account.proposeSiteTexts(siteId, body)
      // A moderator's edit is live: the site page and map read the site again.
      if (saved.live) repository.markSitesChanged()
      show(
        saved,
        done =
          if (saved.live) "Saved. Your edit is live."
          else "Thanks. A moderator will look at your edit; once approved it shows on the site page with your name, and earns points.",
      )
    }
  }

  fun withdraw() {
    val id = _state.value.form?.mine?.takeIf { it.status == "pending" }?.id ?: return
    act { show(account.withdrawSiteEdit(siteId, id), done = "Your edit is withdrawn.") }
  }

  /** Agrees to the content rules, for divers from before them, then loads the form again. */
  fun acceptTerms() =
    act {
      account.acceptTerms()
      show(account.siteTexts(siteId), done = null)
    }

  private fun show(form: ApiSiteTexts, done: String?) {
    val start = SiteTextsDraft.start(form)
    _state.update { it.copy(loading = false, busy = false, form = form, start = start, draft = start, error = null, done = done) }
  }

  private fun act(block: suspend () -> Unit) {
    if (_state.value.busy) return
    _state.update { it.copy(busy = true, error = null, done = null) }
    viewModelScope.launch {
      try {
        block()
      } catch (_: SignedOutException) {
        _state.update { it.copy(busy = false, error = "Sign in again to edit this site.") }
      } catch (e: ApiException) {
        _state.update { it.copy(busy = false, error = e.message) }
        // Refused: often the edit changed under the form (a moderator looked at it, or it was withdrawn elsewhere).
        // Read the form again so the card and buttons are true, keeping what the diver typed.
        if (e is ApiException.Server && (e.status == 400 || e.status == 404)) catchUp()
      }
    }
  }

  private suspend fun catchUp() {
    val form =
      try {
        account.siteTexts(siteId)
      } catch (_: ApiException) {
        return
      } catch (_: SignedOutException) {
        return
      }
    _state.update { it.copy(form = form, start = SiteTextsDraft.start(form)) }
  }
}
